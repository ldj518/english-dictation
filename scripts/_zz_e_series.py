# -*- coding: utf-8 -*-
"""E 系列终极分辨：容器决定论 vs 内容决定论。
E1 = T3 mp3 原样（已有，WorkBuddy 听=干净）
E2 = N1 WAV（已有，WorkBuddy 听=滋滋）
E3 = N1 的 PCM 重新编码为 mp3 96kbps（内容同 E2，容器同 E1）
若 E3 干净 → 容器决定论（WAV 播放路径有增益/处理）→ 线上换 mp3 交付
若 E3 滋滋 → 内容决定论（PCM 里真有杂讯）→ 继续查处理链
另：N1 WAV 数值自查（尖刺/NaN/削波/直流/帧异常）。
"""
import io, os, sys, wave
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/_deliver_audio"
RATE = 24000

# ── N1 WAV 数值自查 ──
p = os.path.join(OUTD, "N1_station_原始电平.wav")
with wave.open(p, "rb") as wf:
    ch, sw, sr, nf = wf.getnchannels(), wf.getsampwidth(), wf.getframerate(), wf.getnframes()
    s16 = np.frombuffer(wf.readframes(nf), dtype=np.int16)
print(f"N1_station.wav: ch={ch} sw={sw*8}bit sr={sr} 帧={nf} 时长={nf/sr:.2f}s")
f32 = s16.astype(np.float64)
print(f"  NaN/Inf 之外检查: peak={np.abs(f32).max()} min={f32.min()} max={f32.max()} "
      f"直流={f32.mean():.2f} LSB")
print(f"  满幅/近满幅样本(|x|>=32000): {int((np.abs(f32) >= 32000).sum())} 个")
# 帧级 RMS 时线：10ms 帧，找 top 尖刺
fr = 240
n_fr = len(s16) // fr
fr_rms = np.sqrt((s16[: n_fr * fr].reshape(n_fr, fr).astype(np.float64) ** 2).mean(axis=1))
db = 20 * np.log10(fr_rms / 32768.0 + 1e-12)
top = np.argsort(db)[::-1][:8]
print(f"  最响 8 帧(10ms): " + "  ".join(f"t={i*fr/sr*1000:.0f}ms {db[i]:.0f}dB" for i in sorted(top)))
# 突变检测：相邻样本差 > 8000（约 -12dBFS 突跳）的计数
diff = np.abs(np.diff(f32))
print(f"  相邻样本突跳>8000 LSB: {int((diff > 8000).sum())} 处 "
      f"(最大 {diff.max():.0f} LSB @ t={int(np.argmax(diff))/sr*1000:.1f}ms)")

# ── E3: N1 PCM → mp3 96kbps ──
pcm = (s16.astype(np.float32) / 32768.0)
out_path = os.path.join(OUTD, "E3_N1内容转mp3_station.mp3")
buf = io.BytesIO()
with av.open(buf, "w", format="mp3") as cont:
    stream = cont.add_stream("libmp3lame", rate=RATE, layout="mono", bit_rate=96000)
    chunk = 1024 * 10
    for i in range(0, pcm.size, chunk):
        seg = pcm[i : i + chunk]
        frame = av.AudioFrame.from_ndarray(seg.reshape(1, -1), format="flt", layout="mono")
        frame.sample_rate = RATE
        for pk in stream.encode(frame):
            cont.mux(pk)
    for pk in stream.encode(None):
        cont.mux(pk)
with open(out_path, "wb") as f:
    f.write(buf.getvalue())
print(f"\nE3 已生成: {out_path} ({os.path.getsize(out_path)/1024:.0f} KB)")
