# -*- coding: utf-8 -*-
"""对照：edge-tts 原始 mp3 源 vs w4 AAC 成品——定位 50Hz 哼声来源。"""
import io, os, sys, hashlib
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402  拿 SRC_FORMAT/VOICE_EN/RATE_EN/CACHE

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PROBE = os.path.join(BASE, "scripts", "_zz_probe")
RATE = 24000
W = 1024

CASES = [("message", "4c538e581e99"), ("exam", "afe497b031d3"),
         ("shine", "08172b3ae3e2"), ("Beth", "1789b6e5f0e1")]


def decode_bytes(b):
    res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    chunks = []
    with av.open(io.BytesIO(b)) as c:
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def decode(path):
    res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    chunks = []
    with av.open(path) as c:
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def noise_pool(x):
    """最安静 15% 的 20ms 窗拼成纯底噪池。"""
    win = 480
    nwin = x.size // win
    if nwin == 0:
        return x
    env = np.sqrt((x[: nwin * win].reshape(nwin, win) ** 2).mean(axis=1))
    order = np.argsort(env)
    keep = sorted(order[: max(1, int(nwin * 0.15))])
    return np.concatenate([x[i * win : (i + 1) * win] for i in keep])


def hum_report(tag, x):
    n = noise_pool(x)
    n = n - n.mean()
    segs = [n[i : i + W] * np.hanning(W) for i in range(0, max(0, n.size - W), W)]
    if not segs:
        print(f"{tag}: 底噪池不足")
        return
    spec = np.mean([np.abs(np.fft.rfft(s)) ** 2 for s in segs], axis=0)
    spec_db = 10 * np.log10(spec + 1e-18)
    freqs = np.fft.rfftfreq(W, 1 / RATE)
    bins = {}
    for f0 in (50, 100, 150, 200):
        i = int(round(f0 / (RATE / W)))
        bins[f0] = spec_db[i]
    med = np.median(spec_db[(freqs > 300) & (freqs < 11000)])
    low = spec_db[(freqs > 20) & (freqs < 300)].mean()
    rms = 20 * np.log10(np.sqrt((n ** 2).mean()) + 1e-9)
    print(f"{tag}: 噪池RMS={rms:6.1f}dBFS  50Hz={bins[50]:6.0f} 100Hz={bins[100]:6.0f} "
          f"150Hz={bins[150]:6.0f} 200Hz={bins[200]:6.0f}  20-300Hz均值={low:6.0f}  中位={med:6.0f}")


for w, key in CASES:
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN, audiogen.RATE_EN, w)).encode("utf-8")).hexdigest()
    src_path = os.path.join(audiogen.CACHE, ck + ".mp3")
    print(f"== {w} ==")
    if os.path.exists(src_path):
        hum_report("  原始mp3源", decode(src_path))
    else:
        print(f"  [缓存缺失] {src_path}")
    hum_report("  AAC成品  ", decode(os.path.join(PROBE, key + ".m4a")))
