# -*- coding: utf-8 -*-
"""w6(线上现版) vs w7(谱减+双层门) 对比试听包（匿名标签，映射保密，用户验收后公布）。

输出（_deliver_audio/）：
  L1_message.wav / L2_message.wav   正常音量整词（一为 w6 一为 w7）
  L1_station.wav  / L2_station.wav  同上
  M1_词首底噪放大N倍.wav / M2_词首底噪放大N倍.wav
      station 词首 55ms 放大到 -3dBFS 循环 10 次（对齐上轮 C 文件做法）
      w6 与 w7 各自独立算增益，放大到同样响度——w6 应听到沙沙，w7 应接近纯静音
"""
import io, os, sys, json, hashlib, wave
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

# ── 匿名映射（内部备忘，验收后公布）──
# L1_message = w7   L2_message = w6
# L1_station = w6   L2_station = w7
# M1 = w6 放大      M2 = w7 放大


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
    win = np.hanning(N_FFT)
    n_frames = max(1, (x.size - N_FFT) // HOP + 1)
    idx = np.arange(n_frames)[:, None] * HOP + np.arange(N_FFT)[None, :]
    frames = x[np.clip(idx, 0, x.size - 1)]
    fe = ((frames * win) ** 2).sum(axis=1)
    order = np.argsort(fe)
    noise_frames = frames[order[: max(2, int(n_frames * 0.15))]]
    N_spec = np.mean([np.abs(np.fft.rfft(nf * win)) for nf in noise_frames], axis=0)

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

    # 双层门控：包络门 + 头尾固定硬门
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


def v7_process(word):
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                       audiogen.RATE_EN, word)).encode("utf-8")).hexdigest()
    with open(os.path.join(audiogen.CACHE, ck + ".mp3"), "rb") as f:
        raw = decode_mono_bytes(f.read())
    raw = raw - float(raw.mean())
    cut = trim_fade(raw)
    clean = denoise(cut)
    p = float(np.abs(clean).max())
    if p > 0:
        clean = clean * (NORM_PEAK / p)
    return clean


def w6_load(word, man):
    rel = man["words"][word]
    with wave.open(os.path.join(PUBW, os.path.basename(rel)), "rb") as wf:
        return np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def amplify_loop(pcm, peak_target_db=-3.0, loops=10, gap_ms=100):
    """词首 55ms 放大到目标峰值，循环拼接（段间真静音），返回 (波形, 原峰值dBFS, 放大倍数)"""
    seg = np.asarray(pcm[: int(0.055 * RATE)], np.float64)
    pk_db = 20 * np.log10(float(np.abs(seg).max()) + 1e-9)
    gain = 10 ** ((peak_target_db - pk_db) / 20)
    seg = seg * gain
    n = int(0.010 * RATE)  # 每段内首尾 10ms 淡入淡出，防循环接缝咔声
    if seg.size > 2 * n + 2:
        ramp = np.linspace(0.0, 1.0, n)
        seg[:n] *= ramp
        seg[-n:] *= ramp[::-1]
    gap = np.zeros(int(gap_ms / 1000 * RATE))
    parts = []
    for i in range(loops):
        parts.append(seg)
        if i < loops - 1:
            parts.append(gap)
    return np.concatenate(parts), pk_db, gain


def main():
    os.makedirs(OUTD, exist_ok=True)
    man = json.load(open(os.path.join(BASE, "public", "audio", "manifest.json"), encoding="utf-8"))

    # ── 正常音量整词对比（匿名 L1/L2）──
    mapping = {"message": {"L1": "w7", "L2": "w6"},
               "station": {"L1": "w6", "L2": "w7"}}
    for word, tags in mapping.items():
        w6 = w6_load(word, man)
        w7 = v7_process(word)
        for tag, src in tags.items():
            pcm = w7 if src == "w7" else w6
            path = os.path.join(OUTD, f"{tag}_{word}.wav")
            write_wav(path, pcm)
            print(f"{tag}_{word}.wav  <- {src}  时长={pcm.size/RATE:.2f}s")

    # ── 词首底噪放大对照（station，匿名 M1/M2）──
    w6s = w6_load("station", man)
    w7s = v7_process("station")
    for tag, pcm, src in [("M1", w6s, "w6"), ("M2", w7s, "w7")]:
        amp, pk_db, gain = amplify_loop(pcm)
        name = f"{tag}_词首底噪放大{gain:.0f}倍.wav"
        write_wav(os.path.join(OUTD, name), amp)
        print(f"{name}  <- {src}  原词首峰值={pk_db:.1f}dBFS  x{gain:.0f}  总时长={amp.size/RATE:.2f}s")

    print("\n试听包已生成:", OUTD)


if __name__ == "__main__":
    main()
