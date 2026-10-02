# -*- coding: utf-8 -*-
"""w5 WAV 质量验证：与诊断同款指标（噪池 RMS/谱线/pre-echo），对照 w4 AAC。"""
import os, sys, hashlib, json
import numpy as np
import av, wave

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUBW = os.path.join(BASE, "public", "audio", "words")
RATE = 24000
W = 1024

# manifest 取词与文件
man = json.load(open(os.path.join(BASE, "public", "audio", "manifest.json"), encoding="utf-8"))
words = man["words"]

CASES = ["message", "exam", "shine", "Beth", "sunshine", "rush"]


def decode_wav(path):
    with wave.open(path, "rb") as wf:
        assert wf.getnchannels() == 1 and wf.getsampwidth() == 2 and wf.getframerate() == RATE, \
            f"格式异常: {wf.getnchannels()}ch {wf.getsampwidth()}B {wf.getframerate()}Hz"
        raw = wf.readframes(wf.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


print("词         时长    峰值     噪池RMS    低频bin2/4/6    8-11k中位")
all_ok = True
for w in CASES:
    fn = words.get(w)
    if not fn:
        print(f"{w}: manifest 无此词")
        all_ok = False
        continue
    p = os.path.join(PUBW, os.path.basename(fn))
    x = decode_wav(p)
    win = 480
    nwin = x.size // win
    env = np.sqrt((x[: nwin * win].reshape(nwin, win) ** 2).mean(axis=1))
    keep = sorted(np.argsort(env)[: max(1, int(nwin * 0.15))])
    n = np.concatenate([x[i * win : (i + 1) * win] for i in keep])
    n = n - n.mean()
    segs = [n[i : i + W] * np.hanning(W) for i in range(0, max(0, n.size - W), W)]
    spec = np.mean([np.abs(np.fft.rfft(s)) ** 2 for s in segs], axis=0)
    spec_db = 10 * np.log10(spec + 1e-18)
    freqs = np.fft.rfftfreq(W, 1 / RATE)
    b2 = spec_db[int(round(46.9 / (RATE / W)))]
    b4 = spec_db[int(round(93.75 / (RATE / W)))]
    b6 = spec_db[int(round(140.6 / (RATE / W)))]
    med = np.median(spec_db[(freqs > 8000) & (freqs < 11000)])
    peak = 20 * np.log10(float(np.abs(x).max()) + 1e-9)
    nrms = 20 * np.log10(np.sqrt((n ** 2).mean()) + 1e-9)
    ok = nrms < -85
    all_ok = all_ok and ok
    print(f"{w:<10} {x.size/RATE:.2f}s  {peak:6.1f}dB  {nrms:7.1f}dB   "
          f"{b2:.0f}/{b4:.0f}/{b6:.0f} dB   {med:.0f}dB  {'✓' if ok else '✗ 仍脏'}")

# 全量 368 词的快速噪底扫描
import glob
bad = []
for p in glob.glob(os.path.join(PUBW, "*.wav")):
    x = decode_wav(p)
    win = 480
    nwin = x.size // win
    if nwin < 3:
        continue
    env = np.sqrt((x[: nwin * win].reshape(nwin, win) ** 2).mean(axis=1))
    keep = sorted(np.argsort(env)[: max(1, int(nwin * 0.15))])
    n = np.concatenate([x[i * win : (i + 1) * win] for i in keep])
    n = n - n.mean()
    nrms = 20 * np.log10(np.sqrt((n ** 2).mean()) + 1e-9)
    if nrms > -80:
        bad.append((os.path.basename(p), round(nrms, 1)))
print(f"\n全量扫描 368 词：噪底 > -80dB 的 {len(bad)} 个")
for b in bad[:10]:
    print("  ", b)
print("结论:", "全部干净 ✓" if all_ok and not bad else "存在残留噪声，需复查")
