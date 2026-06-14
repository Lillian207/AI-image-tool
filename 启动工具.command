#!/bin/zsh
cd "$(dirname "$0")"

PORT=8788
URL="http://127.0.0.1:${PORT}/"

if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "工具已经在运行：${URL}"
  open "${URL}"
  exit 0
fi

open "${URL}"
node server.js
