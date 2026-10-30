#!/bin/bash
# 把本地 dist 同步到洛杉矶那台（https://ting.5208090.xyz）。
#
# 为什么不在本机直接上传：国内 -> 洛杉矶上传又慢又容易断，
# 而 VPS -> Cloudflare 是 1.7MB/s。所以这里只下发「路径 + 字节数」清单，
# 文件本身由 VPS 自己从线上拉，只拉大小不一致的。
#
# 用法：cd english-dictation && bash scripts/deploy-vps.sh
set -euo pipefail

HOST=154.26.232.104
KEY=$HOME/.ssh/vps_ting
DIST=dist
SRC=https://tingxie.5208090.xyz

[ -f "$DIST/index.html" ] || { echo "先 npm run build"; exit 1; }
[ -f "$KEY" ] || { echo "缺部署密钥 $KEY"; exit 1; }

ASSETS=$(
  { grep -oE '/assets/[A-Za-z0-9_.-]+' "$DIST/index.html"
    grep -oE '"/assets/[A-Za-z0-9_.-]+"' "$DIST/sw.js" | tr -d '"'
  } | sort -u | sed 's|^/||'
)
AUDIOS=$(cd "$DIST" && find audio -type f \( -name '*.mp3' -o -name '*.m4a' -o -name 'manifest.json' \) | sort)

MAN=/tmp/vps-manifest.txt
: > "$MAN"
for f in index.html sw.js manifest.json icons/apple-touch-icon.png icons/icon-192.png icons/icon-512.png $ASSETS $AUDIOS; do
  [ -f "$DIST/$f" ] || continue
  echo "$f $(stat -c%s "$DIST/$f")" >> "$MAN"
done
echo "清单 $(wc -l < "$MAN") 个文件"

# 页面壳和 SW 直接从本地上传：两者不到 7KB，传得动；
# 而 https://…/index.html 在 Pages 上是 308 跳转，用 curl 拉会落成 0 字节空文件。
for f in index.html sw.js; do
  ssh -i "$KEY" -o StrictHostKeyChecking=no root@$HOST "cat > /var/www/t/$f" < "$DIST/$f"
done
echo "已推送 index.html / sw.js（$(stat -c%s "$DIST/index.html")B / $(stat -c%s "$DIST/sw.js")B）"

ssh -i "$KEY" -o StrictHostKeyChecking=no root@$HOST "cat > /tmp/sync-list.txt" < "$MAN"

ssh -i "$KEY" -o StrictHostKeyChecking=no root@$HOST 'bash -s' <<REMOTE
set -u
ROOT=/var/www/t
SRC=$SRC
: > /tmp/need.txt
n=0; total=0
while read -r path size; do
  total=\$((total+1))
  cur=\$(stat -c%s "\$ROOT/\$path" 2>/dev/null || echo -1)
  [ "\$cur" = "\$size" ] || { echo "\$path" >> /tmp/need.txt; n=\$((n+1)); }
done < /tmp/sync-list.txt
echo "对比 \$total 个，需要更新 \$n 个"
if [ -s /tmp/need.txt ]; then
  fetch() {
    mkdir -p "\$(dirname "\$ROOT/\$1")"
    curl -sS --fail -m 180 --retry 3 -o "\$ROOT/\$1" "\$SRC/\$1" || echo "拉取失败 \$1"
  }
  export -f fetch; export ROOT SRC
  xargs -P 12 -I{} bash -c 'fetch "\$@"' _ {} < /tmp/need.txt
fi
echo "线上文件数 \$(find \$ROOT -type f | wc -l)，占用 \$(du -sh \$ROOT | cut -f1)"
REMOTE
echo "完成：https://ting.5208090.xyz"
