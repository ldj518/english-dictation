# -*- coding: utf-8 -*-
"""voice 复测：重试机制 + 8 个擦音词，聚焦 5 个候选。输出每词反转度明细。"""
import os, sys, io, asyncio, inspect
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import edge_tts.communicate as _CM  # noqa: E402

OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/english-dictation/scripts/_zz_probe"
WORDS = ["shine", "sunshine", "message", "rush", "sixth", "station", "fish", "class"]
RATE_EN = "-5%"

VOICES = [
    ("en-GB-RyanNeural", "现用·英音男"),
    ("en-US-AndrewNeural", "美音男"),
    ("en-US-AnaNeural", "童声女"),
    ("en-US-AriaNeural", "美音女"),
    ("en-US-JennyNeural", "美音女"),
]


def build_comm():
    src = inspect.getsource(_CM)
    old = '"audio-24khz-48kbitrate-mono-mp3"'
    g = dict(_CM.__dict__)
    exec(compile(src.replace(old, '"audio-24khz-96kbitrate-mono-mp3"'), _CM.__file__, "exec"), g)
    return g["Communicate"]


async def synth_one(Comm, text, voice):
    c = Comm(text, voice, rate=RATE_EN)
    buf = bytearray()
    async for ch in c.stream():
        if ch["type"] == "audio":
            buf += ch["data"]
    return bytes(buf)


async def synth_retry(Comm, text, voice, tries=3):
    for i in range(tries):
        try:
            b = await synth_one(Comm, text, voice)
            if len(b) > 1000:
                return b
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(1.5 * (i + 1))
    return None


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


async def main():
    Comm = build_comm()
    print(f"{'voice':<22}{' ' + '  '.join(f'{w[:6]:>7}' for w in WORDS)}   均值     成功")
    summary = {}
    for voice, desc in VOICES:
        vals = {}
        for w in WORDS:
            b = await synth_retry(Comm, w, voice)
            if not b:
                vals[w] = None
                continue
            x = decode(b)
            r = reversal(x)
            vals[w] = r
        ok = [v for v in vals.values() if v is not None]
        avg = sum(ok) / len(ok) if ok else float("nan")
        summary[voice] = (avg, len(ok))
        row = "  ".join(f"{('+' if v>=0 else '')+format(v,'.1f') if v is not None else '  —  ':>7}" for v in vals.values())
        print(f"{voice:<22} {row}   {avg:+.1f}   {len(ok)}/{len(WORDS)}")
        await asyncio.sleep(1.0)
    print("\n排名（反转度越小=高频越自然）:")
    for v, (a, n) in sorted(summary.items(), key=lambda kv: kv[1][0]):
        print(f"  {v:<24} {a:+.1f} dB  ({n} 词)")


asyncio.run(main())
