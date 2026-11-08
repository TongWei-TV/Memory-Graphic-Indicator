#!/usr/bin/env bash
# Installs the extension into the user's GNOME Shell extension directory.
set -euo pipefail

UUID="memory-graphic-indicator@tongwei-tv.github.io"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DEST"
# 增量拷贝（不整目录删除，避免误伤已有数据）；开发产物不拷贝。
tar -C "$SRC" \
    --exclude='./.git' --exclude='./.gitignore' \
    --exclude='./preview' --exclude='./test-render.js' \
    --exclude='./install.sh' --exclude='./*.zip' \
    -cf - . | tar -C "$DEST" -xf -
# 清理旧版本可能残留的开发文件
rm -rf "$DEST/.git" "$DEST/.gitignore" "$DEST/preview" "$DEST/test-render.js"
glib-compile-schemas "$DEST/schemas"

echo "已安装到: $DEST"
echo "重启 GNOME Shell 生效："
echo "  X11    : Alt+F2 输入 r 回车"
echo "  Wayland: 注销后重新登录"
echo "然后启用扩展："
echo "  gnome-extensions enable $UUID"
