#!/usr/bin/env bash
# Installs the extension into the user's GNOME Shell extension directory.
set -euo pipefail

UUID="memory-graphic-indicator@tongwei-tv.github.io"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DEST"
rm -rf "$DEST"
cp -r "$SRC/." "$DEST/"
# 开发产物不装进扩展目录
rm -rf "$DEST/preview" "$DEST/test-render.js" "$DEST/install.sh" "$DEST/README.md" "$DEST"/*.zip
glib-compile-schemas "$DEST/schemas"

echo "已安装到: $DEST"
echo "重启 GNOME Shell 生效："
echo "  X11    : Alt+F2 输入 r 回车"
echo "  Wayland: 注销后重新登录"
echo "然后启用扩展："
echo "  gnome-extensions enable $UUID"
