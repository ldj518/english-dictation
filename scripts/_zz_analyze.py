# -*- coding: utf-8 -*-
"""滋滋声排查：线上音频文件硬分析（与合成一致的解码路径）。"""
import io, os, sys, hashlib
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PROBE = os.path.join(BASE, "scripts", "_zz_probe")
PUBW = os.path.join(BASE, "public", "audio", "words")
RATE = 24000

CASES = [
    ("message",  "4c538e581e99"),
    ("exam",     "afe497b031d3"),
    ("rush",     "d4a94eb21b12"),
    ("shine",    "08172b3ae3e2"),
    ("sunshine", "b0c2eb997d15"),
    ("Beth",     "1789b6e5f0e1"),
]


def decode(path_or_bytes):
    """与 build-audio-v3 相同的解码路径：AudioResampler flt mono 24k。"""
    if isinstance(path_or_bytes, bytes):
        src = av.open(io.BytesIO(path_or_bytes))
    else:
        src = av.open(path_or_bytes)
    res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    chunks = []
    with src as c:
        st = c.streams.audio[0]
        for fr in c.decode(st):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def band_energy(spec_db, freqs, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return float(spec_db[m].mean()) if m.any() else float("nan")


def analyze(tag, path):
    x = decode(path)
    n = x.size
    if n == 0:
        print(f"{tag}: EMPTY")
        return
    peak = float(np.abs(x).max())
    # 语音段 = |x| > 20% peak 的样本
    loud = np.abs(x) > 0.2 * peak
    rms_voice = float(np.sqrt(np.mean(x[loud] ** 2))) if loud.any() else 0.0
    quiet = np.abs(x) <= 0.02 * peak   # 近静音样本
    rms_noise = float(np.sqrt(np.mean(x[quiet] ** 2))) if quiet.sum() > 480 else float("nan")

    # 静音段频谱（取最安静的中间 1024 窗，看底噪频率形状）
    win = 1024
    q_idx = np.flatnonzero(np.abs(x) <= 0.02 * peak)
    if q_idx.size > win:
        c0 = q_idx[q_idx.size // 2] - win // 2
        c0 = max(0, min(c0, n - win))
        seg = x[c0:c0 + win]
        spec = np.abs(np.fft.rfft(seg * np.hanning(win))) ** 2
        spec_db = 10 * np.log10(spec + 1e-18)
        freqs = np.fft.rfftfreq(win, 1 / RATE)
        bands = [(0, 500), (500, 2000), (2000, 4000), (4000, 8000), (8000, 11000), (11000, 12000)]
        bl = ", ".join(f"{a}-{b}Hz:{band_energy(spec_db, freqs, a, b):.0f}" for a, b in bands)
    else:
        bl = "(静音段不足一个窗)"

    # pre-echo 探测：首个 onset（能量跃升沿）前 20ms 的 RMS vs 它前面 100ms 的 RMS
    env = np.abs(x)
    k = np.ones(240) / 240
    env_s = np.convolve(env, k, mode="same")
    th = 0.1 * peak
    onset = int(np.argmax(env_s > th)) if (env_s > th).any() else -1
    pre = ""
    if onset > 20 * RATE // 1000:
        pre20 = x[onset - 20 * RATE // 1000: onset]
        pre100 = x[max(0, onset - 120 * RATE // 1000): onset - 20 * RATE // 1000]
        r20 = float(np.sqrt(np.mean(pre20 ** 2)))
        r100 = float(np.sqrt(np.mean(pre100 ** 2))) if pre100.size else 0.0
        pre = f" pre20ms={20*np.log10(r20+1e-9):.0f}dBFS pre120-20ms={20*np.log10(r100+1e-9):.0f}dBFS"

    db = lambda v: (20 * np.log10(v + 1e-9)) if v and v == v else float("nan")
    print(f"{tag}: dur={n/RATE:.2f}s peak={db(peak):.1f}dBFS voiceRMS={db(rms_voice):.1f}dBFS "
          f"noiseRMS={db(rms_noise):.1f}dBFS SNR={db(rms_voice)-db(rms_noise):.1f}dB")
    print(f"    静音段频谱[{bl}]{pre}")


print("== 线上下载 vs 本地成品 ==")
for w, key in CASES:
    live = os.path.join(PROBE, key + ".m4a")
    loc = os.path.join(PUBW, key + ".m4a")
    h_live = hashlib.md5(open(live, "rb").read()).hexdigest()[:10] if os.path.exists(live) else "MISSING"
    h_loc = hashlib.md5(open(loc, "rb").read()).hexdigest()[:10] if os.path.exists(loc) else "MISSING"
    same = "SAME" if h_live == h_loc else f"DIFF live={h_live} local={h_loc}"
    print(f"-- {w} ({key}) {same}")
    if os.path.exists(live):
        analyze("  live ", live)
    if os.path.exists(loc) and h_live != h_loc:
        analyze("  local", loc)
