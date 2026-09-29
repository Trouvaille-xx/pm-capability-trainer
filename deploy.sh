#!/usr/bin/env bash
#
# 在服务器上跑：构建并把服务交给 pm2 托管。
#
# 为什么用 pm2 而不是 docker：这台机器上已经有 pm2 在跑别的服务
# （omnifold-api），沿用同一套更省事 —— 不用多装一层，日志/自启/重启
# 的路径也和不装 docker 的那几个项目一致。
#
# 幂等：重复跑不会重复注册，只会 rebuild + reload。
#
# 用法：
#   cd /home/ubuntu/pm-trainer && bash deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="pm-trainer"
PORT="${PORT:-8081}"

cd "$APP_DIR"
echo "▶ 目录：$APP_DIR"

# ---- 1. 环境变量 ----
if [ ! -f .env ]; then
  echo "✗ 缺少 .env。先复制 .env.example 并填上 BASIC_AUTH_PASS。"
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -z "${BASIC_AUTH_USER:-}" ] || [ -z "${BASIC_AUTH_PASS:-}" ]; then
  echo "⚠ 没设 BASIC_AUTH_USER / BASIC_AUTH_PASS —— 这个服务将对外完全开放。"
fi

# ---- 2. 依赖与构建 ----
echo "▶ 安装依赖（npm ci）"
npm ci --no-audit --no-fund

echo "▶ 构建"
npm run build

# ---- 3. 交给 pm2 ----
# 端口与认证变量在启动时注入：proxy.ts 与 next start 都读环境变量。
echo "▶ 启动 / 重载 pm2 进程（端口 $PORT）"
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  PORT="$PORT" BASIC_AUTH_USER="${BASIC_AUTH_USER:-}" BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-}" \
    pm2 start npm --name "$APP_NAME" -- start
fi

pm2 save > /dev/null
echo "▶ 完成。状态："
pm2 describe "$APP_NAME" | grep -E "status|uptime|restarts" | head -3
echo
echo "  本机自测： curl -I http://127.0.0.1:$PORT/"
echo "  外网访问： http://<公网IP>:$PORT/"
