// SPDX-License-Identifier: GPL-2.0-or-later
// Memory Graphic Indicator - memory usage graphics for the GNOME Shell panel
// Copyright (C) 2026 TongWei-TV

'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ARRANGEMENT_VALUES = ['rows', 'columns'];
const DIRECTION_VALUES = ['ltr', 'rtl'];
const BAR_LABELS = {
    memory: '内存',
    virtual: '虚拟内存（swap + zram）',
};

function normalizeOrder(stored) {
    const keys = (stored ?? []).filter(key => BAR_LABELS[key]);
    if (!keys.includes('memory'))
        keys.unshift('memory');
    if (!keys.includes('virtual'))
        keys.push('virtual');
    return [...new Set(keys)];
}

function isSameOrder(a, b) {
    return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Two drag-and-drop rows: dragging one onto the other swaps their order.
 * The same order is used for both the rows (top/bottom) and columns (left/right)
 * arrangement, since it is just the sequence of the bars.
 */
function createOrderGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: '顺序',
        description: '拖动右侧手柄互换位置',
    });

    const rows = new Map();
    let currentOrder = normalizeOrder(settings.get_strv('bar-order'));
    let draggedKey = null;

    const applyOrder = keys => {
        for (const row of rows.values())
            group.remove(row);
        for (const key of keys)
            group.add(rows.get(key));

        currentOrder = keys;
        // Write back whenever the raw stored value differs, so a corrupted
        // value (or one typed in via dconf) gets replaced by a valid one.
        const stored = settings.get_strv('bar-order') ?? [];
        if (!isSameOrder(stored, keys))
            settings.set_strv('bar-order', keys);
    };

    const moveRow = (fromKey, toKey) => {
        if (!fromKey || !toKey || fromKey === toKey)
            return;

        const order = [...currentOrder];
        const from = order.indexOf(fromKey);
        const to = order.indexOf(toKey);
        if (from < 0 || to < 0)
            return;

        order.splice(from, 1);
        order.splice(to, 0, fromKey);
        applyOrder(order);
    };

    const buildRow = key => {
        const row = new Adw.ActionRow({title: BAR_LABELS[key]});

        const handle = new Gtk.Image({
            icon_name: 'list-drag-handle-symbolic',
            pixel_size: 16,
            css_classes: ['dim-label'],
        });
        handle.set_cursor_from_name('grab');
        row.add_suffix(handle);

        const source = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        source.connect('prepare', () => {
            draggedKey = key;
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            value.set_string(key);
            return Gdk.ContentProvider.new_for_value(value);
        });
        source.connect('drag-end', () => {
            draggedKey = null;
        });
        row.add_controller(source);

        // NB: GJS exposes gtk_drop_target_new() as a plain function, not a
        // constructor, so `new Gtk.DropTarget(...)` throws.
        const target = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        target.connect('drop', () => {
            moveRow(draggedKey, key);
            return true;
        });
        row.add_controller(target);

        rows.set(key, row);
        return row;
    };

    for (const key of currentOrder)
        group.add(buildRow(key));

    settings.connect('changed::bar-order', () => {
        const next = normalizeOrder(settings.get_strv('bar-order'));
        if (!isSameOrder(currentOrder, next))
            applyOrder(next);
    });

    return group;
}

function clampByte(value) {
    return Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, '0');
}

function rgbaToHex(rgba, withAlpha = false) {
    const base = `#${clampByte(rgba.red)}${clampByte(rgba.green)}${clampByte(rgba.blue)}`;
    return withAlpha ? `${base}${clampByte(rgba.alpha)}` : base;
}

function rgbaFromHex(value) {
    const rgba = new Gdk.RGBA();
    rgba.parse(value);
    return rgba;
}

function createColorButton(settings, key, withAlpha = false) {
    const rgba = rgbaFromHex(settings.get_string(key));
    let button;

    if (typeof Gtk.ColorDialogButton !== 'undefined' && typeof Gtk.ColorDialog !== 'undefined') {
        const dialog = new Gtk.ColorDialog({with_alpha: withAlpha, modal: true});
        button = new Gtk.ColorDialogButton({
            dialog,
            rgba,
            valign: Gtk.Align.CENTER,
        });
    } else {
        button = new Gtk.ColorButton({
            rgba,
            use_alpha: withAlpha,
            valign: Gtk.Align.CENTER,
        });
    }

    let syncing = false;

    button.connect('notify::rgba', () => {
        if (syncing)
            return;
        settings.set_string(key, rgbaToHex(button.get_rgba(), withAlpha));
    });

    settings.connect(`changed::${key}`, () => {
        const next = rgbaFromHex(settings.get_string(key));
        const current = button.get_rgba();
        const same = Math.abs(next.red - current.red) < 0.002 &&
            Math.abs(next.green - current.green) < 0.002 &&
            Math.abs(next.blue - current.blue) < 0.002 &&
            (!withAlpha || Math.abs(next.alpha - current.alpha) < 0.002);
        if (same)
            return;

        syncing = true;
        button.set_rgba(next);
        syncing = false;
    });

    return button;
}

