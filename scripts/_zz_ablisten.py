# -*- coding: utf-8 -*-
"""滋滋声试听对比包：同词 × 4 版本拼 WAV。
版本顺序：① Ryan 现用（线上同款）② Ryan+9kHz低通 ③ Andrew ④ Ana
处理链统一：trim_fade + 峰值 0.6 归一 → s16 WAV。段间 0.9s 静音。"""
import os, sys, io, asyncio, inspect, wave, hashlib
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import edge_tts.communicate as _CM  # noqa: E402
import audiogen  # noqa: E402  用它的 CACHE 取 Ryan 缓存

BASE = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation"
OUTD = os.path.join(BASE, "scripts", "_zz_probe")
RATE = 24000
WORDS = ["shine", "message", "sunshine"]
GAP = int(0.9 * RATE)
NORM = 0.6


def build_comm():
    src = inspect.getsource(_CM)
    old = '"audio-24khz-48kbitrate-mono-mp3"'
    g = dict(_CM.__dict__)
    exec(compile(src.replace(old, '"audio-24khz-96kbitrate-mono-mp3"'), _CM.__file__, "exec"), g)
    return g["Communicate"]


async def synth_retry(Comm, text, voice, tries=4):
    for i in range(tries):
        try:
            c = Comm(text, voice, rate="-5%")
            buf = bytearray()
            async for ch in c.stream():
                if ch["type"] == "audio":
                    buf += ch["data"]
            if len(buf) > 1000:
                return bytes(buf)
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(2.0 * (i + 1))
    return None


def decode(b):
    res = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    chunks = []
    with av.open(io.BytesIO(b)) as c:
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def trim_fade(seg):
    x = np.asarray(seg, np.float32)
    x = x - float(x.mean())
    idx = np.flatnonzero(np.abs(x) > 0.006)
    if idx.size == 0:
        return np.zeros(0, np.float32)
    pad = int(RATE * 60 / 1000)
    a, b2 = max(0, int(idx[0]) - pad), min(x.size, int(idx[-1]) + pad)
    out = x[a:b2].copy()
    n = int(RATE * 10 / 1000)
    if out.size > 2 * n + 2:
        w = np.linspace(0.0, 1.0, n)
        out[:n] *= w
        out[-n:] *= w[::-1]
    return out


def norm(x):
    x = np.asarray(x, np.float64)
    p = float(np.abs(x).max())
    return x * (NORM / p) if p > 0 else x


def lowpass_fft(x, cutoff=9000.0):
    """FFT 域砖墙+余弦过渡低通（8.5-9.5kHz 平滑滚降，零相位）。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.size, 1 / RATE)
    g = np.ones_like(f)
    lo, hi = 8500.0, 9500.0
    m = (f >= lo) & (f <= hi)
    g[m] = 0.5 * (1 + np.cos(np.pi * (f[m] - lo) / (hi - lo)))
    g[f > hi] = 0.0
    return np.fft.irfft(X * g, n=x.size).astype(np.float32)


def ryan_cache(word):
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                       audiogen.RATE_EN, word)).encode("utf-8")).hexdigest()
    p = os.path.join(audiogen.CACHE, ck + ".mp3")
    return open(p, "rb").read() if os.path.exists(p) else None


def write_wav(path, pcm):
    s16 = np.clip(np.round(np.asarray(pcm, np.float64) * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(RATE)
        wf.writeframes(s16.tobytes())


async def main():
    Comm = build_comm()
    need = {}
    for w in WORDS:
        for v in ("en-US-AndrewNeural", "en-US-AnaNeural"):
            need[(w, v)] = None
    # 先查已有 48k 测试产物之外的新缓存？无缓存则联网
    for (w, v) in need:
        need[(w, v)] = await synth_retry(Comm, w, v)
        print(f"合成 {w}×{v}: {'OK' if need[(w,v)] else 'FAIL'}")

    for w in WORDS:
        rb = ryan_cache(w)
        parts = []
        labels = []
        if rb:
            x = norm(trim_fade(decode(rb)))
            parts.append(x); labels.append("Ryan现用")
            xl = norm(lowpass_fft(trim_fade(decode(rb))))
            parts.append(xl); labels.append("Ryan+低通9k")
        for v, tag in (("en-US-AndrewNeural", "Andrew"), ("en-US-AnaNeural", "Ana")):
            b = need.get((w, v))
            if b:
                parts.append(norm(trim_fade(decode(b)))); labels.append(tag)
        # 拼接
        out, gap = [], np.zeros(GAP, np.float32)
        for i, seg in enumerate(parts):
            if i:
                out.append(gap)
            out.append(seg)
        wav = np.concatenate(out)
        p = os.path.join(OUTD, f"AB_{w}.wav")
        write_wav(p, wav)
        dur = wav.size / RATE
        print(f"{w}: {p}  {dur:.1f}s  顺序={labels}")


asyncio.run(main())
