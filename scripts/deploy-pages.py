# -*- coding: utf-8 -*-
"""直接通过 Cloudflare Pages REST API 部署 dist 目录（无需 wrangler）。

用 CF Pages 的「Direct Upload」流程：
  1. 为每个文件算 hash
  2. POST /pages/projects/{name}/deployments 拿到上传 URL 列表（jwt）
  3. 逐文件 POST 到对应 URL
  4. 完成部署

凭证从环境变量读：
  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID

用法：
  python scripts/deploy-pages.py                # 部署 dist
  python scripts/deploy-pages.py --dir dist     # 指定目录
"""
import os, sys, json, hashlib, mimetypes, base64, time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding='utf-8')

import requests

TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
ACC = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
PROJECT = os.environ.get("CF_PAGES_PROJECT", "english-dictation")

if not (TOKEN and ACC):
    print("✗ 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID")
    sys.exit(1)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(BASE, "dist")
if "--dir" in sys.argv:
    DIST = os.path.abspath(sys.argv[sys.argv.index("--dir") + 1])

API = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/pages/projects/{PROJECT}"
HEAD = {"Authorization": f"Bearer {TOKEN}"}

# 这些体积大且已托管在 R2，不打进 Pages
SKIP_DIRS = {"audio"}
SKIP_EXT = {".map"}


def collect(root):
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if os.path.splitext(fn)[1] in SKIP_EXT:
                continue
            p = os.path.join(dp, fn)
            rel = "/" + os.path.relpath(p, root).replace("\\", "/")
            with open(p, "rb") as f:
                data = f.read()
            h = hashlib.sha256(data).hexdigest()[:32]
            ct = mimetypes.guess_type(fn)[0] or "application/octet-stream"
            out.append({"path": rel, "hash": h, "size": len(data),
                        "content_type": ct, "data": data})
    return out


def main():
    files = collect(DIST)
    total = sum(f["size"] for f in files) / 1024 / 1024
    print(f"部署 {len(files)} 个文件，{total:.2f} MB → {PROJECT}")
    if not files:
        print("✗ dist 为空，先跑 npm run build")
        sys.exit(1)

    # 查已有部署，跳过内容未变的文件
    manifest = {f["path"]: f["hash"] for f in files}
    r = requests.get(f"{API}/deployments?per_page=1", headers=HEAD, timeout=30)
    existing = {}
    if r.ok and r.json().get("result"):
        dep = r.json()["result"][0]
        for f in (dep.get("files") or []):
            existing[f["path"]] = f["hash"]

    # 只上传变化的
    to_up = [f for f in files if existing.get(f["path"]) != f["hash"]]
    print(f"  其中 {len(to_up)} 个需要上传（{len(files)-len(to_up)} 个未变，跳过）")

    # 创建部署
    body = {
        "branch": "main",
        "manifest": manifest,
        "commit_message": f"deploy {len(files)} files",
    }
    r = requests.post(f"{API}/deployments", headers={**HEAD, "Content-Type": "application/json"},
                      json=body, timeout=60)
    if not r.ok:
        print("✗ 创建部署失败:", r.status_code, r.text[:400]); sys.exit(1)
    dep = r.json()["result"]
    dep_id = dep["id"]
    print(f"  部署 ID: {dep_id}")

    # 拿上传 URL
    uploads = {}
    for u in dep.get("upload_urls") or []:
        # 新 API 返回 {"hash": "...", "url": "..."} 之类，做兼容
        h = u.get("hash") or u.get("key")
        uploads[h] = u.get("url")
    # 兜底：有些返回 jwt 列表
    jwt_list = dep.get("jwt") or []

    ok = fail = 0

    def up(f):
        url = uploads.get(f["hash"])
        ct = f["content_type"] or "application/octet-stream"
        data = f["data"]
        if url:
            # 已签名 URL，直接 PUT/ POST 原始字节
            resp = requests.post(url, data=data,
                                 headers={"Content-Type": ct}, timeout=180)
        elif jwt_list:
            # 回退：走 jwt 上传端点
            jurl = jwt_list[0] if isinstance(jwt_list[0], str) else jwt_list[0].get("url")
            resp = requests.post(
                jurl,
                data=data,
                headers={"Content-Type": "application/octet-stream",
                         "Content-Length": str(len(data))},
                timeout=180)
        else:
            raise RuntimeError("无可用上传地址")
        if not resp.ok:
            raise RuntimeError(f"HTTP {resp.status_code} {resp.text[:200]}")
        return f["size"]

    if to_up:
        with ThreadPoolExecutor(max_workers=6) as ex:
            futs = {ex.submit(up, f): f for f in to_up}
            done = 0
            for fut in as_completed(futs):
                f = futs[fut]
                try:
                    fut.result(); ok += 1; done += f["size"]
                    if ok % 5 == 0 or ok == len(to_up):
                        print(f"    [{ok}/{len(to_up)}] {done/1024/1024:.2f} MB")
                except Exception as e:  # noqa: BLE001
                    fail += 1
                    print(f"    ✗ {f['path']}: {str(e)[:160]}")

    print(f"\n上传完成：成功 {ok} / 失败 {fail}")
    if fail:
        print("✗ 有文件上传失败，部署可能不完整"); sys.exit(1)

    # 轮询部署状态
    for _ in range(40):
        r = requests.get(f"{API}/deployments/{dep_id}", headers=HEAD, timeout=30)
        if r.ok:
            d = r.json()["result"]
            stage = (d.get("latest_stage") or {}).get("name")
            status = (d.get("latest_stage") or {}).get("status")
            if stage == "deploy" and status == "success":
                print(f"\n✅ 部署成功")
                print(f"   预览: {d.get('url')}")
                proj = requests.get(API, headers=HEAD, timeout=30).json()["result"]
                print(f"   生产: https://{proj.get('subdomain')}")
                return
            if status == "failure":
                print("✗ 部署失败:", json.dumps(d.get("latest_stage"), ensure_ascii=False)[:400])
                sys.exit(1)
        time.sleep(3)
    print("⚠️ 部署状态轮询超时，请到控制台查看")


if __name__ == "__main__":
    main()
