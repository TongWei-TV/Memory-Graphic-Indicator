import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import System from 'system';

import {parseHexColor, parseHexColorAlpha, scaleColor} from './lib/colors.js';
import {canvasSize, drawBars} from './lib/drawing.js';
import {readUsageAsync} from './lib/memory.js';

const SCALE = 8;
// 开发脚本，把异步读取转成同步数据供渲染用。
let data = null;
const loop = new GLib.MainLoop(null, false);
readUsageAsync(null, result => {
    data = result;
    loop.quit();
});
loop.run();

if (!data) {
    print('failed to read memory usage');
    System.exit(1);
}

function plans() {
    const segments = [];
    if (data.swapTotal > 0)
        segments.push({value: data.swapUsed, color: 'swap'});
    if (data.zramTotal > 0)
        segments.push({value: data.zramUsed, color: 'zram'});

    return [
        {total: data.memTotal, segments: [{value: data.memUsed, color: 'memory'}]},
        {total: data.virtTotal, segments},
    ];
}

function colorsFor(dark, background = '#8080804d') {
    const f = dark ? 0.72 : 1.0;
    const pick = hex => {
        const rgb = parseHexColor(hex);
        return dark ? scaleColor(rgb, f) : rgb;
    };

    const [r, g, b, a] = parseHexColorAlpha(background);
    const bg = dark ? scaleColor([r, g, b], f) : [r, g, b];

    return {
        memory: pick('#ef7014'),
        swap: pick('#52c15a'),
        zram: pick('#2e6fd0'),
        track: [bg[0], bg[1], bg[2], a],
    };
}

function render(path, {arrangement, dark, direction = 'ltr', background = '#8080804d',
    barLength = 56, barWidth = 8, barGap = 4, cornerRadius = 0, perBar = null, rotate = false}) {
    const p = plans();
    const geo = {barLength, barWidth, barGap, cornerRadius};
    const {width, height} = canvasSize({
        arrangement,
        rotate,
        barCount: p.length,
        barWidths: perBar?.map(entry => entry.width) ?? null,
        ...geo,
    });

    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32,
        Math.ceil(width * SCALE), Math.ceil(height * SCALE));
    const cr = new Cairo.Context(surface);

    const bg = dark ? [0.15, 0.15, 0.17, 1] : [0.97, 0.97, 0.97, 1];
    cr.setSourceRGBA(bg[0], bg[1], bg[2], bg[3]);
    cr.paint();

    cr.scale(SCALE, SCALE);
    drawBars(cr, width, height, p, colorsFor(dark, background),
        {arrangement, direction, rotate, barGeometry: perBar ?? undefined, ...geo});

    surface.writeToPNG(path);
    print(`wrote ${path}  (${width}x${height} logical)`);
}

const out = GLib.get_current_dir() + '/preview';
GLib.mkdir_with_parents(out, 0o755);

// Synthetic case: memory + disk swap + zram all in use
data.memTotal = 16000000; data.memUsed = 13000000;
data.swapTotal = 8000000; data.swapUsed = 3000000;
data.zramTotal = 4000000; data.zramUsed = 1500000;
data.virtTotal = data.swapTotal + data.zramTotal;
data.virtUsed = data.swapUsed + data.zramUsed;

// 默认值（圆角 0、间距 4、条宽 8、条长 56）
render(`${out}/rows-light.png`, {arrangement: 'rows', dark: false});
render(`${out}/rows-dark.png`, {arrangement: 'rows', dark: true});
render(`${out}/columns-light.png`, {arrangement: 'columns', dark: false});
render(`${out}/columns-dark.png`, {arrangement: 'columns', dark: true});

// 圆角 + 更大间距 + 更粗的条
render(`${out}/rounded-rows-light.png`,
    {arrangement: 'rows', dark: false, cornerRadius: 4, barGap: 8, barWidth: 10});
render(`${out}/rounded-columns-light.png`,
    {arrangement: 'columns', dark: false, cornerRadius: 4, barGap: 8, barLength: 64, barWidth: 12});

// 零间距、最大圆角、超长条
render(`${out}/extreme-rows-dark.png`,
    {arrangement: 'rows', dark: true, cornerRadius: 16, barGap: 0, barWidth: 14, barLength: 120});

// 填充方向：右侧为 0%
render(`${out}/rtl-rows-light.png`, {arrangement: 'rows', dark: false, direction: 'rtl'});
render(`${out}/rtl-rows-dark.png`, {arrangement: 'rows', dark: true, direction: 'rtl'});
render(`${out}/rtl-columns-light.png`,
    {arrangement: 'columns', dark: false, direction: 'rtl', barWidth: 14, cornerRadius: 3});

// 自定义背景色（不透明浅灰 / 深色 半透明 / 完全透明）
render(`${out}/bg-solid-rows-light.png`,
    {arrangement: 'rows', dark: false, background: '#cfcfcfff', cornerRadius: 3});
render(`${out}/bg-tint-rows-light.png`,
    {arrangement: 'rows', dark: false, background: '#2e6fd033', cornerRadius: 3});
render(`${out}/bg-transparent-rows-light.png`,
    {arrangement: 'rows', dark: false, background: '#00000000', cornerRadius: 3});

// 上下排列的独立宽度/圆角：内存条宽 12 圆角 5，虚拟内存条宽 5 直角
render(`${out}/perbar-rows-light.png`, {
    arrangement: 'rows',
    dark: false,
    barWidth: 20,        // 共同值应被独立值覆盖
    cornerRadius: 8,      // 共同值应被独立值覆盖
    perBar: [{width: 12, radius: 5}, {width: 5, radius: 0}],
});
// 独立值仅部分提供时回退共同值
render(`${out}/perbar-partial-rows-dark.png`, {
    arrangement: 'rows',
    dark: true,
    barWidth: 10,
    cornerRadius: 4,
    perBar: [{radius: 2}],
});

// 顺时针旋转 90°：上下排列 → 左右并排，填充改为自上而下
render(`${out}/rotate-rows-light.png`, {arrangement: 'rows', dark: false, rotate: true});
render(`${out}/rotate-rows-dark.png`, {arrangement: 'rows', dark: true, rotate: true});
render(`${out}/rotate-rows-rtl-light.png`,
    {arrangement: 'rows', dark: false, rotate: true, direction: 'rtl'});
// 左右排列旋转后变成上下叠放
render(`${out}/rotate-columns-light.png`,
    {arrangement: 'columns', dark: false, rotate: true, cornerRadius: 3});
// 旋转 + 独立宽度 / 圆角
render(`${out}/rotate-perbar-dark.png`, {
    arrangement: 'rows',
    dark: true,
    rotate: true,
    barLength: 64,
    perBar: [{width: 10, radius: 4}, {width: 6, radius: 4}],
});
