# -*- coding: utf-8 -*-
"""播放链路二分测试包。
T1_纯数字静音3秒.wav   全零 PCM，理论上任何链路都应完全无声
T2_1kHz纯音3秒.wav     数学生成的 1kHz 正弦 -20dBFS，零 TTS 零处理链，验证写 WAV 代码+播放解码
T3_原始TTS未处理_station.mp3  edge-tts 缓存原件原样拷贝，未经任何处理（对照线上处理链）
结果矩阵：
  T1 滋滋 -> 设备/链路噪声（音量过大、增强、驱动），与文件无关
  T1 净 T2 滋滋 -> 播放器对 24kHz mono WAV 解码/重采样问题
  T1 T2 净 T3 滋滋 -> TTS 原始输出固有瑕疵 -> 换引擎/格式重新合成
  全净 -> 嫌疑回到我的处理链
"""
import os, sys, hashlib, shutil, wave
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/_deliver_audio"
RATE = 24000
DUR = 3.0


def write_wav(path, pcm):
    s16 = np.clip(np.round(np.asarray(pcm, np.float64) * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(RATE)
        wf.writeframes(s16.tobytes())


# T1 纯数字静音
write_wav(os.path.join(OUTD, "T1_纯数字静音3秒.wav"), np.zeros(int(RATE * DUR)))

# T2 1kHz 正弦 -20dBFS，两端 10ms 淡入淡出
t = np.arange(int(RATE * DUR)) / RATE
sig = 0.1 * np.sin(2 * np.pi * 1000.0 * t)
n = int(RATE * 0.01)
ramp = np.linspace(0.0, 1.0, n)
sig[:n] *= ramp
sig[-n:] *= ramp[::-1]
write_wav(os.path.join(OUTD, "T2_1kHz纯音3秒.wav"), sig)

# T3 原始 TTS 缓存原件（station）
ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                   audiogen.RATE_EN, "station")).encode("utf-8")).hexdigest()
shutil.copy(os.path.join(audiogen.CACHE, ck + ".mp3"),
            os.path.join(OUTD, "T3_原始TTS未处理_station.mp3"))

print("T1/T2/T3 已生成:", OUTD)
