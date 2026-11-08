// SPDX-License-Identifier: GPL-2.0-or-later
// Memory Graphic Indicator - memory usage graphics for the GNOME Shell panel
// Copyright (C) 2026 TongWei-TV

'use strict';

const FALLBACK = [0.2, 0.5, 0.9];

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

/**
 * Parses "#rgb" / "#rrggbb" / "#rrggbbaa" into [r, g, b] in the 0..1 range.
 */
export function parseHexColor(value) {
    const [r, g, b] = parseHexColorAlpha(value);
    return [r, g, b];
}

/**
 * Parses "#rgb" / "#rrggbb" / "#rrggbbaa" into [r, g, b, a].
 * A missing alpha channel yields 1.
 */
export function parseHexColorAlpha(value) {
    if (typeof value !== 'string')
        return [...FALLBACK, 1];

    let hex = value.trim().replace(/^#/, '');
    if (hex.length === 3)
        hex = hex.split('').map(c => c + c).join('');

    const hasAlpha = hex.length === 8;
    if (hasAlpha)
        hex = hex.slice(0, 6);

    if (!/^[0-9a-fA-F]{6}$/.test(hex))
        return [...FALLBACK, 1];

    const alpha = hasAlpha ? parseInt(value.trim().replace(/^#/, '').slice(6, 8), 16) / 255 : 1;

    return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        clamp01(alpha),
    ];
}

/**
 * Lowers the luminance of a colour by multiplying its channels.
 */
export function scaleColor(rgb, factor) {
    return [
        clamp01(rgb[0] * factor),
        clamp01(rgb[1] * factor),
        clamp01(rgb[2] * factor),
    ];
}

export function rgbToHex(rgb) {
    const toHex = channel => Math.round(clamp01(channel) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}
