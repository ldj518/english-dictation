#!/usr/bin/env bash
# 统一测试入口：先打包（失败即中止），再运行。
# 关键：rm 旧产物，避免 esbuild 打包失败时跑到陈旧代码上得出假结论。
set -e
cd "$(dirname "$0")/.."

NODE="C:/Users/51183/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
ESB="node_modules/esbuild/bin/esbuild"
export NODE_PATH="$(pwd)/node_modules"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

mkdir -p .tmp

pack() {  # $1=入口 $2=输出名
  rm -f ".tmp/$2"
  "$NODE" "$ESB" "scripts/$1" --bundle --platform=node --format=esm \
    --outfile=".tmp/$2" --loader:.json=json \
    --resolve-extensions=.tsx,.ts,.jsx,.js,.json \
    --external:react --external:react-dom --external:react-router-dom >/dev/null
  test -f ".tmp/$2" || { echo "✗ 打包失败：$1"; exit 1; }
}

RC=0
for pair in "logic-test.ts:logic.mjs" "smoke.tsx:smoke.mjs"; do
  file="${pair%%:*}"; out="${pair##*:}"
  echo "── $file ──"
  pack "$file" "$out"
  "$NODE" ".tmp/$out" 2>&1 | grep -v "useLayoutEffect\|^    at \|Warning: " || true
  echo
done
