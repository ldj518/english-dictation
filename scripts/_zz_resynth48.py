# -*- coding: utf-8 -*-
"""E5 实验：48kHz/192kbps 重新合成（联网），双路径分离「源质量 vs 解码器」。
E5a = 48k mp3 → PyAV 解码（不重采样）→ WAV 48kHz
E5b = 48k mp3 原样拷贝
结果矩阵：
  都干净   → 24kHz(MPEG-2 LSF) mp3 解码是滋滋源 → 修复=全量重合成 48k 无重采样交付
  a 滋 b 净 → ffmpeg 解码器整体问题 → 必须换解码途径
  都滋滋   → TTS 内容固有问题 → 换音色/引擎
"""
import io, os, sys, wave
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/_deliver_audio"
FMT48 = "audio-48khz-192kbitrate-mono-mp3"
WORDS = ["station", "message"]

# 运行时重建 Communicate（_build_communicate 引用模块级 SRC_FORMAT）
audiogen.SRC_FORMAT = FMT48
audiogen.Communicate = audiogen._build_communicate()

print("联网合成 48kHz/192kbps ...")
got = audiogen.synth(WORDS, [])
for w in WORDS:
    mp3 = got.get((w, "en"))
    if not mp3:
        print(f"[缺] {w}"); continue
    # E5b 原样 mp3
    p_b = os.path.join(OUTD, f"E5b_{w}_48k原始.mp3")
    with open(p_b, "wb") as f:
        f.write(mp3)
    # 元数据
    with av.open(io.BytesIO(mp3)) as c:
        st = c.streams.audio[0]
        cc = st.codec_context
        print(f"{w}: sr={cc.sample_rate} ch={cc.channels} br={cc.bit_rate} "
              f"dur={float(st.duration*st.time_base):.2f}s")
    # E5a 解码不重采样 → WAV 原始率
    chunks = []
    with av.open(io.BytesIO(mp3)) as c:
        st = c.streams.audio[0]
        for fr in c.decode(st):
            chunks.append(fr.to_ndarray()[0].copy())
    pcm = np.concatenate(chunks).astype(np.float32)
    rate = cc.sample_rate
    p_a = os.path.join(OUTD, f"E5a_{w}_解码转WAV.wav")
    s16 = np.clip(np.round(np.asarray(pcm, np.float64) * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(p_a, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(rate)
        wf.writeframes(s16.tobytes())
    print(f"  E5a={os.path.basename(p_a)} ({pcm.size/rate:.2f}s @{rate}Hz)  "
          f"E5b={os.path.basename(p_b)}")
print("\nE5 系列已生成:", OUTD)