function addColorRow(group, settings, key, title, subtitle, withAlpha = false) {
    const row = new Adw.ActionRow({title, subtitle});
    row.add_suffix(createColorButton(settings, key, withAlpha));
    group.add(row);
    return row;
}

function createComboRow({title, subtitle, labels, values, getValue, setValue}) {
    const model = Gtk.StringList.new(labels);
    const row = new Adw.ComboRow({title, subtitle, model});

    row.set_selected(Math.max(0, values.indexOf(getValue())));

    row.connect('notify::selected', () => {
        const value = values[row.get_selected()];
        if (value !== undefined && value !== getValue())
            setValue(value);
    });

    return row;
}

function createIntSpinRow({settings, key, title, subtitle, lower, upper, step = 1}) {
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: Math.max(step, 2),
        value: settings.get_int(key),
    });

    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment,
        digits: 0,
    });

    let syncing = false;

    adjustment.connect('value-changed', () => {
        if (syncing)
            return;
        const value = Math.round(adjustment.get_value());
        if (settings.get_int(key) !== value)
            settings.set_int(key, value);
    });

    settings.connect(`changed::${key}`, () => {
        const value = settings.get_int(key);
        if (Math.round(adjustment.get_value()) === value)
            return;
        syncing = true;
        adjustment.set_value(value);
        syncing = false;
    });

    return row;
}

