// SPDX-License-Identifier: GPL-2.0-or-later
// Memory Graphic Indicator - memory usage graphics for the GNOME Shell panel
// Copyright (C) 2026 TongWei-TV

'use strict';

import Gio from 'gi://Gio';

const MEMINFO_PATH = '/proc/meminfo';
const SWAPS_PATH = '/proc/swaps';

let decoder = null;

function decode(bytes) {
    if (!decoder)
        decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

/**
 * Reads a text file asynchronously. Calls back with the decoded text, or
 * null when the file cannot be read / parsed. `cancellable` may be null.
 */
function readTextAsync(path, cancellable, callback) {
    const file = Gio.File.new_for_path(path);
    file.load_contents_async(cancellable, (source, result) => {
        let text = null;
        try {
            // GJS returns [ok, contents, etag] here.
            const [, bytes] = source.load_contents_finish(result);
            if (bytes && bytes.length > 0)
                text = decode(bytes);
        } catch (e) {
            text = null;
        }
        callback(text);
    });
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

function buildUsage(info, swaps) {
    const memTotal = info.MemTotal ?? 0;
    if (memTotal <= 0)
        return null;

    const available = info.MemAvailable ?? (info.MemFree ?? 0);
    const memUsed = Math.min(memTotal, Math.max(0, memTotal - available));

    let swapTotal = 0;
    let swapUsed = 0;
    let zramTotal = 0;
    let zramUsed = 0;

    if (swaps && swaps.found) {
        swapTotal = swaps.swapTotal;
        swapUsed = swaps.swapUsed;
        zramTotal = swaps.zramTotal;
        zramUsed = swaps.zramUsed;
    } else {
        swapTotal = info.SwapTotal ?? 0;
        swapUsed = Math.max(0, swapTotal - (info.SwapFree ?? 0));
    }

    return {
        memTotal,
        memUsed,
        swapTotal,
        swapUsed,
        zramTotal,
        zramUsed,
        virtTotal: swapTotal + zramTotal,
        virtUsed: swapUsed + zramUsed,
    };
}

/**
 * Reads /proc/meminfo and /proc/swaps without blocking the main loop.
 * Calls back with the usage object (sizes in kB), or null when the data
 * cannot be read. Both reads are chained; `cancellable` aborts both.
 */
export function readUsageAsync(cancellable, callback) {
    readTextAsync(MEMINFO_PATH, cancellable, meminfoText => {
        if (!meminfoText) {
            callback(null);
            return;
        }

        const info = parseMeminfo(meminfoText);
        if ((info.MemTotal ?? 0) <= 0) {
            callback(null);
            return;
        }

        readTextAsync(SWAPS_PATH, cancellable, swapsText => {
            callback(buildUsage(info, swapsText ? parseSwaps(swapsText) : null));
        });
    });
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
