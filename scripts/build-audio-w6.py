# -*- coding: utf-8 -*-
"""w6 音频重制（滋滋声终治）：Ryan 原声音色 + 9kHz 低通降杂 + s16 WAV。

根因（2026-10-02 实锤）：en-GB-RyanNeural 的擦音在 8-11kHz 有镜像杂讯
（语音段频谱反转度 +3.5dB，自然衰减应为负值），每个词的 s/sh/ts 都带
「滋」声。四代重制（编码/码率/归一化）均无效，因为病根在 TTS 源内容。

修法（用户选定：保留原声音色 + 降杂）：
  一代源 → 解码 → 裁静音+淡入淡出 → **FFT 域低通（8.5-9.5kHz 余弦滚降）**
  → 峰值 0.6 归一 → s16 WAV。伪影频段被确定性移除，音色/清晰度基本不变
  （s 擦音主体能量在 4-8kHz，保留完整）。
  文件名 md5("w6:"+word)[:12] + ".wav"，破全部缓存。
"""
import io, json, os, sys, hashlib, wave
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUB = os.path.join(BASE, "public", "audio")
DATA = os.path.join(BASE, "src", "data")

sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

RATE = 24000
NORM_PEAK = 0.6
TRIM_THRESH = 0.006
TRIM_PAD_MS = 60
FADE_MS = 10
LP_LO, LP_HI = 8500.0, 9500.0   # 低通过渡带


def key_of(word: str) -> str:
    return hashlib.md5(("w6:" + word).encode("utf-8")).hexdigest()[:12]


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


def lowpass(x):
    """FFT 域低通：8.5-9.5kHz 余弦滚降到 0，零相位，确定性消除高频镜像。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.size, 1 / RATE)
    g = np.ones_like(f)
    m = (f >= LP_LO) & (f <= LP_HI)
    g[m] = 0.5 * (1 + np.cos(np.pi * (f[m] - LP_LO) / (LP_HI - LP_LO)))
    g[f > LP_HI] = 0.0
    return np.fft.irfft(X * g, n=x.size).astype(np.float32)


def write_wav(pcm_f32, path):
    x = np.asarray(pcm_f32, dtype=np.float64)
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak > 0:
        x = x * (NORM_PEAK / peak)
    s16 = np.clip(np.round(x * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(s16.tobytes())


# ── 主流程 ──────────────────────────────────────────────────────
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

word_file, bad = {}, []
for w in words:
    if w not in src_bytes:
        bad.append(w)
        continue
    fn = key_of(w) + ".wav"
    p = os.path.join(PUB, "words", fn)
    try:
        clean = trim_fade(decode_mono_bytes(src_bytes[w]))
        if clean.size < RATE * 0.12:
            print(f"  [短] {w} {clean.size/RATE:.2f}s")
            bad.append(w)
            continue
        write_wav(lowpass(clean), p)
        word_file[w] = fn
    except Exception as e:  # noqa: BLE001
        print(f"  [错] {w}: {e}")
        bad.append(w)

print(f"WAV 完成 {len(word_file)} / 失败 {len(bad)}")
if bad:
    print("失败词样例:", bad[:10])

manifest = {"tracks": [], "words": {}, "bitrate": 0, "rate": RATE, "gen": "w6-wav"}
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

wv = [f for f in os.listdir(os.path.join(PUB, "words")) if f.endswith(".wav")]
sz = sum(os.path.getsize(os.path.join(PUB, "words", f)) for f in wv)
print(f"manifest 已重写：{len(manifest['words'])} 词指向 wav；缺音频 {len(set(missing))} 词")
print(f"w6 文件 {len(wv)} 个，共 {sz/1024/1024:.1f} MB（平均 {sz/max(1,len(wv))/1024:.1f} KB/词）")
if missing:
    print("缺音频词样例:", sorted(set(missing))[:10])
    sys.exit(1)
