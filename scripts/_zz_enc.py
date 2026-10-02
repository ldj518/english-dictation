# -*- coding: utf-8 -*-
"""三连对照：ffprobe 实际码率 / lame 96k / 显式 codec_context.bit_rate 的 aac。"""
import os, sys, hashlib, json, subprocess
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
OUTD = os.path.join(BASE, "scripts", "_zz_probe")
RATE = 24000
W = 1024
NORM_PEAK = 0.6

WORDS = ["message", "exam"]


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


def trim_fade(seg):
    x = np.asarray(seg, dtype=np.float32)
    x = x - float(x.mean())
    idx = np.flatnonzero(np.abs(x) > 0.006)
    pad = int(RATE * 60 / 1000)
    a = max(0, int(idx[0]) - pad)
    b = min(x.size, int(idx[-1]) + pad)
    out = x[a:b].copy()
    n = int(RATE * 10 / 1000)
    if out.size > 2 * n + 2:
        w = np.linspace(0.0, 1.0, n)
        out[:n] *= w
        out[-n:] *= w[::-1]
    return out


def norm(x):
    x = np.asarray(x, dtype=np.float64)
    p = float(np.abs(x).max())
    return x * (NORM_PEAK / p) if p > 0 else x


def enc_1024(pcm, path, encoder="aac", bit_rate=96000, explicit=False):
    data = np.ascontiguousarray(norm(pcm).astype(np.float32).reshape(1, -1))
    fmt = None if encoder == "libmp3lame" else "ipod"
    step = 1152 if encoder == "libmp3lame" else 1024
    pad = (-data.shape[1]) % step
    if pad:
        data = np.concatenate([data, np.zeros((1, pad), np.float32)], axis=1)
    with av.open(path, "w", format=fmt) as c:
        st = c.add_stream(encoder, rate=RATE, layout="mono")
        if explicit:
            st.codec_context.bit_rate = bit_rate
        else:
            st.bit_rate = bit_rate
        pts = 0
        for i in range(0, data.shape[1], step):
            blk = data[:, i : i + step]
            f = av.AudioFrame.from_ndarray(np.ascontiguousarray(blk), format="fltp", layout="mono")
            f.rate = RATE
            f.pts = pts
            pts += blk.shape[1]
            for pkt in st.encode(f):
                c.mux(pkt)
        for pkt in st.encode(None):
            c.mux(pkt)


def report(tag, path):
    x = decode_any(path)
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
    hum = " ".join(f"{freqs[int(round(f0/(RATE/W)))]:.0f}Hz:{spec_db[int(round(f0/(RATE/W)))]:.0f}" for f0 in (2, 4, 6))
    med = np.median(spec_db[(freqs > 300) & (freqs < 11000)])
    rms = 20 * np.log10(np.sqrt((n ** 2).mean()) + 1e-9)
    # 实际码率
    try:
        pj = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", path],
                            capture_output=True, text=True)
        meta = json.loads(pj.stdout or "{}")
        br = meta.get("streams", [{}])[0].get("bit_rate", "?")
        prof = meta.get("streams", [{}])[0].get("profile", "?")
    except Exception:
        br, prof = "?", "?"
    print(f"{tag}: codec={os.path.basename(path).split('.')[-1]}/{prof} bit_rate={br} "
          f"噪池={rms:7.1f}dBFS 帧率谐波[{hum}] 中位={med:.0f}dB")


for w in WORDS:
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN, audiogen.RATE_EN, w)).encode("utf-8")).hexdigest()
    src = os.path.join(audiogen.CACHE, ck + ".mp3")
    pcm = trim_fade(decode_any(src))
    print(f"== {w} ==")
    report("  原始源mp3      ", src)
    p1 = os.path.join(OUTD, w + "_aac_st.m4a");   enc_1024(pcm, p1, "aac", 96000, False)
    report("  aac st.bit_rate", p1)
    p2 = os.path.join(OUTD, w + "_aac_cc.m4a");   enc_1024(pcm, p2, "aac", 96000, True)
    report("  aac codec_ctx  ", p2)
    p3 = os.path.join(OUTD, w + "_lame.mp3")
    try:
        enc_1024(pcm, p3, "libmp3lame", 96000, False)
        report("  lame 96k       ", p3)
    except Exception as e:
        print(f"  lame 96k: FAILED {e}")
    p4 = os.path.join(OUTD, w + "_aac128.m4a")
    try:
        enc_1024(pcm, p4, "aac", 128000, False)
        report("  aac 128k       ", p4)
    except Exception as e:
        print(f"  aac 128k: FAILED {e}")
    p5 = os.path.join(OUTD, w + "_lame192.mp3")
    try:
        enc_1024(pcm, p5, "libmp3lame", 192000, False)
        report("  lame 192k      ", p5)
    except Exception as e:
        print(f"  lame 192k: FAILED {e}")
