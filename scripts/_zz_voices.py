# -*- coding: utf-8 -*-
"""voice 普测：候选音色合成擦音词，量化「高频反转度」（8-11k 减 4-8k，越小越干净）。"""
import os, sys, io, asyncio, inspect
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import edge_tts.communicate as _CM  # noqa: E402

OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation/scripts/_zz_probe"
WORDS = ["shine", "message", "rush"]
RATE_EN = "-5%"

VOICES = [
    ("en-GB-RyanNeural", "现用·英音男"),
    ("en-US-AnaNeural", "童声女"),
    ("en-US-JennyNeural", "美音女"),
    ("en-US-AriaNeural", "美音女"),
    ("en-US-AndrewNeural", "美音男"),
    ("en-US-GuyNeural", "美音男"),
    ("en-GB-SoniaNeural", "英音女"),
    ("en-GB-LibbyNeural", "英音女"),
    ("en-AU-NatashaNeural", "澳音女"),
]


def build_comm():
    src = inspect.getsource(_CM)
    old = '"audio-24khz-48kbitrate-mono-mp3"'
    g = dict(_CM.__dict__)
    exec(compile(src.replace(old, '"audio-24khz-96kbitrate-mono-mp3"'), _CM.__file__, "exec"), g)
    return g["Communicate"]


async def synth(Comm, text, voice):
    c = Comm(text, voice, rate=RATE_EN)
    buf = bytearray()
    async for ch in c.stream():
        if ch["type"] == "audio":
            buf += ch["data"]
    return bytes(buf)


def decode(b, rate=24000):
    res = av.AudioResampler(format="flt", layout="mono", rate=rate)
    chunks = []
    with av.open(io.BytesIO(b)) as c:
        for fr in c.decode(c.streams.audio[0]):
            for rf in res.resample(fr):
                chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
        for rf in res.resample(None):
            chunks.append(np.frombuffer(rf.planes[0], dtype=np.float32).copy())
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def reversal(x):
    """语音段频谱反转度 = mean(8-11kHz) - mean(4-8kHz)。自然衰减为负值。"""
    loud = np.abs(x) > 0.1 * float(np.abs(x).max())
    if loud.sum() < 4096:
        return None
    seg = x[loud]
    seg = seg[: (seg.size // 1024) * 1024].reshape(-1, 1024)[:64]
    spec = np.mean([np.abs(np.fft.rfft(s * np.hanning(1024))) ** 2 for s in seg], axis=0)
    spec_db = 10 * np.log10(spec + 1e-18)
    freqs = np.fft.rfftfreq(1024, 1 / 24000)
    hi = spec_db[(freqs >= 8000) & (freqs < 11000)].mean()
    mid = spec_db[(freqs >= 4000) & (freqs < 8000)].mean()
    return hi - mid


Comm = build_comm()
print(f"{'voice':<24}{'描述':<8}{'反转度(dB)':<12}{'均值':<8}")
summary = {}
for voice, desc in VOICES:
    vals = []
    for w in WORDS:
        try:
            b = asyncio.run(synth(Comm, w, voice))
            x = decode(b)
            r = reversal(x)
            if r is not None:
                vals.append(r)
        except Exception as e:  # noqa: BLE001
            print(f"  {voice} {w}: 失败 {str(e)[:60]}")
    if vals:
        avg = sum(vals) / len(vals)
        summary[voice] = avg
        print(f"{voice:<24}{desc:<8}{str([f'{v:+.1f}' for v in vals]):<20}{avg:+.1f}")
    else:
        print(f"{voice:<24}{desc:<8}全部失败")

print("\n排名（反转度越小=高频越自然）:")
for v, a in sorted(summary.items(), key=lambda kv: kv[1]):
    print(f"  {v:<24} {a:+.1f} dB")
