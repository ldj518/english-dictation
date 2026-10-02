# -*- coding: utf-8 -*-
"""增益假设验证包：原始 TTS 电平 vs 归一化后电平 vs w6 同款处理。

N1_原始电平   = 原始 mp3 解码直转 WAV，不动电平不裁不滤（对照，应与 T3 同感=干净）
N2_归一化0.6  = 原始 → trim(60ms pad) → 归一化 0.6（无滤波）
N3_w6同款     = 原始 → trim → FFT 低通 8.5-9.5k → 归一化 0.6（精确复刻 w6 路线）

结果矩阵：
  N1 净 N2 滋 → 归一化增益把底噪抬进可闻区（大音量外放）→ 降目标峰值/不归一化
  N2 净 N3 滋 → 低通振铃元凶 → 移除/软化低通
  全净 → 试听流程矛盾，重查 L 包
  全滋 → 外放喇叭宽频失真（纯音测不出），转设备端验证
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
TRIM_THRESH = 0.006
TRIM_PAD_MS = 60
FADE_MS = 10
LP_LO, LP_HI = 8500.0, 9500.0
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


def trim_fade(seg):
    x = np.asarray(seg, np.float32)
    x = x - float(x.mean())
    idx = np.flatnonzero(np.abs(x) > TRIM_THRESH)
    if idx.size == 0:
        return np.zeros(0, np.float32)
    pad = int(RATE * TRIM_PAD_MS / 1000)
    a, b = max(0, int(idx[0]) - pad), min(x.size, int(idx[-1]) + pad)
    out = x[a:b].copy()
    n = int(RATE * FADE_MS / 1000)
    if out.size > 2 * n + 2:
        w = np.linspace(0.0, 1.0, n)
        out[:n] *= w
        out[-n:] *= w[::-1]
    return out


def lowpass(x):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.size, 1 / RATE)
    g = np.ones_like(f)
    m = (f >= LP_LO) & (f <= LP_HI)
    g[m] = 0.5 * (1 + np.cos(np.pi * (f[m] - LP_LO) / (LP_HI - LP_LO)))
    g[f > LP_HI] = 0.0
    return np.fft.irfft(X * g, n=x.size).astype(np.float32)


def write_wav_raw(path, pcm, normalize):
    x = np.asarray(pcm, np.float64)
    if normalize:
        peak = float(np.abs(x).max())
        if peak > 0:
            x = x * (NORM_PEAK / peak)
    s16 = np.clip(np.round(x * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(RATE)
        wf.writeframes(s16.tobytes())


def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)


def peak_db(x):
    return 20 * np.log10(float(np.abs(np.asarray(x)).max()) + 1e-9)


def cache_src(word):
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                       audiogen.RATE_EN, word)).encode("utf-8")).hexdigest()
    with open(os.path.join(audiogen.CACHE, ck + ".mp3"), "rb") as f:
        return f.read()


for w in WORDS:
    raw = decode_mono_bytes(cache_src(w))
    raw = raw - float(raw.mean())
    cut = trim_fade(raw)
    lp = lowpass(cut)
    print(f"== {w} ==")
    print(f"   原始:  peak={peak_db(raw):6.1f}dBFS  语音RMS={rms_db(raw):6.1f}  时长={raw.size/RATE:.2f}s")
    g = NORM_PEAK / (10 ** (peak_db(cut) / 20)) if peak_db(cut) > -60 else 0
    print(f"   归一化增益（trim 后）: +{20*np.log10(max(g,1e-9)):.1f}dB")
    write_wav_raw(os.path.join(OUTD, f"N1_{w}_原始电平.wav"), raw, normalize=False)
    write_wav_raw(os.path.join(OUTD, f"N2_{w}_归一化0.6.wav"), cut, normalize=True)
    write_wav_raw(os.path.join(OUTD, f"N3_{w}_w6同款处理.wav"), lp, normalize=True)
print("\nN 系列试听包已生成:", OUTD)
