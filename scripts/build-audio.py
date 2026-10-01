# -*- coding: utf-8 -*-
"""Web 端音频构建：从高清原版切出「逐词音效」+「整轨」。

为什么要逐词切：
  整轨播放时，孩子漏听一个词就得整段重听，体验差。
  逐词切出来后，Web 端可以做到「点哪听哪」「只重听这一词」「单曲循环」，
  这才是「自动语音听写」该有的交互。

音频规格（沿用 audiogen.py 已验证的高保真参数）：
  单声道 / 24 kHz / 96 kbps MP3（SNR 24.4 dB，无 32kbps 那种沙沙底噪）

输出：
  public/audio/tracks/<taskId>.mp3    整轨（48 条）
  public/audio/words/<hash>.mp3       逐词（去重后约 368+ 条）
  public/audio/manifest.json          前端清单
"""
import json, os, re, sys, hashlib, io
import numpy as np
import av

sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUB = os.path.join(BASE, "public", "audio")
HQ = r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/在线听写/_audio_hq_backup"
DATA = os.path.join(BASE, "src", "data")

RATE = 24000
BITRATE = 96000
NORM_PEAK = 0.85

os.makedirs(os.path.join(PUB, "tracks"), exist_ok=True)
os.makedirs(os.path.join(PUB, "words"), exist_ok=True)


def key_of(word: str) -> str:
    # v2：内容处理升级（去「第X题」报号）后文件名必须跟着变——
    # R2/边缘缓存对 /audio/* 设了 immutable 一年，同名的旧文件会永远命中旧缓存
    return hashlib.md5(("w2:" + word).encode("utf-8")).hexdigest()[:12]


def decode_mono(path):
    """MP3 → float32 单声道 PCM"""
    with av.open(path) as c:
        st = c.streams.audio[0]
        res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
        chunks = []
        for fr in c.decode(st):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks)


def encode_mp3(pcm_f32, path):
    """float32 PCM → 96kbps 单声道 MP3，峰值归一化到 -1.4 dBFS"""
    x = np.asarray(pcm_f32, dtype=np.float64)
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak > 0:
        x = x * (NORM_PEAK / peak)
    pcm = np.ascontiguousarray(
        np.clip(np.round(x * 32767.0), -32768, 32767).astype(np.int16).reshape(1, -1)
    )
    with av.open(path, "w", format="mp3") as c:
        st = c.add_stream("libmp3lame", rate=RATE, layout="mono")
        st.bit_rate = BITRATE
        step = 1152
        for i in range(0, pcm.shape[1], step):
            blk = pcm[:, i:i + step]
            if blk.shape[1] == 0:
                continue
            f = av.AudioFrame.from_ndarray(np.ascontiguousarray(blk), format="s16", layout="mono")
            f.rate = RATE
            f.pts = None
            for pkt in st.encode(f):
                c.mux(pkt)
        for pkt in st.encode(None):
            c.mux(pkt)


def trim_fade(seg, pad_ms=60, fade_ms=10):
    """裁首尾静音 + 余弦淡入淡出。输入 float32 [-1,1]，输出同域。"""
    x = np.asarray(seg, dtype=np.float32)
    if x.size == 0:
        return x
    x = x - float(x.mean())                      # 去直流
    idx = np.flatnonzero(np.abs(x) > 0.01)       # ~-40 dBFS 阈值
    if idx.size == 0:
        return np.zeros(0, dtype=np.float32)
    pad = int(RATE * pad_ms / 1000)
    a = max(0, int(idx[0]) - pad)
    b = min(x.size, int(idx[-1]) + pad)
    out = x[a:b].copy()
    n = int(RATE * fade_ms / 1000)
    if out.size > 2 * n + 2:
        w = np.linspace(0.0, 1.0, n)
        out[:n] *= w
        out[-n:] *= w[::-1]
    return out


