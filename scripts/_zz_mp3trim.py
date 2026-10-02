# -*- coding: utf-8 -*-
"""E7/E8：线上形态候选包（零解码、零重编码）。
E7 = 原始 mp3 原样直拷（= T3 形态，验证用户一致性 + message 词）
E8 = mp3 帧级裁剪（解析帧头切掉头尾静音帧，字节原样不动，无解码无重编码）
     静音帧定位：PyAV 解码全长找语音边界 → 样本索引/576 = mp3 帧号
"""
import io, os, sys, shutil, hashlib, wave
import numpy as np
import av

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"C:/Users/51183/WorkBuddy/2026-09-26-13-55-46/word-dictation")
import audiogen  # noqa: E402

OUTD = r"C:/Users/51183/WorkBuddy/2026-10-01-15-56-41/_deliver_audio"
WORDS = ["station", "message"]
TRIM_THRESH = 0.006
PAD = 60 * 24000 // 1000   # 60ms 样本


def cache_src(word):
    ck = hashlib.md5(("%s|%s|%s|%s" % (audiogen.SRC_FORMAT, audiogen.VOICE_EN,
                                       audiogen.RATE_EN, word)).encode("utf-8")).hexdigest()
    with open(os.path.join(audiogen.CACHE, ck + ".mp3"), "rb") as f:
        return f.read()


def mp3_frames(b):
    """解析 mp3 帧边界。返回 [(start, end), ...]。24kHz MPEG2-L3: 每帧 576 样本，288+pad 字节。"""
    frames, i = [], 0
    n = len(b)
    while i < n - 4:
        if b[i] == 0xFF and (b[i + 1] & 0xE0) == 0xE0:
            ver = (b[i + 1] >> 3) & 3        # 3=MPEG1 2=MPEG2 0=MPEG2.5
            layer = (b[i + 1] >> 1) & 3      # 1=L3
            br_i = (b[i + 2] >> 4) & 0xF
            sr_i = (b[i + 2] >> 2) & 3
            pad = (b[i + 2] >> 1) & 1
            if layer != 1 or br_i in (0, 15) or sr_i == 3:
                i += 1; continue
            br = {2: 8, 3: 16, 4: 24, 5: 32, 6: 40, 7: 56, 8: 64, 9: 80,
                  10: 96, 11: 112, 12: 128, 13: 144, 14: 160}.get(br_i)
            if br is None:
                i += 1; continue
            flen = 72 * br * 1000 // 24000 + pad
            if i + flen > n:
                break
            frames.append((i, i + flen))
            i += flen
        else:
            i += 1
    return frames


def voice_bounds(mp3_bytes):
    """PyAV 解码全长，返回语音起止样本索引。"""
    chunks = []
    with av.open(io.BytesIO(mp3_bytes)) as c:
        for fr in c.decode(c.streams.audio[0]):
            chunks.append(fr.to_ndarray()[0].copy())
    x = np.concatenate(chunks).astype(np.float32)
    x = x - float(x.mean())
    idx = np.flatnonzero(np.abs(x) > TRIM_THRESH)
    return idx[0], idx[-1], x.size


def trim_mp3(mp3_bytes, f0, f1, frames):
    """按帧号裁剪，返回原样字节拼接。"""
    f0 = max(0, f0)
    f1 = min(len(frames) - 1, f1)
    out = b"".join(mp3_bytes[a:b] for a, b in frames[f0 : f1 + 1])
    return out


for w in WORDS:
    src = cache_src(w)
    # E7 原样直拷
    shutil.copyfileobj(io.BytesIO(src), open(os.path.join(OUTD, f"E7_{w}_原始直出.mp3"), "wb"))
    # 帧解析 + 语音边界
    frames = mp3_frames(src)
    i0, i1, total = voice_bounds(src)
    f0 = (i0 - PAD) // 576
    f1 = (i1 + PAD) // 576 + 1
    trimmed = trim_mp3(src, f0, f1, frames)
    p8 = os.path.join(OUTD, f"E8_{w}_帧级裁剪.mp3")
    with open(p8, "wb") as f:
        f.write(trimmed)
    # 自查：裁剪版能否正常解码、时长
    with av.open(p8) as c:
        dur = float(c.streams.audio[0].duration * c.streams.audio[0].time_base)
    print(f"{w}: 原始 {len(src)/1024:.0f}KB / {len(frames)}帧 / 解码全长 {total/24000:.2f}s  "
          f"语音 {i0/24000:.2f}-{i1/24000:.2f}s  裁帧[{f0},{f1}]  "
          f"E8 {len(trimmed)/1024:.0f}KB / 解码验证 {dur:.2f}s")
print("\nE7/E8 已生成:", OUTD)
