# -*- coding: utf-8 -*-
"""v7 降噪算法原型验证：谱减 + 噪声门。指标：pad 段残余能量、语音保真。"""
import io, os, sys, hashlib, wave
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
PUBW = os.path.join(BASE, "public", "audio", "words")
OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/_deliver_audio"
RATE = 24000
NORM_PEAK = 0.6
N_FFT, HOP = 1024, 256
ALPHA, BETA = 2.5, 0.05
WORDS = ["shine", "message", "sunshine", "station"]


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


def denoise(x):
    """谱减 + 噪声门。输入去直流后的 PCM。"""
    win = np.hanning(N_FFT)
    # ── 噪声谱估计：能量最低 15% 帧（多为词头尾静音+气口）──
    n_frames = max(1, (x.size - N_FFT) // HOP + 1)
    idx = np.arange(n_frames)[:, None] * HOP + np.arange(N_FFT)[None, :]
    frames = x[np.clip(idx, 0, x.size - 1)]
    fe = (frames * win) ** 2 .sum(axis=1) if False else ((frames * win) ** 2).sum(axis=1)
    order = np.argsort(fe)
    noise_frames = frames[order[: max(2, int(n_frames * 0.15))]]
    N_spec = np.mean([np.abs(np.fft.rfft(nf * win)) for nf in noise_frames], axis=0)

    # ── STFT 谱减 ──
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

    # ── 双层门控 ──
    # (1) 包络门：10ms RMS 低于 -55dBFS 的区段压零（清气口与 pad 大部），5ms 平滑过渡
    env_win = int(0.010 * RATE)
    env = np.sqrt(np.convolve(y ** 2, np.ones(env_win) / env_win, mode="same"))
    g = (env > 0.0018).astype(np.float64)   # -55dBFS
    trans = int(0.005 * RATE)
    g = np.clip(np.convolve(g, np.ones(trans) / trans, mode="same"), 0, 1)
    # (2) 固定硬门：trim 边界已知（语音起点在 60ms 处），头尾各 50ms 确定性置零，10ms 线性过渡
    r = int(RATE * 10 / 1000)
    edge = int(RATE * 50 / 1000)
    g[:edge] = 0.0
    g[edge : edge + r] = np.minimum(g[edge : edge + r], np.linspace(0.0, 1.0, r))
    g[-edge:] = 0.0
    g[-edge - r : -edge] = np.minimum(g[-edge - r : -edge], np.linspace(1.0, 0.0, r))
    return (y * g).astype(np.float32)


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


def write_wav(path, pcm, rate=RATE):
    s16 = np.clip(np.round(np.asarray(pcm, np.float64) * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(rate)
        wf.writeframes(s16.tobytes())


def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)


man_words = None
import json
man = json.load(open(os.path.join(BASE, "public", "audio", "manifest.json"), encoding="utf-8"))

for w in WORDS:
    rel = man["words"].get(w)
    if not rel:
        print(f"[跳过] {w} 不在词库"); continue
    # 当前 w6 成品（线上在用）作为对照
    with wave.open(os.path.join(PUBW, os.path.basename(rel)), "rb") as wf:
        cur = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    # 一代源 → v7 处理
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                       audiogen.RATE_EN, w)).encode("utf-8")).hexdigest()
    with open(os.path.join(audiogen.CACHE, ck + ".mp3"), "rb") as f:
        src = f.read()
    raw = decode_mono_bytes(src)
    raw = raw - float(raw.mean())
    # 先 trim 定边界（原始信号上定，稳定），再降噪，最后淡入淡出
    cut = trim_fade(raw)
    clean = denoise(cut)   # 内部已含头尾硬门（替代独立淡入淡出）
    p = float(np.abs(clean).max())
    clean = clean * (NORM_PEAK / p) if p > 0 else clean
    # pad 段（开头 55ms）残余对比
    pad_cur = cur[: int(0.055 * RATE)]
    pad_new = clean[: int(0.055 * RATE)]
    print(f"== {w} ==")
    print(f"   w6现版: padRMS={rms_db(pad_cur):7.1f}dBFS  全段时长={cur.size/RATE:.2f}s")
    print(f"   v7新版: padRMS={rms_db(pad_new):7.1f}dBFS  全段时长={clean.size/RATE:.2f}s  "
          f"语音RMS={rms_db(clean):.1f}dBFS")
    write_wav(os.path.join(OUTD, f"V7_{w}.wav"), clean)
print("\nV7 试听文件已生成")
