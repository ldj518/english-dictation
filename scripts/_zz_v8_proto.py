# -*- coding: utf-8 -*-
"""v8 原型：全长噪声谱估计的谱减 + 双层门。

v7 失灵根因假设：噪声谱取自 trim 后 0.7s 信号（最静帧=词内气口），
电平远低于语音段内嘶声 → 减除量不足。
v8：用原始 2.2s 全长（含 1.35s 纯静音）估噪声谱，再对 trim 后语音段谱减。

输出：
  测量：原始静音段 vs 语音段的分频带电平（验证嘶声假设）
  试听：V8_station.wav / V8_message.wav（归一化 0.6，与 N1 同响度可对比）
"""
import io, os, sys, hashlib, wave
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/_deliver_audio"
RATE = 24000
NORM_PEAK = 0.6
N_FFT, HOP = 1024, 256
ALPHA, BETA = 3.0, 0.02
NOISE_Q = 0.25          # 全长帧中能量最低 25% 进噪声谱
WORDS = ["station", "message"]


def decode_mono_bytes(mp3_bytes):
    with av.open(io.BytesIO(mp3_bytes)) as c:
        res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
        chunks = []
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def cache_src(word):
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                       audiogen.RATE_EN, word)).encode("utf-8")).hexdigest()
    with open(os.path.join(audiogen.CACHE, ck + ".mp3"), "rb") as f:
        return f.read()


def trim_fade(seg):
    x = np.asarray(seg, np.float32)
    x = x - float(x.mean())
    idx = np.flatnonzero(np.abs(x) > 0.006)
    if idx.size == 0:
        return np.zeros(0, np.float32)
    pad = int(RATE * 60 / 1000)
    a, b = max(0, int(idx[0]) - pad), min(x.size, int(idx[-1]) + pad)
    out = x[a:b].copy()
    n = int(RATE * 10 / 1000)
    if out.size > 2 * n + 2:
        w = np.linspace(0.0, 1.0, n)
        out[:n] *= w
        out[-n:] *= w[::-1]
    return out


def frames_of(x):
    win = np.hanning(N_FFT)
    n_frames = max(1, (x.size - N_FFT) // HOP + 1)
    idx = np.arange(n_frames)[:, None] * HOP + np.arange(N_FFT)[None, :]
    fr = x[np.clip(idx, 0, x.size - 1)]
    return fr, win


def estimate_noise_spec(x_full):
    """全长信号帧中能量最低 25% 的平均幅度谱（真实静音底噪）。"""
    fr, win = frames_of(x_full)
    fe = ((fr * win) ** 2).sum(axis=1)
    order = np.argsort(fe)
    take = fr[order[: max(4, int(fr.shape[0] * NOISE_Q))]]
    return np.mean([np.abs(np.fft.rfft(nf * win)) for nf in take], axis=0)


def spectral_gate(x, N_spec):
    """谱减（过减+低floor）+ 双层门（包络门 + 头尾固定硬门）。"""
    fr, win = frames_of(x)
    n_frames = fr.shape[0]
    out = np.zeros(x.size + N_FFT, np.float64)
    wsum = np.zeros(x.size + N_FFT, np.float64)
    for i in range(n_frames):
        seg = x[i * HOP : i * HOP + N_FFT]
        if seg.size < N_FFT:
            seg = np.pad(seg, (0, N_FFT - seg.size))
        X = np.fft.rfft(seg * win)
        mag = np.abs(X) - ALPHA * N_spec
        mag = np.maximum(mag, BETA * N_spec)
        y = np.fft.irfft(mag * np.exp(1j * np.angle(X)), n=N_FFT) * win
        out[i * HOP : i * HOP + N_FFT] += y
        wsum[i * HOP : i * HOP + N_FFT] += win ** 2
    y = out[: x.size] / np.maximum(wsum[: x.size], 1e-9)

    env_win = int(0.010 * RATE)
    env = np.sqrt(np.convolve(y ** 2, np.ones(env_win) / env_win, mode="same"))
    g = (env > 0.0018).astype(np.float64)
    trans = int(0.005 * RATE)
    g = np.clip(np.convolve(g, np.ones(trans) / trans, mode="same"), 0, 1)
    r = int(RATE * 10 / 1000)
    edge = int(RATE * 50 / 1000)
    g[:edge] = 0.0
    g[edge : edge + r] = np.minimum(g[edge : edge + r], np.linspace(0.0, 1.0, r))
    g[-edge:] = 0.0
    g[-edge - r : -edge] = np.minimum(g[-edge - r : -edge], np.linspace(1.0, 0.0, r))
    return (y * g).astype(np.float32)


def band_rms_db(x, f_lo, f_hi):
    x = np.asarray(x, np.float64)
    X = np.fft.rfft(x * np.hanning(x.size))
    f = np.fft.rfftfreq(x.size, 1 / RATE)
    m = (f >= f_lo) & (f < f_hi)
    p = np.sqrt((np.abs(X[m]) ** 2).mean()) / x.size
    return 20 * np.log10(p + 1e-12)


def rms_db(x):
    return 20 * np.log10(np.sqrt((np.asarray(x) ** 2).mean()) + 1e-9)


def write_wav(path, pcm):
    s16 = np.clip(np.round(np.asarray(pcm, np.float64) * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(RATE)
        wf.writeframes(s16.tobytes())


for w in WORDS:
    raw = decode_mono_bytes(cache_src(w))
    raw = raw - float(raw.mean())
    cut = trim_fade(raw)
    N_spec = estimate_noise_spec(raw)
    dn = spectral_gate(cut, N_spec)
    p = float(np.abs(dn).max())
    clean = dn * (NORM_PEAK / p) if p > 0 else dn

    # 嘶声假设验证：原始静音段（去头去尾各取 0.4s）vs 语音段（trim 中心 0.5s）分频带
    mid = cut[int(0.06 * RATE) : int(0.06 * RATE) + int(0.5 * RATE)]
    head = raw[: int(0.4 * RATE)]
    tail = raw[-int(0.4 * RATE):]
    print(f"== {w} ==  原始全长 {raw.size/RATE:.2f}s  trim后 {cut.size/RATE:.2f}s")
    print(f"   频带电平(dB, 同窗可比)      静音头   语音段   静音尾")
    for lo, hi, tag in [(1000, 4000, "1-4k "), (4000, 8000, "4-8k "),
                        (8000, 12000, "8-12k")]:
        print(f"   {tag}:  {band_rms_db(head, lo, hi):7.1f} {band_rms_db(mid, lo, hi):8.1f} "
              f"{band_rms_db(tail, lo, hi):8.1f}")
    print(f"   v8: padRMS={rms_db(clean[:int(0.055*RATE)]):7.1f}dBFS  "
          f"语音RMS={rms_db(clean):.1f}dBFS  时长={clean.size/RATE:.2f}s")
    write_wav(os.path.join(OUTD, f"V8_{w}.wav"), clean)
print("\nV8 试听文件已生成:", OUTD)
