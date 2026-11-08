// SPDX-License-Identifier: GPL-2.0-or-later
// Memory Graphic Indicator - memory usage graphics for the GNOME Shell panel
// Copyright (C) 2026 TongWei-TV

'use strict';

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseHexColor, parseHexColorAlpha, scaleColor} from './lib/colors.js';
import {canvasSize, drawBars} from './lib/drawing.js';
import {formatKb, readUsage} from './lib/memory.js';

const SETTINGS_KEYS = [
    'show-virtual-memory',
    'arrangement',
    'bar-order',
    'bar-direction',
    'rotate',
    'bar-length',
    'bar-width',
    'bar-gap',
    'corner-radius',
    'per-bar-size',
    'memory-width',
    'virtual-width',
    'memory-radius',
    'virtual-radius',
    'update-interval',
    'color-memory',
    'color-swap',
    'color-zram',
    'color-background',
    'dark-brightness',
];

// Keys that change the canvas size and therefore need a resize, not only a repaint.
const GEOMETRY_KEYS = [
    'bar-length',
    'bar-width',
    'bar-gap',
    'per-bar-size',
    'memory-width',
    'virtual-width',
    'rotate',
];

export const MemoryBarIndicator = GObject.registerClass({
    GTypeName: 'MemoryBarIndicator',
}, class MemoryBarIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Memory Graphic Indicator', false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._data = null;
        this._timerId = 0;
        this._signals = [];

        this._area = new St.DrawingArea({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // St.DrawingArea's repaint hook is a signal (no arguments); the cairo
        // context is only valid inside the handler and is fetched explicitly.
        this._repaintId = this._area.connect('repaint', area => this._onRepaint(area));
        this.add_child(this._area);

        this._buildMenu();
        this._connectSignals();

        this._syncSize();
        this._refresh();
        this._restartTimer();
    }

    // ---------------------------------------------------------------- settings

    _connectSignals() {
        for (const key of SETTINGS_KEYS) {
            this._track(this._settings,
                this._settings.connect(`changed::${key}`, () => this._onSettingChanged(key)));
        }

        this._track(this._interfaceSettings,
            this._interfaceSettings.connect('changed::color-scheme', () => this._repaint()));

        try {
            const stSettings = St.Settings.get();
            if (stSettings) {
                this._track(stSettings,
                    stSettings.connect('notify::color-scheme', () => this._repaint()));
            }
        } catch (e) {
            // St.Settings not available, the gsettings value is used instead
        }
    }

    _track(object, id) {
        this._signals.push({object, id});
    }

    _onSettingChanged(key) {
        if (key === 'update-interval') {
            this._restartTimer();
            return;
        }

        if (key === 'show-virtual-memory' || key === 'arrangement' || GEOMETRY_KEYS.includes(key)) {
            this._syncSize();
            this._repaint();
            return;
        }

        this._repaint();
    }

    // -------------------------------------------------------------------- menu

    _buildMenu() {
        this._rows = {
            memory: this._addStatRow('内存'),
            swap: this._addStatRow('交换分区'),
            zram: this._addStatRow('ZRAM'),
        };

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupMenuItem('偏好设置…');
        prefsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefsItem);
    }

    _addStatRow(title) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({x_expand: true});
        const name = new St.Label({
            text: title,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const value = new St.Label({text: '—', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(name);
        box.add_child(value);
        item.add_child(box);
        this.menu.addMenuItem(item);

        return {item, value};
    }

    _updateMenu() {
        const data = this._data;
        if (!data)
            return;

        this._rows.memory.value.text = this._formatPair(data.memUsed, data.memTotal);

        const hasSwap = data.swapTotal > 0;
        this._rows.swap.item.visible = hasSwap;
        if (hasSwap)
            this._rows.swap.value.text = this._formatPair(data.swapUsed, data.swapTotal);

        const hasZram = data.zramTotal > 0;
        this._rows.zram.item.visible = hasZram;
        if (hasZram)
            this._rows.zram.value.text = this._formatPair(data.zramUsed, data.zramTotal);
    }

    _formatPair(used, total) {
        if (total <= 0)
            return '—';
        const percent = Math.round((used / total) * 100);
        return `${formatKb(used)} / ${formatKb(total)}   ${percent}%`;
    }

    // ------------------------------------------------------------------- state

    _arrangement() {
        return this._settings.get_string('arrangement') === 'columns' ? 'columns' : 'rows';
    }

    _direction() {
        return this._settings.get_string('bar-direction') === 'rtl' ? 'rtl' : 'ltr';
    }

    _rotate() {
        return this._settings.get_boolean('rotate');
    }

    /**
     * Order of the bars, always a complete ["memory", "virtual"] permutation.
     */
    _order() {
        let stored = [];
        try {
            stored = this._settings.get_strv('bar-order');
        } catch (e) {
            stored = [];
        }

        const keys = (stored ?? []).filter(key => key === 'memory' || key === 'virtual');
        if (!keys.includes('memory'))
            keys.unshift('memory');
        if (!keys.includes('virtual'))
            keys.push('virtual');

        return [...new Set(keys)];
    }

    _shouldShowVirtual() {
        if (!this._settings.get_boolean('show-virtual-memory'))
            return false;
        const data = this._data;
        return !!data && data.virtTotal > 0;
    }

    _barCount() {
        return this._shouldShowVirtual() ? 2 : 1;
    }

    _geometry() {
        return {
            barLength: this._settings.get_int('bar-length'),
            barWidth: this._settings.get_int('bar-width'),
            barGap: this._settings.get_int('bar-gap'),
            cornerRadius: this._settings.get_int('corner-radius'),
        };
    }

    /**
     * Per-bar thickness/radius overrides. Active only when the rows arrangement
     * is used AND the "per-bar-size" switch is on. Entries follow the dragged
     * bar order, so they line up with the plans drawn by _buildPlans(): entry 0
     * is whichever bar comes first. In columns mode both bars share
     * bar-width / corner-radius, so no overrides are passed either way.
     */
    _barGeometry() {
        if (this._arrangement() !== 'rows')
            return null;
        if (!this._settings.get_boolean('per-bar-size'))
            return null;

        const byKey = {
            memory: {
                width: this._settings.get_int('memory-width'),
                radius: this._settings.get_int('memory-radius'),
            },
            virtual: {
                width: this._settings.get_int('virtual-width'),
                radius: this._settings.get_int('virtual-radius'),
            },
        };

        return this._order().map(key => byKey[key]);
    }

    _syncSize() {
        const {width, height} = canvasSize({
            arrangement: this._arrangement(),
            rotate: this._rotate(),
            barCount: this._barCount(),
            barWidths: this._barGeometry()?.map(entry => entry.width) ?? null,
            ...this._geometry(),
        });

        if (this._sizedWidth !== width || this._sizedHeight !== height) {
            this._area.set_size(width, height);
            this._sizedWidth = width;
            this._sizedHeight = height;
        }
    }

    _refresh() {
        const data = readUsage();
        if (!data)
            return;

        this._data = data;
        this._syncSize();
        this._updateMenu();
        this._repaint();
    }

    _repaint() {
        this._area.queue_repaint();
    }

    _restartTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        const interval = Math.max(200, this._settings.get_int('update-interval'));
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _isDark() {
        let scheme = null;
        try {
            scheme = St.Settings.get().color_scheme;
        } catch (e) {
            scheme = null;
        }

        if (scheme === St.SystemColorScheme.PREFER_DARK)
            return true;
        if (scheme === St.SystemColorScheme.PREFER_LIGHT)
            return false;

        try {
            return this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        } catch (e) {
            return false;
        }
    }

    _getColors() {
        const dark = this._isDark();
        const factor = dark ? this._settings.get_double('dark-brightness') : 1.0;

        const pick = key => {
            const rgb = parseHexColor(this._settings.get_string(key));
            return dark ? scaleColor(rgb, factor) : rgb;
        };

        const [bgR, bgG, bgB, bgA] = parseHexColorAlpha(this._settings.get_string('color-background'));
        const track = dark ? scaleColor([bgR, bgG, bgB], factor) : [bgR, bgG, bgB];

        return {
            memory: pick('color-memory'),
            swap: pick('color-swap'),
            zram: pick('color-zram'),
            track: [track[0], track[1], track[2], bgA],
        };
    }

    /**
     * One plan per bar: physical memory, and virtual memory (swap + zram stacked).
     * The order follows the draggable "bar-order" setting.
     */
    _buildPlans() {
        const data = this._data;
        if (!data || data.memTotal <= 0)
            return [];

        const memoryPlan = {
            total: data.memTotal,
            segments: [{value: data.memUsed, color: 'memory'}],
        };

        if (!this._shouldShowVirtual())
            return [memoryPlan];

        const segments = [];
        if (data.swapTotal > 0)
            segments.push({value: data.swapUsed, color: 'swap'});
        if (data.zramTotal > 0)
            segments.push({value: data.zramUsed, color: 'zram'});

        const virtualPlan = {total: data.virtTotal, segments};

        return this._order().map(key => key === 'virtual' ? virtualPlan : memoryPlan);
    }

    // ----------------------------------------------------------------- drawing

    _onRepaint(area) {
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0)
            return;

        // The context is borrowed from the actor and only valid inside this
        // handler: never dispose it, and clear the surface before drawing.
        const cr = area.get_context();
        if (!cr)
            return;

        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.restore();

        drawBars(cr, width, height, this._buildPlans(), this._getColors(), {
            arrangement: this._arrangement(),
            direction: this._direction(),
            rotate: this._rotate(),
            barGeometry: this._barGeometry() ?? undefined,
            ...this._geometry(),
        });
    }

    // ----------------------------------------------------------------- cleanup

    _cleanup() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        if (this._repaintId) {
            try {
                this._area.disconnect(this._repaintId);
            } catch (e) {
                // already disposed
            }
            this._repaintId = 0;
        }

        for (const {object, id} of this._signals) {
            try {
                object.disconnect(id);
            } catch (e) {
                // already disposed
            }
        }

        this._signals = [];
        this._data = null;
    }

    destroy() {
        this._cleanup();
        super.destroy();
    }
});
