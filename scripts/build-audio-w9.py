# -*- coding: utf-8 -*-
"""w9 音频重制（滋滋声真根治）：原始 mp3 帧级裁剪直出，零解码进成品、零重编码。

根因（2026-10-02 E 系列实验实锤，用户三轮耳朵交叉验证）：
  w4 以来所有代际滋滋的来源不是 TTS 内容、不是编码格式、不是播放链路，
  而是 **PyAV(ffmpeg mp3float) 解码环节引入的可闻伪影**——同一份原始 mp3
  直接播放干净，凡经过该解码的 PCM（WAV 直出 / 谱减+门 / 重编码 mp3）一律滋滋。

修法（用户耳朵验收通过：E8 形态）：
  原始缓存 mp3 → 解析 mp3 帧边界（纯字节操作，不解码）
  → PyAV 仅用于定位语音起止样本（PCM 不进成品）
  → 按帧号切掉头尾静音帧 → 原样字节拼接直出。
  24kHz/96kbps MPEG-2 L3：每帧 576 样本 / 288±1 字节；裁剪误差 ±1 帧(24ms) 无感。
  文件名 md5("w9:"+word)[:12] + ".mp3"，约 8.5KB/词（w6 WAV 的 1/4）。
  manifest gen = "w9-trim-mp3"。
"""
import io, json, os, sys, hashlib
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUB = os.path.join(BASE, "public", "audio")
DATA = os.path.join(BASE, "src", "data")

sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

RATE = 24000
SAMPLES_PER_FRAME = 576          # MPEG-2 LSF Layer III
TRIM_THRESH = 0.006
TRIM_PAD_MS = 60
DUR_MIN, DUR_MAX = 0.30, 3.20    # 裁剪后合理时长区间（s；多词短语可到 2-3s）
BR_TABLE = {2: 8, 3: 16, 4: 24, 5: 32, 6: 40, 7: 56, 8: 64, 9: 80,
            10: 96, 11: 112, 12: 128, 13: 144, 14: 160}   # MPEG-2 L3 kbps


def key_of(word: str) -> str:
    return hashlib.md5(("w9:" + word).encode("utf-8")).hexdigest()[:12]


def mp3_frames(b: bytes):
    """解析 mp3 帧边界，返回 [(start, end), ...]。仅按帧头同步字扫描，不解码。"""
    frames, i, n = [], 0, len(b)
    while i < n - 4:
        if b[i] == 0xFF and (b[i + 1] & 0xE0) == 0xE0:
            ver = (b[i + 1] >> 3) & 3
            layer = (b[i + 1] >> 1) & 3
            br_i = (b[i + 2] >> 4) & 0xF
            sr_i = (b[i + 2] >> 2) & 3
            pad = (b[i + 2] >> 1) & 1
            if layer != 1 or br_i in (0, 15) or sr_i == 3:
                i += 1; continue
            br = BR_TABLE.get(br_i)
            if br is None:
                i += 1; continue
            flen = 72 * br * 1000 // RATE + pad
            if i + flen > n:
                break
            frames.append((i, i + flen))
            i += flen
        else:
            i += 1
    return frames


def voice_bounds(mp3_bytes: bytes):
    """PyAV 解码全长，返回 (语音起点样本, 语音终点样本, 总样本数)。PCM 不进成品。"""
    chunks = []
    with av.open(io.BytesIO(mp3_bytes)) as c:
        for fr in c.decode(c.streams.audio[0]):
            chunks.append(fr.to_ndarray()[0].copy())
    x = np.concatenate(chunks).astype(np.float32)
    x = x - float(x.mean())
    idx = np.flatnonzero(np.abs(x) > TRIM_THRESH)
    if idx.size == 0:
        return None
    return int(idx[0]), int(idx[-1]), int(x.size)


def trim_mp3(mp3_bytes: bytes, frames, f0: int, f1: int) -> bytes:
    f0 = max(0, f0)
    f1 = min(len(frames) - 1, f1)
    return b"".join(mp3_bytes[a:b] for a, b in frames[f0: f1 + 1])


def verify_wav_duration(mp3_bytes: bytes) -> float:
    with av.open(io.BytesIO(mp3_bytes)) as c:
        st = c.streams.audio[0]
        return float(st.duration * st.time_base) if st.duration else 0.0


# ── 主流程 ──────────────────────────────────────────────
tasks = json.load(open(os.path.join(DATA, "tasks.json"), encoding="utf-8"))
seen, words = set(), []
for t in tasks:
    for it in t["items"]:
        w = it[1]
        if w.lower() in seen:
            continue
        seen.add(w.lower())
        words.append(w)
print(f"去重词数 {len(words)}")

src_bytes, missing_src = {}, []
for w in words:
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                       audiogen.RATE_EN, w)).encode("utf-8")).hexdigest()
    p = os.path.join(audiogen.CACHE, ck + ".mp3")
    if os.path.exists(p) and os.path.getsize(p) > 500:
        with open(p, "rb") as f:
            src_bytes[w] = f.read()
    else:
        missing_src.append(w)
print(f"缓存命中 {len(src_bytes)} / 需联网补 {len(missing_src)}")
if missing_src:
    got = audiogen.synth(missing_src, [])
    for w in missing_src:
        mp3 = got.get((w, "en"))
        if not mp3:
            print(f"  [缺源] {w}")
            continue
        src_bytes[w] = mp3

os.makedirs(os.path.join(PUB, "words"), exist_ok=True)
word_file, bad = {}, []
total_bytes = 0
for w in words:
    if w not in src_bytes:
        bad.append(w)
        continue
    src = src_bytes[w]
    frames = mp3_frames(src)
    vb = voice_bounds(src)
    ok = bool(frames) and vb is not None
    if ok:
        i0, i1, total = vb
        f0 = max(0, (i0 - RATE * TRIM_PAD_MS // 1000) // SAMPLES_PER_FRAME)
        f1 = (i1 + RATE * TRIM_PAD_MS // 1000) // SAMPLES_PER_FRAME + 1
        out = trim_mp3(src, frames, f0, f1)
        dur = verify_wav_duration(out)
        ok = (len(frames) >= 10 and DUR_MIN <= dur <= DUR_MAX)
    if not ok:
        print(f"  [坏] {w}: 帧={len(frames)} 边界={vb}")
        bad.append(w)
        continue
    fn = key_of(w) + ".mp3"
    with open(os.path.join(PUB, "words", fn), "wb") as f:
        f.write(out)
    total_bytes += len(out)
    word_file[w] = fn

print(f"mp3 裁剪完成 {len(word_file)} / 失败 {len(bad)}  共 {total_bytes/1024/1024:.1f} MB "
      f"(平均 {total_bytes/max(1,len(word_file))/1024:.1f} KB/词)")
if bad:
    print("失败词样例:", bad[:10])

manifest = {"tracks": [], "words": {}, "bitrate": 96, "rate": RATE, "gen": "w9-trim-mp3"}
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
print(f"manifest 已重写：{len(manifest['words'])} 词指向 w9 mp3；缺音频 {len(set(missing))} 词")
if missing:
    print("缺音频词样例:", sorted(set(missing))[:10])
    sys.exit(1)
