# Memory Graphic Indicator

在 GNOME Shell 顶部面板用图形显示内存与虚拟内存占用。

- **内存**：物理内存占用（MemTotal − MemAvailable）
- **虚拟内存**：磁盘 swap 与 zram **分段堆叠**在同一图内
- **明暗自适应**：跟随系统亮/暗样式，暗色模式下按亮度系数自动压暗颜色
- 点击图标可查看各项的精确数值与百分比

## 设置项

「显示」分组：

| 设置 | 说明 |
| --- | --- |
| 显示虚拟内存 | 开/关虚拟内存图（内存与虚拟内存各占一图） |
| 排列方式 | 上下（叠放）或左右（并排），图形始终横向填充 |
| 图形方向 | 左（右侧为 100%）或右（右侧为 0%），默认左 |
| 刷新间隔 | 200 – 60000 毫秒 |
| 旋转 | 开关；开启后图形组合整体**顺时针旋转 90°**，改为竖向、自上而下填充 |

「顺序」分组：在设置中**拖动**两图互换位置；同一顺序同时决定上下排列谁在上、左右排列谁在左。

「尺寸」分组：

| 设置 | 说明 |
| --- | --- |
| 图形长度 | 图形的长度，即图形 0-100% 的尺寸，12 – 320 像素 |
| 图形间距 | 两图之间的空隙，0 – 24 像素 |
| 独立调节图形 | 开关；开启时显示内存图 / 虚拟内存图各自的宽度与圆角并隐藏共用项，关闭时反之；「左右」排列下开关被强制关闭并置灰，切回「上下」时自动恢复之前的状态（不丢失设置） |
| 图形宽度 | 两图共用的宽度，2 – 32 像素 |
| 图形圆角 | 两图共用的圆角，0 为直角，0 – 16 像素 |

「颜色（亮色模式）」分组：内存 / 交换分区 / ZRAM / 背景四项在**亮色模式**下的颜色，背景支持透明度（`#rrggbbaa`）；另有**暗色模式亮度系数**（0.2 – 1.0）控制暗色下的压暗程度。

> 说明：swap 与 zram 始终堆叠在虚拟内存图内；若系统只使用 zram，则虚拟内存图只显示 zram 分段。

## 安装

```bash
./install.sh
```

安装后重启 GNOME Shell 生效：

- **X11**：`Alt + F2`，输入 `r` 回车
- **Wayland**：注销后重新登录

然后在「扩展」应用中启用 **Memory Graphic Indicator**，或执行：

```bash
gnome-extensions enable memory-graphic-indicator@tongwei-tv.github.io
```

## 兼容性

GNOME Shell 45 – 48（ESM 扩展写法）。

## 目录结构

```
memory-graphic-indicator@tongwei-tv.github.io/
├── metadata.json                              # 扩展元数据
├── extension.js                               # 扩展入口
├── indicator.js                               # 面板指示器（菜单 / 定时刷新 / 取色）
├── prefs.js                                   # 偏好设置窗口（GTK4 + Libadwaita）
├── lib/
│   ├── memory.js                              # /proc/meminfo + /proc/swaps 解析
│   ├── colors.js                              # 颜色解析与压暗
│   └── drawing.js                             # Cairo 图形绘制
├── schemas/
│   ├── org.gnome.shell.extensions.memory-graphic-indicator.gschema.xml
│   └── gschemas.compiled                      # 安装时由 glib-compile-schemas 生成
├── test-render.js                             # 开发用：离屏渲染预览图（不随发布包分发）
├── install.sh                                 # 本地安装脚本（不随发布包分发）
├── COPYING                                    # GPL-2.0 许可证全文
└── README.md
```

## 开发

`test-render.js` 使用真实的 Cairo API 离屏渲染各组合的预览图，可在不重启 Shell 的情况下验证绘图逻辑（输出到 `preview/`）：

```bash
GI_TYPELIB_PATH=/usr/lib/gnome-shell LD_LIBRARY_PATH=/usr/lib/gnome-shell gjs -m test-render.js
```

## 许可证

GPL-2.0-or-later，见 `COPYING`。与 GNOME Shell 本身的许可证兼容。

## 发布

提交到 extensions.gnome.org 的 zip 需**根目录**直接包含 `metadata.json` / `extension.js`（无外层文件夹），且不含 `install.sh` 与 `test-render.js`。仓库根目录执行：

```bash
zip -r memory-graphic-indicator.zip . \
  -x '*.git*' -x 'install.sh' -x 'test-render.js' -x 'preview/*' -x '*.zip'
```
