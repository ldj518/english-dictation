# -*- coding: utf-8 -*-
"""24k vs 48k 源对比：edge-tts 48kHz 格式可行性 + 高频段频谱对比。"""
import os, sys, io, asyncio, hashlib, inspect
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")

import edge_tts.communicate as _CM
OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation/scripts/_zz_probe"
WORDS = ["shine", "sunshine", "message"]
VOICE = "en-GB-RyanNeural"
RATE_EN = "-5%"


def build_comm(fmt: str):
    """按 audiogen 同款手法重编译 Communicate，替换输出格式字面量。"""
    src = inspect.getsource(_CM)
    old = '"audio-24khz-48kbitrate-mono-mp3"'
    if old not in src:
        return _CM.Communicate
    g = dict(_CM.__dict__)
    exec(compile(src.replace(old, '"%s"' % fmt), _CM.__file__, "exec"), g)
    return g["Communicate"]


async def synth(fmt, text):
    Comm = build_comm(fmt)
    c = Comm(text, VOICE, rate=RATE_EN)
    buf = bytearray()
    async for ch in c.stream():
        if ch["type"] == "audio":
            buf += ch["data"]
    return bytes(buf)


def decode_any(src_bytes, rate):
    res = av.AudioResampler(format="flt", layout="mono", rate=rate)
    chunks = []
    with av.open(io.BytesIO(src_bytes)) as c:
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def fricative_band(x, sr):
    """语音段（|x|>10%峰）的频段能量分布。"""
    loud = np.abs(x) > 0.1 * float(np.abs(x).max())
    if loud.sum() < 1024:
        return None
    seg = x[loud]
    seg = seg[: (seg.size // 1024) * 1024].reshape(-1, 1024)[:64]
    spec = np.mean([np.abs(np.fft.rfft(s * np.hanning(1024))) ** 2 for s in seg], axis=0)
    spec_db = 10 * np.log10(spec + 1e-18)
    freqs = np.fft.rfftfreq(1024, 1 / sr)
    out = {}
    for a, b in [(1000, 4000), (4000, 8000), (8000, 11000)]:
        m = (freqs >= a) & (freqs < b)
        out[f"{a}-{b}"] = spec_db[m].mean()
    return out


for w in WORDS:
    print(f"== {w} ==")
    b24 = asyncio.run(synth("audio-24khz-96kbitrate-mono-mp3", w))
    try:
        b48 = asyncio.run(synth("audio-48khz-96kbitrate-mono-mp3", w))
    except Exception as e:
        print(f"  48k 合成失败: {str(e)[:120]}")
        b48 = None
    x24 = decode_any(b24, 24000)
    print(f"  24k源: dur={x24.size/24000:.2f}s peak={20*np.log10(np.abs(x24).max()+1e-9):.1f}dB")
    if x24.size > 24000:
        s24 = fricative_band(x24, 24000)
        if s24:
            print("   语音段频谱:", "  ".join(f"{k}:{v:.0f}dB" for k, v in s24.items()))
    if b48:
        open(os.path.join(OUTD, w + "_48k.mp3"), "wb").write(b48)
        x48 = decode_any(b48, 48000)
        print(f"  48k源: dur={x48.size/48000:.2f}s peak={20*np.log10(np.abs(x48).max()+1e-9):.1f}dB")
        if x48.size > 48000:
            s48 = fricative_band(x48, 48000)
            if s48:
                print("   语音段频谱:", "  ".join(f"{k}:{v:.0f}dB" for k, v in s48.items()))