export default class MemoryBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(620, 680);

        const page = new Adw.PreferencesPage({
            title: '外观与行为',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ------------------------------------------------------------- 外观
        const displayGroup = new Adw.PreferencesGroup({
            title: '显示',
            description: '面板上的图形如何绘制',
        });
        page.add(displayGroup);

        const virtualRow = new Adw.SwitchRow({
            title: '显示虚拟内存',
            subtitle: '内存与虚拟内存各占一图；虚拟内存条内 swap 与 zram 同处一图',
        });
        settings.bind('show-virtual-memory', virtualRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(virtualRow);

        displayGroup.add(createComboRow({
            title: '排列方式',
            subtitle: '图形始终横向填充，这里只决定两个图形间的相对位置',
            labels: ['上下（叠放）', '左右（并排）'],
            values: ARRANGEMENT_VALUES,
            getValue: () => settings.get_string('arrangement'),
            setValue: value => settings.set_string('arrangement', value),
        }));

        displayGroup.add(createComboRow({
            title: '图形方向',
            subtitle: '图形起始端，即 0% 端',
            labels: ['左（右侧为 100%）', '右（右侧为 0%）'],
            values: DIRECTION_VALUES,
            getValue: () => settings.get_string('bar-direction'),
            setValue: value => settings.set_string('bar-direction', value),
        }));

        const intervalAdjustment = new Gtk.Adjustment({
            lower: 200,
            upper: 60000,
            step_increment: 100,
            page_increment: 1000,
            value: settings.get_int('update-interval'),
        });
        const intervalRow = new Adw.SpinRow({
            title: '刷新间隔',
            subtitle: '单位：毫秒（200 – 60000）',
            adjustment: intervalAdjustment,
            digits: 0,
        });
        intervalAdjustment.connect('value-changed', () => {
            const value = Math.round(intervalAdjustment.get_value());
            if (settings.get_int('update-interval') !== value)
                settings.set_int('update-interval', value);
        });
        settings.connect('changed::update-interval', () => {
            const value = settings.get_int('update-interval');
            if (Math.round(intervalAdjustment.get_value()) !== value)
                intervalAdjustment.set_value(value);
        });
        displayGroup.add(intervalRow);

        const rotateRow = new Adw.SwitchRow({
            title: '旋转',
            subtitle: '想要竖向显示想要的不得了？试试这个开关。（图形组合整体顺时针旋转 90°）',
        });
        settings.bind('rotate', rotateRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(rotateRow);

        // ------------------------------------------------------------- 顺序
        page.add(createOrderGroup(settings));

        // ------------------------------------------------------------- 尺寸
        const sizeGroup = new Adw.PreferencesGroup({
            title: '尺寸',
            description: '像素单位',
        });
        page.add(sizeGroup);

        sizeGroup.add(createIntSpinRow({
            settings,
            key: 'bar-length',
            title: '图形长度',
            subtitle: '图形的长度，即图形0-100%的尺寸（12 – 320）',
            lower: 12,
            upper: 320,
            step: 1,
        }));

        sizeGroup.add(createIntSpinRow({
            settings,
            key: 'bar-gap',
            title: '图形间距',
            subtitle: '两图形之间的空隙（0 – 24）',
            lower: 0,
            upper: 24,
            step: 1,
        }));

        const perBarSwitch = new Adw.SwitchRow({
            title: '独立调节图形',
            subtitle: '开启：内存图与虚拟内存图分别设置宽度与圆角；关闭：两图共用',
        });
        sizeGroup.add(perBarSwitch);

        // 独立调节行（开关开 + 上下排列时可见）
        const perBarRows = [];
        const addPerBarRow = (key, title, subtitle, lower, upper) => {
            const row = createIntSpinRow({settings, key, title, subtitle, lower, upper, step: 1});
            perBarRows.push(row);
            sizeGroup.add(row);
        };

        addPerBarRow('memory-width', '内存图宽度',
            '上下排列时内存图的宽度（2 – 32）', 2, 32);
        addPerBarRow('memory-radius', '内存图圆角',
            '上下排列时内存图的圆角，0 为直角（0 – 16）', 0, 16);
        addPerBarRow('virtual-width', '虚拟内存图宽度',
            '上下排列时虚拟内存图的宽度（2 – 32）', 2, 32);
        addPerBarRow('virtual-radius', '虚拟内存图圆角',
            '上下排列时虚拟内存图的圆角，0 为直角（0 – 16）', 0, 16);

        // 共同行（开关关或左右排列时可见）
        const commonHeightRow = createIntSpinRow({
            settings,
            key: 'bar-width',
            title: '图形宽度',
            subtitle: '两图共用的宽度（2 – 32）',
            lower: 2,
            upper: 32,
            step: 1,
        });
        sizeGroup.add(commonHeightRow);

        const commonRadiusRow = createIntSpinRow({
            settings,
            key: 'corner-radius',
            title: '图形圆角',
            subtitle: '两图共用的圆角，0 为直角（0 – 16）',
            lower: 0,
            upper: 16,
            step: 1,
        });
        sizeGroup.add(commonRadiusRow);

        const commonRows = [commonHeightRow, commonRadiusRow];

        // 记忆式强制关闭：左右排列时只在界面上把开关显示为关并置灰，
        // 不改写存储值；切回上下时自动恢复之前的状态。
        let suppressSwitch = false;

        perBarSwitch.connect('notify::active', () => {
            if (suppressSwitch || !perBarSwitch.get_sensitive())
                return;
            if (settings.get_boolean('per-bar-size') !== perBarSwitch.get_active())
                settings.set_boolean('per-bar-size', perBarSwitch.get_active());
        });

        const syncSizeVisibility = () => {
            const columns = settings.get_string('arrangement') === 'columns';
            const perBar = !columns && settings.get_boolean('per-bar-size');

            suppressSwitch = true;
            perBarSwitch.set_active(perBar);
            suppressSwitch = false;
            perBarSwitch.set_sensitive(!columns);

            for (const row of perBarRows)
                row.set_visible(perBar);
            for (const row of commonRows)
                row.set_visible(!perBar);
        };
        syncSizeVisibility();
        settings.connect('changed::per-bar-size', syncSizeVisibility);
        settings.connect('changed::arrangement', syncSizeVisibility);

        // ------------------------------------------------------------- 颜色
        const colorGroup = new Adw.PreferencesGroup({
            title: '颜色（亮色模式）',
            description: '暗色模式下会统一按亮度系数压暗，无需单独设置',
        });
        page.add(colorGroup);

        addColorRow(colorGroup, settings, 'color-memory', '内存',
            '物理内存占用的颜色');
        addColorRow(colorGroup, settings, 'color-swap', '交换分区',
            '虚拟内存图中 swap 分段的颜色');
        addColorRow(colorGroup, settings, 'color-zram', 'ZRAM',
            '虚拟内存图中 zram 分段的颜色');
        addColorRow(colorGroup, settings, 'color-background', '背景',
            '条形中未占用部分的底色，支持透明度', true);

        const brightnessAdjustment = new Gtk.Adjustment({
            lower: 0.2,
            upper: 1.0,
            step_increment: 0.02,
            page_increment: 0.1,
            value: settings.get_double('dark-brightness'),
        });
        const brightnessRow = new Adw.SpinRow({
            title: '暗色模式亮度系数',
            subtitle: '1.0 表示不压暗，越小越暗',
            adjustment: brightnessAdjustment,
            digits: 2,
        });
        brightnessAdjustment.connect('value-changed', () => {
            const value = Math.round(brightnessAdjustment.get_value() * 100) / 100;
            if (Math.abs(settings.get_double('dark-brightness') - value) > 0.001)
                settings.set_double('dark-brightness', value);
        });
        settings.connect('changed::dark-brightness', () => {
            const value = settings.get_double('dark-brightness');
            if (Math.abs(brightnessAdjustment.get_value() - value) > 0.001)
                brightnessAdjustment.set_value(value);
        });
        colorGroup.add(brightnessRow);

        // ------------------------------------------------------------- 说明
        const aboutGroup = new Adw.PreferencesGroup({title: '说明'});
        page.add(aboutGroup);

        const infoRow = new Adw.ActionRow({
            title: '关于虚拟内存',
            subtitle: '虚拟内存 = 磁盘 swap + zram。若系统只使用 zram，则只显示 zram 分段。',
        });
        aboutGroup.add(infoRow);
    }
}
