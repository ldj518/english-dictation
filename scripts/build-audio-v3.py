# -*- coding: utf-8 -*-
"""v2.6 音频重制（w3）：逐词音频直接从 edge-tts 合成第一代源 → AAC 编码。

滋滋声根因（客观）：
  现有逐词 mp3 是「第三代 mp3」——edge-tts(96k) → lame 整轨 → 解码切片 → lame 再编码。
  mp3 每过一代就叠加一次高频量化伪影（9-12kHz 嘶声），三代叠加就是耳朵里的「滋滋」。

修法：
  1. 绕开整轨，用 audiogen.synth（monkey-patch 的 96kbps 源格式 + en-GB-RyanNeural，
     与整轨同音色同语速）逐词合成第一代源；
  2. 裁静音（-44dB 阈值）+ 去直流 + 淡入淡出；
  3. 编 AAC-LC 96k（.m4a 容器）——AAC 同码率高频伪影远小于 mp3，且只此一代。

文件名换版 md5("w3:"+word)[:12]，破 immutable 边缘缓存。
整轨 tracks/*.mp3 不动（听写/翻译/打印全部走逐词音频）。
"""
import json, os, sys, io, hashlib
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUB = os.path.join(BASE, "public", "audio")
DATA = os.path.join(BASE, "src", "data")

sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402  （96k 源格式 + 缓存 + 并发都在里面）

RATE = 24000
BITRATE = 96000
NORM_PEAK = 0.85
TRIM_THRESH = 0.006   # ~-44 dBFS
TRIM_PAD_MS = 60
FADE_MS = 10


def key_of(word: str) -> str:
    # w3：第一代源 + AAC 编码，内容变了文件名必须变（immutable 缓存一年）
    return hashlib.md5(("w3:" + word).encode("utf-8")).hexdigest()[:12]


def decode_mono_bytes(mp3_bytes: bytes) -> np.ndarray:
    with av.open(io.BytesIO(mp3_bytes)) as c:
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


def trim_fade(seg):
    """去直流 + 裁首尾静音(-44dB) + 余弦淡入淡出。"""
    x = np.asarray(seg, dtype=np.float32)
    if x.size == 0:
        return x
    x = x - float(x.mean())
    idx = np.flatnonzero(np.abs(x) > TRIM_THRESH)
    if idx.size == 0:
        return np.zeros(0, dtype=np.float32)
    pad = int(RATE * TRIM_PAD_MS / 1000)
    a = max(0, int(idx[0]) - pad)
    b = min(x.size, int(idx[-1]) + pad)
    out = x[a:b].copy()
    n = int(RATE * FADE_MS / 1000)
    if out.size > 2 * n + 2:
        w = np.linspace(0.0, 1.0, n)
        out[:n] *= w
        out[-n:] *= w[::-1]
    return out


def encode_m4a(pcm_f32, path):
    """float32 PCM → AAC-LC 96k 单声道 m4a（PyAV 原生 aac 编码器）。"""
    x = np.asarray(pcm_f32, dtype=np.float64)
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak > 0:
        x = x * (NORM_PEAK / peak)
    data = np.ascontiguousarray(x.astype(np.float32).reshape(1, -1))
    with av.open(path, "w", format="ipod") as c:
        st = c.add_stream("aac", rate=RATE, layout="mono")
        st.bit_rate = BITRATE
        pts = 0
        step = 4096
        for i in range(0, data.shape[1], step):
            blk = data[:, i : i + step]
            if blk.shape[1] == 0:
                continue
            f = av.AudioFrame.from_ndarray(np.ascontiguousarray(blk), format="fltp", layout="mono")
            f.rate = RATE
            f.pts = pts
            pts += blk.shape[1]
            for pkt in st.encode(f):
                c.mux(pkt)
        for pkt in st.encode(None):
            c.mux(pkt)


# ── 主流程 ──────────────────────────────────────────────────────
tasks = json.load(open(os.path.join(DATA, "tasks.json"), encoding="utf-8"))

# 全部去重词（保持任务顺序）
seen, words = set(), []
for t in tasks:
    for it in t["items"]:
        w = it[1]
        if w.lower() in seen:
            continue
        seen.add(w.lower())
        words.append(w)

print(f"去重词数 {len(words)}")

# 第一代源：直接向 edge-tts 要（96kbps 源，与整轨同音色同语速 -5%）
todo = []
word_file = {}
for w in words:
    fn = key_of(w) + ".m4a"
    p = os.path.join(PUB, "words", fn)
    if os.path.exists(p) and os.path.getsize(p) > 500:
        word_file[w] = fn          # 重跑友好：成品已在，跳过网络
    else:
        todo.append(w)
print(f"已有成品 {len(word_file)} / 需合成 {len(todo)}")

if todo:
    got = audiogen.synth(todo, [])
    ok = bad = 0
    for w in todo:
        mp3 = got.get((w, "en"))
        if not mp3:
            print(f"  [缺] {w}")
            bad += 1
            continue
        try:
            pcm = decode_mono_bytes(mp3)
            clean = trim_fade(pcm)
            if clean.size < RATE * 0.12:      # <120ms 视为异常
                print(f"  [短] {w} {clean.size/RATE:.2f}s")
                bad += 1
                continue
            fn = key_of(w) + ".m4a"
            encode_m4a(clean, os.path.join(PUB, "words", fn))
            word_file[w] = fn
            ok += 1
        except Exception as e:                # noqa: BLE001
            print(f"  [错] {w}: {e}")
            bad += 1
    print(f"合成完成：成功 {ok} / 失败 {bad}")

# ── 重生成 manifest：file 全部指向 w3 m4a；整轨保持 tracks/<id>.mp3 ──
manifest = {"tracks": [], "words": {}, "bitrate": BITRATE, "rate": RATE, "gen": "w3-aac"}
missing = []
for t in tasks:
    items = []
    for rec in t["items"]:
        no, word, cn = rec[0], rec[1], rec[2]
        fn = word_file.get(word)
        if fn is None:
            missing.append(word)
            items.append({"no": no, "word": word, "cn": cn, "file": None})
        else:
            items.append({"no": no, "word": word, "cn": cn, "file": f"words/{fn}"})
    manifest["tracks"].append({
        "id": t["id"], "kind": t["kind"], "group": t["group"], "order": t["order"],
        "label": t["label"], "file": f"tracks/{t['id']}.mp3", "seconds": t["seconds"],
        "wordCount": t["wordCount"], "sections": t["sections"], "items": items,
    })
    for it in items:
        if it["file"]:
            manifest["words"][it["word"]] = it["file"]

json.dump(manifest, open(os.path.join(PUB, "manifest.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

m4 = [f for f in os.listdir(os.path.join(PUB, "words")) if f.endswith(".m4a")]
sz = sum(os.path.getsize(os.path.join(PUB, "words", f)) for f in m4)
print(f"manifest 已重写：{len(manifest['words'])} 词指向 m4a；缺音频 {len(set(missing))} 词")
print(f"w3 文件 {len(m4)} 个，共 {sz/1024/1024:.1f} MB（平均 {sz/max(1,len(m4))/1024:.1f} KB/词）")
if missing:
    print("缺音频词样例:", sorted(set(missing))[:10])
    sys.exit(1)
