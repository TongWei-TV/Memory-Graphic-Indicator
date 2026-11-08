// SPDX-License-Identifier: GPL-2.0-or-later
// Memory Graphic Indicator - memory usage graphics for the GNOME Shell panel
// Copyright (C) 2026 TongWei-TV

'use strict';

import GLib from 'gi://GLib';

const MEMINFO_PATH = '/proc/meminfo';
const SWAPS_PATH = '/proc/swaps';

let decoder = null;

function decode(bytes) {
    if (!decoder)
        decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok || !bytes || bytes.length === 0)
            return null;
        return decode(bytes);
    } catch (e) {
        return null;
    }
}

function parseMeminfo(text) {
    const values = {};
    for (const line of text.split('\n')) {
        const match = /^([A-Za-z_()0-9]+):\s+(\d+)(?:\s+kB)?\s*$/.exec(line);
        if (match)
            values[match[1]] = parseInt(match[2], 10);
    }
    return values;
}

/**
 * Splits /proc/swaps entries into disk swap and zram.
 * Returns null when the file cannot be parsed, so the caller can fall back
 * to the SwapTotal/SwapFree fields of /proc/meminfo.
 */
function parseSwaps(text) {
    const result = {swapTotal: 0, swapUsed: 0, zramTotal: 0, zramUsed: 0, found: false};

    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || /^Filename\b/i.test(trimmed))
            continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 4)
            continue;

        const name = parts[0];
        const size = parseInt(parts[2], 10);
        const used = parseInt(parts[3], 10);
        if (Number.isNaN(size) || Number.isNaN(used))
            continue;

        result.found = true;
        if (/zram/i.test(name)) {
            result.zramTotal += size;
            result.zramUsed += used;
        } else {
            result.swapTotal += size;
            result.swapUsed += used;
        }
    }

    return result;
}

/**
 * @returns {null|{
 *   memTotal: number, memUsed: number,
 *   swapTotal: number, swapUsed: number,
 *   zramTotal: number, zramUsed: number,
 *   virtTotal: number, virtUsed: number,
 * }} sizes in kB
 */
export function readUsage() {
    const meminfoText = readText(MEMINFO_PATH);
    if (!meminfoText)
        return null;

    const info = parseMeminfo(meminfoText);
    const memTotal = info.MemTotal ?? 0;
    if (memTotal <= 0)
        return null;

    const available = info.MemAvailable ?? (info.MemFree ?? 0);
    const memUsed = Math.min(memTotal, Math.max(0, memTotal - available));

    let swapTotal = 0;
    let swapUsed = 0;
    let zramTotal = 0;
    let zramUsed = 0;

    const swapsText = readText(SWAPS_PATH);
    const swaps = swapsText ? parseSwaps(swapsText) : null;

    if (swaps && swaps.found) {
        swapTotal = swaps.swapTotal;
        swapUsed = swaps.swapUsed;
        zramTotal = swaps.zramTotal;
        zramUsed = swaps.zramUsed;
    } else {
        swapTotal = info.SwapTotal ?? 0;
        swapUsed = Math.max(0, swapTotal - (info.SwapFree ?? 0));
    }

    const virtTotal = swapTotal + zramTotal;

    return {
        memTotal,
        memUsed,
        swapTotal,
        swapUsed,
        zramTotal,
        zramUsed,
        virtTotal,
        virtUsed: swapUsed + zramUsed,
    };
}

export function formatKb(kb) {
    const bytes = Math.max(0, kb) * 1024;
    const gib = bytes / (1024 ** 3);
    if (gib >= 1)
        return `${gib.toFixed(1)} GB`;

    const mib = bytes / (1024 ** 2);
    if (mib >= 1)
        return `${mib.toFixed(0)} MB`;

    return `${Math.round(bytes / 1024)} kB`;
}
