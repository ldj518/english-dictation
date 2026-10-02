# -*- coding: utf-8 -*-
"""样本级差值实验：encode输入PCM vs 成品解码波形——量化编码+解码往返的真实噪声。"""
import os, sys, hashlib
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
OUTD = os.path.join(BASE, "scripts", "_zz_probe")
RATE = 24000
NORM_PEAK = 0.6
WORDS = ["message", "exam", "shine", "Beth"]


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


for w in WORDS:
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN, audiogen.RATE_EN, w)).encode("utf-8")).hexdigest()
    src = os.path.join(audiogen.CACHE, ck + ".mp3")
    pcm_in = trim_fade(decode_any(src))          # 编码链的输入（未归一化）
    # 编码时做了 peak→0.6 归一化；解码输出先对齐到同一增益
    dec = decode_any(os.path.join(OUTD, w + "_B_cli.m4a"))   # aac 成品解码
    g = float(np.abs(pcm_in).max())
    expected = pcm_in * (NORM_PEAK / g) if g > 0 else pcm_in

    # 互相关对齐（解码可能有 priming/padding 偏移）
    n = min(expected.size, dec.size) - 1
    if expected.size < 480 or dec.size < 480:
        print(f"{w}: too short")
        continue
    e0 = expected - expected.mean()
    d0 = dec - dec.mean()
    corr = np.correlate(d0[: n], e0[: n], mode="full")
    lag = int(np.argmax(np.abs(corr)) - (n - 1))
    print(f"== {w} == lag={lag} in={expected.size} out={dec.size}")
    # 对齐后做差（长度取交集）
    if lag >= 0:
        a, b = dec[lag:], expected
    else:
        a, b = dec, expected[-lag:]
    m = min(a.size, b.size)
    diff = a[:m] - b[:m]
    sig_rms = float(np.sqrt((b[:m] ** 2).mean()))
    dif_rms = float(np.sqrt((diff ** 2).mean()))
    # 分段看：静音段（|expected|<0.01）与语音段的往返噪声
    quiet = np.abs(b[:m]) < 0.01
    loud = ~quiet
    qr = float(np.sqrt((diff[:m][quiet] ** 2).mean())) if quiet.sum() > 100 else float("nan")
    lr = float(np.sqrt((diff[:m][loud] ** 2).mean())) if loud.sum() > 100 else float("nan")
    db = lambda v: 20 * np.log10(v + 1e-9)
    print(f"   信号RMS={db(sig_rms):.1f}dBFS  往返差RMS={db(dif_rms):.1f}dBFS  "
          f"SNR={db(sig_rms)-db(dif_rms):.1f}dB")
    print(f"   静音段往返噪声={db(qr):.1f}dBFS  语音段往返噪声={db(lr):.1f}dBFS  (静音样本 {quiet.mean()*100:.0f}%)")
