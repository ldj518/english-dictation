# -*- coding: utf-8 -*-
"""构建 + 部署到 Cloudflare Pages（一键）。

步骤：
  1. npm run build（注入 VITE_AUDIO_BASE）
  2. wrangler pages deploy dist

凭证从环境变量读，或从 .env 文件加载。
"""
import os, sys, subprocess

sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.environ.get("CF_PAGES_PROJECT", "english-dictation")

# 音频在 R2，构建时注入
AUDIO_BASE = os.environ.get("VITE_AUDIO_BASE", "")


def load_env():
    """从 .env 补全环境变量（不覆盖已有的）"""
    p = os.path.join(BASE, ".env")
    if not os.path.exists(p):
        return
    for line in open(p, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and v and k not in os.environ:
            os.environ[k] = v


load_env()

NPM = r"C:/Users/51183/.workbuddy/binaries/node/versions/22.22.2-3/npm.cmd"
NODE = r"C:/Users/51183/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
WRANGLER = os.path.join(BASE, "node_modules", "wrangler", "bin", "wrangler.js")

env = dict(os.environ)
for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    env.pop(k, None)
if AUDIO_BASE:
    env["VITE_AUDIO_BASE"] = AUDIO_BASE

if not env.get("CLOUDFLARE_API_TOKEN"):
    print("✗ 缺少 CLOUDFLARE_API_TOKEN（可写入 .env）")
    sys.exit(1)

print("── 1/2 构建 ──")
r = subprocess.run([NPM, "run", "build"], cwd=BASE, env=env,
                   shell=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
print((r.stdout or "")[-800:])
if r.returncode != 0:
    print((r.stderr or "")[-1500:])
    print("✗ 构建失败")
    sys.exit(1)

print("\n── 2/2 部署 ──")
r = subprocess.run(
    [NODE, WRANGLER, "pages", "deploy", "dist",
     f"--project-name={PROJECT}", "--branch=main", "--commit-dirty=true"],
    cwd=BASE, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
print((r.stdout or "")[-1200:])
if r.returncode != 0:
    print((r.stderr or "")[-1500:])
    print("✗ 部署失败")
    sys.exit(1)
print("✅ 完成")
