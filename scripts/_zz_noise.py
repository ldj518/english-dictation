# -*- coding: utf-8 -*-
"""底噪性质精细分析：Welch 谱 + 电源哼谱线检测 + 时域噪声轮廓。"""
import io, os, sys
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PROBE = os.path.join(BASE, "scripts", "_zz_probe")
RATE = 24000
CASES = [
    ("message",  "4c538e581e99"),
    ("exam",     "afe497b031d3"),
    ("shine",    "08172b3ae3e2"),
    ("Beth",     "1789b6e5f0e1"),
]


def decode(path):
    res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    chunks = []
    with av.open(path) as c:
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks)


for w, key in CASES:
    x = decode(os.path.join(PROBE, key + ".m4a"))
    peak = float(np.abs(x).max())
    # 全局能量包络，取最安静 15% 样本作为「纯底噪池」
    win = 480  # 20ms
    nwin = x.size // win
    env = np.sqrt((x[: nwin * win].reshape(nwin, win) ** 2).mean(axis=1))
    order = np.argsort(env)
    quiet_wins = order[: max(1, int(nwin * 0.15))]
    noise = np.concatenate([x[i * win : (i + 1) * win] for i in sorted(quiet_wins)])
    noise = noise - noise.mean()

    # Welch 谱（无窗重叠简化版）
    W = 1024
    segs = [noise[i : i + W] * np.hanning(W) for i in range(0, noise.size - W, W)]
    spec = np.mean([np.abs(np.fft.rfft(s)) ** 2 for s in segs], axis=0)
    spec_db = 10 * np.log10(spec + 1e-18)
    freqs = np.fft.rfftfreq(W, 1 / RATE)

    # 谱线检测：50/100/150/250 Hz 附近最近 bin
    lines = []
    for f0 in (50, 100, 150, 250):
        i = int(round(f0 / (RATE / W)))
        lines.append(f"{freqs[i]:.0f}Hz:{spec_db[i]:.0f}")
    # 宽带底噪水平（排除谱线）：中位
    med = np.median(spec_db[(freqs > 300) & (freqs < 11000)])

    print(f"== {w} ==")
    print(f"   纯底噪 RMS: {20*np.log10(np.sqrt((noise**2).mean())+1e-9):.1f} dBFS  样本 {noise.size/RATE*1000:.0f}ms")
    print(f"   谱线 300Hz-11kHz 中位: {med:.0f}dB   哼声谱线[{' '.join(lines)}]")
    # 频段能量
    for a, b in [(0, 300), (300, 1000), (1000, 4000), (4000, 8000), (8000, 11000)]:
        m = (freqs >= a) & (freqs < b)
        print(f"   {a:>5}-{b:<5}Hz: {spec_db[m].mean():7.0f} dB")
