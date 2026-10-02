# -*- coding: utf-8 -*-
"""把本地生成的音频上传到 Cloudflare R2（S3 兼容）。

凭证从环境变量读，绝不硬编码：
  R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT / R2_BUCKET

用法：
  python scripts/upload-r2.py            # 全量上传
  python scripts/upload-r2.py --check    # 只检查，不上传
"""
import os, sys, json, hashlib, mimetypes
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding='utf-8')

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(BASE, "public", "audio")

BUCKET = os.environ.get("R2_BUCKET", "english-dictation-audio")
ENDPOINT = os.environ.get("R2_ENDPOINT", "")
KEY = os.environ.get("R2_ACCESS_KEY_ID", "")
SECRET = os.environ.get("R2_SECRET_ACCESS_KEY", "")

if not (KEY and SECRET and ENDPOINT):
    print("✗ 缺少 R2 凭证。请设置环境变量：")
    print("  R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT")
    sys.exit(1)

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=KEY,
    aws_secret_access_key=SECRET,
    config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    region_name="auto",
)

CHECK_ONLY = "--check" in sys.argv
# 换版重传场景（如 w4）：只传 words/*.m4a + manifest，跳过 tracks 与旧 mp3，省 200MB+ 带宽
ONLY_NEW = "--new-m4a" in sys.argv


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def collect():
    """收集待上传文件：tracks/*.mp3, words/*.mp3+.m4a, manifest.json"""
    out = []
    for rel in ("manifest.json",):
        p = os.path.join(AUD, rel)
        if os.path.exists(p):
            out.append((rel, p))
    for sub in ("tracks", "words"):
        if ONLY_NEW and sub == "tracks":
            continue
        d = os.path.join(AUD, sub)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".mp3") or fn.endswith(".m4a"):
                if ONLY_NEW and not fn.endswith(".m4a"):
                    continue
                out.append((f"{sub}/{fn}", os.path.join(d, fn)))
    return out


# mimetypes 在部分 Windows 上把 .m4a 猜成 None，显式映射兜底
CT_OVERRIDES = {".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".json": "application/json"}


def upload_one(job):
    key, path = job
    ext = os.path.splitext(key)[1].lower()
    ctype = CT_OVERRIDES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"
    audio = ext in (".mp3", ".m4a")
    extra = {
        "ContentType": ctype,
        # 音频内容不变，长缓存；manifest 短缓存便于更新
        "CacheControl": "public, max-age=31536000, immutable" if audio
        else "public, max-age=60",
    }
    with open(path, "rb") as f:
        s3.put_object(Bucket=BUCKET, Key=key, Body=f, **extra)
    return key, os.path.getsize(path)


def main():
    jobs = collect()
    total_mb = sum(os.path.getsize(p) for _, p in jobs) / 1024 / 1024
    print(f"待上传 {len(jobs)} 个文件，共 {total_mb:.1f} MB → {BUCKET}")
    if CHECK_ONLY:
        for k, p in jobs[:10]:
            print(f"  {k}  {os.path.getsize(p)/1024:.0f} KB")
        print(f"  ... 共 {len(jobs)} 个")
        return

    ok = fail = 0
    done_mb = 0.0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(upload_one, j): j for j in jobs}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                key, size = fut.result()
                ok += 1
                done_mb += size / 1024 / 1024
                if i % 50 == 0 or i == len(jobs):
                    print(f"  [{i}/{len(jobs)}] {done_mb:.1f} MB 已上传")
            except (ClientError, Exception) as e:  # noqa: BLE001
                fail += 1
                j = futs[fut]
                print(f"  ✗ {j[0]}: {str(e)[:120]}")

    print(f"\n完成：成功 {ok} / 失败 {fail}")
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
