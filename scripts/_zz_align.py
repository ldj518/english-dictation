# -*- coding: utf-8 -*-
"""认知对齐试听包：
A_线上同款_24k.wav   —— shine w6 原样（24kHz，预期用户听到滋滋）
B_48kHz版.wav        —— 同一段高质量上采样到 48kHz（若设备重采样是根因，此版应干净）
C_词间底噪放大.wav    —— 词间静音段放大 3000 倍循环（听清底噪里到底是什么）
D_message_48kHz版.wav —— 另一词 48k 版（重复验证）
"""
import os, sys, wave
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUBW = os.path.join(BASE, "public", "audio", "words")
OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/_deliver_audio"
RATE = 24000
man = None


def read_manifest():
    import json
    global man
    man = json.load(open(os.path.join(BASE, "public", "audio", "manifest.json"), encoding="utf-8"))


def load_wav(path):
    with wave.open(path, "rb") as wf:
        assert wf.getframerate() == RATE and wf.getnchannels() == 1 and wf.getsampwidth() == 2
        raw = wf.readframes(wf.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def write_wav(path, pcm, rate=RATE):
    s16 = np.clip(np.round(np.asarray(pcm, np.float64) * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(s16.tobytes())


def upsample48(x):
    """24k→48k 整数 2x 高质量重采样（soxr）。"""
    res = av.AudioResampler(format="flt", layout="mono", rate=48000)
    fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(x.astype(np.float32).reshape(1, -1)),
                                    format="flt", layout="mono")
    fr.rate = RATE
    fr.pts = 0
    chunks = []
    for rf in res.resample(fr):
        chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    for rf in res.resample(None):
        chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def word_file(word):
    rel = man["words"][word]
    return os.path.join(PUBW, os.path.basename(rel))


read_manifest()
os.makedirs(OUTD, exist_ok=True)

for word in ("shine", "message"):
    x = load_wav(word_file(word))
    # A：24k 原样
    write_wav(os.path.join(OUTD, f"A_{word}_线上同款24k.wav"), x)
    # B：48k 上采样
    x48 = upsample48(x)
    write_wav(os.path.join(OUTD, f"B_{word}_48kHz版.wav"), x48, 48000)
    print(f"{word}: 24k {x.size/RATE:.2f}s -> 48k {x48.size/48000:.2f}s")

# C：静音段放大——取 shine 开头 60ms（词前 pad，原始 TTS 静音残余）
x = load_wav(word_file("shine"))
pad = x[: int(0.055 * RATE)]           # 55ms 静音
peak = float(np.abs(pad).max())
gain = 0.7 / max(peak, 1e-6)           # 放大到 -3dBFS
loud = np.clip(pad * gain, -0.9, 0.9)
gap = np.zeros(int(0.35 * RATE), np.float32)
seq = []
for i in range(10):
    seq.append(loud)
    seq.append(gap)
write_wav(os.path.join(OUTD, "C_词间底噪放大3000倍.wav"), np.concatenate(seq))
print(f"静音段: 原峰值={20*np.log10(peak+1e-9):.1f}dBFS 放大 {gain:.0f} 倍")
print("完成:")
for f in sorted(os.listdir(OUTD)):
    print("  ", f, os.path.getsize(os.path.join(OUTD, f)) // 1024, "KB")