def strip_announce(x, min_sil=0.30, keep_pad=0.06):
    """只保留最后一遍朗读（去掉「第X题」报号和重复朗读）。

    原始整轨是听写节奏：「第X题」→ 停 → 单词第1遍 → 长停 → 单词第2遍。
    实现：按语音簇分组（组间隔 >=0.3s；词组内部连读停顿 <0.25s 不会拆组），
    从最后一组往前合并到有声跨度 >=0.35s（防止词内偶发停顿把词尾单独成组、
    只留半个音节），保留合并后的连续区间。只有一组（无报号/无重复）原样返回。
    """
    xx = np.asarray(x, dtype=np.float32)
    win = int(RATE * 0.02)                    # 20ms 能量窗
    n = xx.size // win
    if n < 6:
        return xx
    e = np.abs(xx[: n * win].reshape(n, win)).mean(axis=1)
    voiced = e >= 0.012                       # ~-38 dBFS 以上算有声
    gap_win = int(RATE * min_sil) // win      # 组间隔阈值（窗数）
    groups = []                               # 每组 [start_win, end_win)
    i = 0
    while i < n:
        if voiced[i]:
            j = i
            while j < n:
                if voiced[j]:
                    j += 1
                    continue
                # 遇到静音：向后看 gap_win 个窗，若其间再无有声窗则成组
                nxt = j
                while nxt < n and not voiced[nxt]:
                    nxt += 1
                if nxt - j >= gap_win or nxt >= n:
                    break
                j = nxt
            groups.append([i, min(j, n)])
            i = j + 1
        else:
            i += 1
    if len(groups) <= 1:
        return xx
    min_spans = int(0.35 / 0.02)              # 0.35s 有声跨度下限
    keep_from = groups[-1][0]
    span = groups[-1][1] - groups[-1][0]
    for g in reversed(groups[:-1]):
        if span >= min_spans:
            break
        keep_from = g[0]
        span += g[1] - g[0]
    if span < min_spans:
        return xx                              # 实在太短，回退不切
    cut = keep_from * win - int(RATE * keep_pad)
    return xx[max(0, cut):]




# ── 主流程 ──────────────────────────────────────────────────────
tasks = json.load(open(os.path.join(DATA, "tasks.json"), encoding="utf-8"))

manifest = {"tracks": [], "words": {}, "bitrate": BITRATE, "rate": RATE}
word_files = {}      # word -> filename
cache_pcm = {}       # word -> pcm（避免重复解码）

n_ok = n_skip = 0
for t in tasks:
    tid = t["id"]
    src = os.path.join(HQ, t["file"])
    if not os.path.exists(src):
        print(f"  [缺] {tid} <- {t['file']}")
        n_skip += 1
        continue

    # 整轨直接复制高清原版（已经是 96kbps，避免二次编码损失）
    dst_track = os.path.join(PUB, "tracks", f"{tid}.mp3")
    if not os.path.exists(dst_track):
        import shutil
        shutil.copyfile(src, dst_track)

    # 逐词切片
    full = decode_mono(src)
    items = []
    for rec in t["items"]:
        no, word, cn, t_start, t_end = rec[0], rec[1], rec[2], rec[3], rec[4]
        a, b = int(float(t_start) * RATE), int(float(t_end) * RATE)
        seg = full[max(0, a):min(full.size, b)]
        if seg.size == 0:
            items.append({"no": no, "word": word, "cn": cn, "file": None})
            continue
        clean = trim_fade(seg)
        if clean.size == 0:
            items.append({"no": no, "word": word, "cn": cn, "file": None})
            continue
        # 切掉「第X题」报号（只留纯单词），再裁一次头尾静音
        clean = trim_fade(strip_announce(clean))
        if clean.size == 0:
            items.append({"no": no, "word": word, "cn": cn, "file": None})
            continue
        if word not in word_files:
            fn = f"{key_of(word)}.mp3"
            encode_mp3(clean, os.path.join(PUB, "words", fn))
            word_files[word] = fn
            # manifest 的 words 映射统一存 words/ 前缀的完整相对路径
            manifest["words"][word] = f"words/{fn}"
        # 注意：file 必须带 words/ 前缀，否则线上（R2 桶结构 words/xxx.mp3）会 404
        items.append({"no": no, "word": word, "cn": cn, "file": f"words/{word_files[word]}"})

    manifest["tracks"].append({
        "id": tid,
        "kind": t["kind"],
        "group": t["group"],
        "order": t["order"],
        "label": t["label"],
        "file": f"tracks/{tid}.mp3",
        "seconds": t["seconds"],
        "wordCount": t["wordCount"],
        "sections": t["sections"],
        "items": items,
    })
    n_ok += 1
    print(f"  [√] {tid:8s} {t['kind']:6s} {len(items):3d}词")

json.dump(manifest, open(os.path.join(PUB, "manifest.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

print()
print(f"整轨 {n_ok} 条 / 跳过 {n_skip} 条")
print(f"逐词文件 {len(word_files)} 个")
sz = sum(os.path.getsize(os.path.join(PUB, "words", f)) for f in os.listdir(os.path.join(PUB, "words")))
tsz = sum(os.path.getsize(os.path.join(PUB, "tracks", f)) for f in os.listdir(os.path.join(PUB, "tracks")))
print(f"逐词体积 {sz/1024/1024:.1f} MB / 整轨体积 {tsz/1024/1024:.1f} MB")
