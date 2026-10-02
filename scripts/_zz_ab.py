# -*- coding: utf-8 -*-
"""A/B：手写 encode_m4a 循环 vs ffmpeg CLI 标准编码——验证编码器用法 bug。"""
import io, os, sys, subprocess, hashlib
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
TRIM_THRESH = 0.006
TRIM_PAD_MS = 60
FADE_MS = 10

CASES = ["message", "exam", "shine", "Beth"]


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
    idx = np.flatnonzero(np.abs(x) > TRIM_THRESH)
    if idx.size == 0:
        return np.zeros(0, np.float32)
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


def encode_manual(pcm, path):
    """复刻 build-audio-v3.py 的手写编码循环（含其 pts 逻辑）。"""
    x = np.asarray(pcm, dtype=np.float64)
    peak = float(np.abs(x).max())
    if peak > 0:
        x = x * (NORM_PEAK / peak)
    data = np.ascontiguousarray(x.astype(np.float32).reshape(1, -1))
    with av.open(path, "w", format="ipod") as c:
        st = c.add_stream("aac", rate=RATE, layout="mono")
        st.bit_rate = 96000
        pts = 0
        step = 4096
        for i in range(0, data.shape[1], step):
            blk = data[:, i : i + step]
            if blk.shape[1] == 0:
                continue
            f = av.AudioFrame.from_ndarray(np.ascontiguousarray(blk), format="fltp", layout="mono")
            f.rate = RATE
            f.pts = pts
            pts += blk.shape[1]
            for pkt in st.encode(f):
                c.mux(pkt)
        for pkt in st.encode(None):
            c.mux(pkt)


def encode_cli(pcm, path):
    """B 路：PyAV 标准喂法——帧严格 1024 样本（FFmpeg 原生 aac 的帧长），pts 按 1024 递增。"""
    x = np.asarray(pcm, dtype=np.float64)
    peak = float(np.abs(x).max())
    if peak > 0:
        x = x * (NORM_PEAK / peak)
    data = np.ascontiguousarray(x.astype(np.float32).reshape(1, -1))
    total = data.shape[1]
    pad = (-total) % 1024
    if pad:
        data = np.concatenate([data, np.zeros((1, pad), np.float32)], axis=1)
    with av.open(path, "w", format="ipod") as c:
        st = c.add_stream("aac", rate=RATE, layout="mono")
        st.bit_rate = 96000
        pts = 0
        step = 1024
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


def noise_report(tag, path):
    x = decode_any(path)
    peak = 20 * np.log10(float(np.abs(x).max()) + 1e-9)
    win = 480
    nwin = x.size // win
    env = np.sqrt((x[: nwin * win].reshape(nwin, win) ** 2).mean(axis=1))
    order = np.argsort(env)
    keep = sorted(order[: max(1, int(nwin * 0.15))])
    n = np.concatenate([x[i * win : (i + 1) * win] for i in keep])
    n = n - n.mean()
    segs = [n[i : i + W] * np.hanning(W) for i in range(0, max(0, n.size - W), W)]
    spec = np.mean([np.abs(np.fft.rfft(s)) ** 2 for s in segs], axis=0)
    spec_db = 10 * np.log10(spec + 1e-18)
    freqs = np.fft.rfftfreq(W, 1 / RATE)
    hum = [f"{int(round(f0/(RATE/W)))*(RATE/W):.0f}Hz:{spec_db[int(round(f0/(RATE/W)))]:.0f}" for f0 in (46.9, 93.75, 140.6)]
    med = np.median(spec_db[(freqs > 300) & (freqs < 11000)])
    rms = 20 * np.log10(np.sqrt((n ** 2).mean()) + 1e-9)
    print(f"{tag}: dur={x.size/RATE:.2f}s peak={peak:.1f}dBFS 噪池RMS={rms:7.1f}dBFS "
          f"帧率谐波[{' '.join(hum)}] 中位={med:.0f}dB")


for w in CASES:
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN, audiogen.RATE_EN, w)).encode("utf-8")).hexdigest()
    src = os.path.join(audiogen.CACHE, ck + ".mp3")
    if not os.path.exists(src):
        print(f"[缺缓存] {w}")
        continue
    pcm = trim_fade(decode_any(src))
    if pcm.size < RATE * 0.12:
        print(f"[过短] {w}")
        continue
    pa = os.path.join(OUTD, w + "_A_manual.m4a")
    pb = os.path.join(OUTD, w + "_B_cli.m4a")
    encode_manual(pcm, pa)
    encode_cli(pcm, pb)
    print(f"== {w} ==")
    noise_report("  手写循环", pa)
    noise_report("  ffmpegCLI", pb)
