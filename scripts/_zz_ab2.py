# -*- coding: utf-8 -*-
"""正确的编码 A/B：同一段原始 PCM（不 trim），编码往返前后用同窗口选择测噪。
   若往返后同位置噪池恶化 → 编码真引入噪声；一致 → 编码无辜，滋滋声在别处。"""
import os, sys, hashlib, io
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
OUTD = os.path.join(BASE, "scripts", "_zz_probe")
RATE = 24000
W = 1024
WORDS = ["message", "exam", "sunshine"]


def decode_any(src):
    res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    chunks = []
    with av.open(src) as c:
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def encode_aac(pcm, path):
    data = np.ascontiguousarray((np.asarray(pcm, np.float64) * 32767 / 32768).astype(np.float32).reshape(1, -1))
    pad = (-data.shape[1]) % 1024
    if pad:
        data = np.concatenate([data, np.zeros((1, pad), np.float32)], axis=1)
    with av.open(path, "w", format="ipod") as c:
        st = c.add_stream("aac", rate=RATE, layout="mono")
        st.bit_rate = 96000
        pts = 0
        for i in range(0, data.shape[1], 1024):
            blk = data[:, i : i + 1024]
            f = av.AudioFrame.from_ndarray(np.ascontiguousarray(blk), format="fltp", layout="mono")
            f.rate = RATE
            f.pts = pts
            pts += blk.shape[1]
            for pkt in st.encode(f):
                c.mux(pkt)
        for pkt in st.encode(None):
            c.mux(pkt)


def pool_rms(x, frac=0.15):
    win = 480
    nwin = x.size // win
    if nwin < 3:
        return float("nan"), None
    env = np.sqrt((x[: nwin * win].reshape(nwin, win) ** 2).mean(axis=1))
    keep = sorted(np.argsort(env)[: max(1, int(nwin * frac))])
    n = np.concatenate([x[i * win : (i + 1) * win] for i in keep])
    n = n - n.mean()
    return 20 * np.log10(np.sqrt((n ** 2).mean()) + 1e-9), keep


for w in WORDS:
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN, audiogen.RATE_EN, w)).encode("utf-8")).hexdigest()
    src = os.path.join(audiogen.CACHE, ck + ".mp3")
    raw = decode_any(src)          # 原始 PCM，不 trim
    p = os.path.join(OUTD, w + "_AB.m4a")
    encode_aac(raw, p)
    rt = decode_any(p)             # AAC 往返后
    # 对齐：往返输出有 priming 偏移，用互相关后在 ±2 样本精搜
    n = min(raw.size, rt.size) - 1
    c = np.correlate(rt[:n] - rt[:n].mean(), raw[:n] - raw[:n].mean(), mode="full")
    lag0 = int(np.argmax(c) - (n - 1))
    best, best_lag = 1e18, lag0
    for dl in range(lag0 - 3, lag0 + 4):
        if dl >= 0 and rt.size - dl >= raw.size:
            d = rt[dl : dl + raw.size] - raw
            v = float(np.sqrt((d ** 2).mean()))
            if v < best:
                best, best_lag = v, dl
    aligned = rt[best_lag : best_lag + raw.size]
    diff = aligned - raw
    r1, k1 = pool_rms(raw)
    r2, k2 = pool_rms(aligned)
    db = lambda v: 20 * np.log10(v + 1e-9)
    print(f"== {w} == lag={best_lag} 信号RMS={db(float(np.sqrt((raw**2).mean()))):.1f}dB")
    print(f"   原始PCM噪池={r1:.1f}dBFS   AAC往返后同测={r2:.1f}dBFS   "
          f"往返差(全长)={db(best):.1f}dBFS")
    # 同窗对比：用原始的安静窗位置在两个版本上取窗
    if k1 is not None and best_lag >= 0 and aligned.size >= raw.size:
        same_a = np.concatenate([aligned[i*480:(i+1)*480] for i in k1])
        same_r = np.concatenate([raw[i*480:(i+1)*480] for i in k1])
        d = same_a - same_a.mean() - (same_r - same_r.mean())
        print(f"   同窗原始={20*np.log10(np.sqrt((same_r**2).mean())+1e-9):.1f}dB  "
              f"同窗往返={20*np.log10(np.sqrt((same_a**2).mean())+1e-9):.1f}dB  "
              f"同窗差={20*np.log10(np.sqrt((d**2).mean())+1e-9):.1f}dBFS")
