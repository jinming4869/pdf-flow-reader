#!/bin/sh

set -eu

reader_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$#" -gt 1 ]; then
  echo "用法: start-reader.sh [PDF 文件]" >&2
  exit 2
fi

pdf_path=${1:-}

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node.js 18 或更高版本。" >&2
  exit 1
fi

node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 18 ]; then
  echo "当前 Node.js 版本不足：$(node --version)。请升级到 Node.js 18 或更高版本。" >&2
  exit 1
fi

if [ -n "$pdf_path" ]; then
  case "$pdf_path" in
    *.pdf|*.PDF) ;;
    *) echo "请选择 PDF 文件: $pdf_path" >&2; exit 2 ;;
  esac
  if [ ! -f "$pdf_path" ]; then
    echo "PDF 文件不存在: $pdf_path" >&2
    exit 2
  fi
fi

runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/pdf-flow-reader.XXXXXX")
port_file="$runtime_dir/port.json"
log_file="$runtime_dir/server.log"

cleanup() {
  rm -rf "$runtime_dir"
}
trap cleanup EXIT HUP INT TERM

if [ -n "$pdf_path" ]; then
  nohup node "$reader_dir/server.mjs" "$pdf_path" "$port_file" >"$log_file" 2>&1 &
else
  nohup node "$reader_dir/server.mjs" --port-file "$port_file" >"$log_file" 2>&1 &
fi
server_pid=$!

attempt=0
while [ ! -s "$port_file" ]; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$log_file" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then
    kill "$server_pid" 2>/dev/null || true
    echo "PDF 阅读器启动超时。" >&2
    exit 1
  fi
  sleep 0.1
done

reader_port=$(node -e '
  const fs = require("node:fs");
  const info = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (info.error) throw new Error(info.error);
  process.stdout.write(String(info.port));
' "$port_file")

if [ "${PDF_FLOW_READER_NO_OPEN:-0}" != "1" ]; then
  open "http://127.0.0.1:$reader_port/"
fi
echo "PDF Flow Reader 已启动: http://127.0.0.1:$reader_port/"
