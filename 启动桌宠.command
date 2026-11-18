#!/bin/zsh
set -e
setopt NULL_GLOB

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🐳 正在唤醒 AI娘算力桌宠..."

# 优先查找已打包的 macOS 原生 .app
APP_BUNDLE=""
for candidate in \
  "$SCRIPT_DIR/AI娘算力桌宠.app" \
  "$SCRIPT_DIR/src-tauri/target/release/bundle/macos"/*.app \
  "$SCRIPT_DIR/src-tauri/target/universal-apple-darwin/release/bundle/macos"/*.app \
  "$SCRIPT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"/*.app \
  "$SCRIPT_DIR/src-tauri/target/x86_64-apple-darwin/release/bundle/macos"/*.app; do
  if [ -d "$candidate" ]; then
    APP_BUNDLE="$candidate"
    break
  fi
done

if [ -n "$APP_BUNDLE" ]; then
  echo "✨ 启动原生桌面透明桌宠：$APP_BUNDLE"
  open "$APP_BUNDLE"
  exit 0
fi

# 次选：查找 release 二进制直接运行
for bin_candidate in \
  "$SCRIPT_DIR/src-tauri/target/release/cyber-pet-slot" \
  "$SCRIPT_DIR/src-tauri/target/release/ai-pet-slot" \
  "$SCRIPT_DIR/src-tauri/target/release/manga-x-pet" \
  "$SCRIPT_DIR/src-tauri/target/release/deskpet"; do
  if [ -x "$bin_candidate" ] && [ ! -d "$bin_candidate" ]; then
    echo "✨ 启动原生桌面透明桌宠二进制：$bin_candidate"
    nohup "$bin_candidate" >/dev/null 2>&1 &
    exit 0
  fi
done

# 动态扫描 target/release 下非构建脚本的可执行程序
if [ -d "$SCRIPT_DIR/src-tauri/target/release" ]; then
  FOUND_BIN="$(find "$SCRIPT_DIR/src-tauri/target/release" -maxdepth 1 -type f -perm +111 ! -name "*.dylib" ! -name "*.d" ! -name "build-script-*" | head -n 1)"
  if [ -n "$FOUND_BIN" ]; then
    echo "✨ 启动原生桌面透明桌宠二进制：$FOUND_BIN"
    nohup "$FOUND_BIN" >/dev/null 2>&1 &
    exit 0
  fi
fi

# 若尚未编译原生包：先确保前端依赖与 dist 存在，若本机装有 cargo 则构建，否则秒开 Web 预览版
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "📦 首次运行，安装前端轻量依赖..."
  npm install
fi

if [ ! -f "$SCRIPT_DIR/dist/index.html" ] || [ ! -d "$SCRIPT_DIR/dist/assets" ]; then
  echo "🔨 构建前端静态资源..."
  npm run build
fi

if command -v cargo >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/src-tauri/Cargo.toml" ]; then
  echo "🦀 检测到 Rust 环境，正在编译原生 macOS 桌宠（首次编译约需 1-2 分钟）..."
  if (cd "$SCRIPT_DIR/src-tauri" && cargo build --release); then
    FOUND_BIN="$(find "$SCRIPT_DIR/src-tauri/target/release" -maxdepth 1 -type f -perm +111 ! -name "*.dylib" ! -name "*.d" ! -name "build-script-*" | head -n 1)"
    if [ -n "$FOUND_BIN" ]; then
      echo "✨ 编译完成，正在启动原生透明桌宠！"
      nohup "$FOUND_BIN" >/dev/null 2>&1 &
      exit 0
    fi
  fi
fi

echo "🌐 正在打开浏览器预览版（http://127.0.0.1:4173）..."
(sleep 1.2 && open "http://127.0.0.1:4173") &
npm run preview -- --host 127.0.0.1 --port 4173
