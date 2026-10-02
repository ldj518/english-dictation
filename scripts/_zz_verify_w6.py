# -*- coding: utf-8 -*-
"""w6 验证：368 词全量反转度（8-11k 减 4-8k，应显著转负）+ 峰值/时长抽查。"""
import os, sys, json
import numpy as np
import wave

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUBW = os.path.join(BASE, "public", "audio", "words")
RATE = 24000

man = json.load(open(os.path.join(BASE, "public", "audio", "manifest.json"), encoding="utf-8"))
assert man["gen"] == "w6-wav", f"gen={man['gen']}"
words = man["words"]
print(f"gen={man['gen']} 词数={len(words)}")


def load(p):
    with wave.open(p, "rb") as wf:
        assert wf.getnchannels() == 1 and wf.getsampwidth() == 2 and wf.getframerate() == RATE
        raw = wf.readframes(wf.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def reversal(x):
    loud = np.abs(x) > 0.1 * float(np.abs(x).max())
    if loud.sum() < 4096:
        return None
    seg = x[loud]
    seg = seg[: (seg.size // 1024) * 1024].reshape(-1, 1024)[:64]
    spec = np.mean([np.abs(np.fft.rfft(s * np.hanning(1024))) ** 2 for s in seg], axis=0)
    sd = 10 * np.log10(spec + 1e-18)
    f = np.fft.rfftfreq(1024, 1 / RATE)
    return sd[(f >= 8000) & (f < 11000)].mean() - sd[(f >= 4000) & (f < 8000)].mean()


revs, peaks = [], []
for w, rel in words.items():
    x = load(os.path.join(PUBW, os.path.basename(rel)))
    r = reversal(x)
    if r is not None:
        revs.append(r)
    peaks.append(20 * np.log10(float(np.abs(x).max()) + 1e-9))

revs = np.array(revs)
peaks = np.array(peaks)
print(f"反转度: 均值={revs.mean():+.1f}dB  中位={np.median(revs):+.1f}dB  "
      f"最大={revs.max():+.1f}dB  正值个数={int((revs > 0).sum())}/{revs.size}")
print(f"峰值:   均值={peaks.mean():.1f}dBFS  范围=[{peaks.min():.1f}, {peaks.max():.1f}]")
# 重点词对比（诊断时 Ryan 的反转度：message≈+3.5 class≈+1.8 shine 等）
for w in ("shine", "message", "sunshine", "rush", "class"):
    rel = words.get(w)
    if rel:
        r = reversal(load(os.path.join(PUBW, os.path.basename(rel))))
        print(f"  {w}: {r:+.1f} dB")
ok = revs.mean() < -1 and (revs > 2).sum() == 0
print("结论:", "全部干净 ✓" if ok else "仍有异常，需复查")
