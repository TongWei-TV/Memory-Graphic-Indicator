// SPDX-License-Identifier: GPL-2.0-or-later
// Memory Graphic Indicator - memory usage graphics for the GNOME Shell panel
// Copyright (C) 2026 TongWei-TV

'use strict';

/**
 * Default geometry. Every value can be overridden by a GSettings key.
 * - barLength   : horizontal extent of one bar (always filled along this axis)
 * - barWidth    : thickness (perpendicular size) of one bar
 * - barGap      : space between the bars
 * - cornerRadius: corner rounding of each bar
 */
export const DEFAULTS = {
    barLength: 56,
    barWidth: 8,
    barGap: 4,
    cornerRadius: 0,
};

// Hides the anti-aliasing seam between two adjacent stacked segments.
const SEGMENT_OVERLAP = 0.5;

function normalize(options) {
    const merged = {...DEFAULTS, ...(options ?? {})};
    return {
        barLength: Math.max(1, Number(merged.barLength) || DEFAULTS.barLength),
        barWidth: Math.max(1, Number(merged.barWidth) || DEFAULTS.barWidth),
        barGap: Math.max(0, Number(merged.barGap) || 0),
        cornerRadius: Math.max(0, Number(merged.cornerRadius) || 0),
    };
}

function barPath(cr, x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    if (r <= 0) {
        cr.rectangle(x, y, w, h);
        return;
    }
    cr.newSubPath();
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.arc(x + w - r, y + r, r, 1.5 * Math.PI, 2 * Math.PI);
    cr.arc(x + w - r, y + h - r, r, 0, 0.5 * Math.PI);
    cr.arc(x + r, y + h - r, r, 0.5 * Math.PI, Math.PI);
    cr.closePath();
}

/**
 * Canvas size for the given arrangement and geometry.
 * - "rows"    : bars stacked vertically; `barWidths[i]` (when > 0) overrides
 *               the shared barWidth for bar i
 * - "columns" : bars side by side horizontally
 * - rotate    : the whole drawing is turned 90° clockwise, so the logical
 *               size is swapped (length becomes the vertical extent)
 */
export function canvasSize({arrangement = 'rows', barCount = 1, barWidths = null, rotate = false, ...options} = {}) {
    const {barLength, barWidth, barGap} = normalize(options);
    const count = Math.max(1, barCount);

    let width, height;

    if (arrangement === 'columns') {
        width = count * barLength + (count - 1) * barGap;
        height = barWidth;
    } else {
        let total = 0;
        for (let i = 0; i < count; i++)
            total += pickBarWidth(barWidths?.[i], barWidth);

        width = barLength;
        height = total + (count - 1) * barGap;
    }

    return rotate ? {width: height, height: width} : {width, height};
}

function pickBarWidth(value, fallback) {
    const width = Number(value);
    return Number.isFinite(width) && width > 0 ? width : fallback;
}

/**
 * @param {object} cr cairo context
 * @param {number} surfaceWidth surface width in pixels
 * @param {number} surfaceHeight surface height in pixels
 * @param {Array<{total: number, segments: Array<{value: number, color: string}>}>} plans
 * @param {object} colors map of segment name -> [r, g, b], plus "track" -> [r, g, b, a]
 * @param {object} options {arrangement, direction, rotate, barLength, barWidth, barGap, cornerRadius, barGeometry}
 */
export function drawBars(cr, surfaceWidth, surfaceHeight, plans, colors, options = {}) {
    if (!plans || plans.length === 0)
        return;

    const {barLength, barWidth, barGap, cornerRadius} = normalize(options);
    const arrangement = options.arrangement === 'columns' ? 'columns' : 'rows';
    const direction = options.direction === 'rtl' ? 'rtl' : 'ltr';
    const rotate = options.rotate === true;
    const perBar = Array.isArray(options.barGeometry) ? options.barGeometry : [];
    const count = plans.length;

    // Logical canvas: what the bars are laid out in. When rotated, the surface
    // is the transposed box and everything below is drawn in the untransposed
    // coordinate system.
    const width = rotate ? surfaceHeight : surfaceWidth;
    const height = rotate ? surfaceWidth : surfaceHeight;

    cr.save();

    if (rotate) {
        // 90° clockwise: (x, y) -> (surfaceWidth - y, x)
        cr.translate(surfaceWidth, 0);
        cr.rotate(Math.PI / 2);
    }

    let y = 0;
    for (let i = 0; i < count; i++) {
        const custom = perBar[i] ?? {};
        const thickness = arrangement === 'rows'
            ? pickBarWidth(custom.width, barWidth)
            : barWidth;
        const radius = Number.isFinite(Number(custom.radius)) && custom.radius !== undefined
            ? Math.max(0, Number(custom.radius))
            : cornerRadius;

        const box = arrangement === 'columns'
            ? {x: i * (barLength + barGap), y: 0, w: barLength, h: height}
            : {x: 0, y, w: width, h: thickness};

        if (arrangement === 'rows')
            y += thickness + barGap;

        drawBar(cr, plans[i], colors, box, radius, direction);
    }

    cr.restore();
}

function drawBar(cr, plan, colors, {x, y, w, h}, cornerRadius, direction) {
    cr.save();

    // Mirror around the bar's own centre so the fill grows from the right edge
    // while the arrangement order stays untouched.
    if (direction === 'rtl') {
        cr.translate(2 * x + w, 0);
        cr.scale(-1, 1);
    }

    barPath(cr, x, y, w, h, cornerRadius);
    cr.clip();

    const track = colors.track ?? [0, 0, 0, 0.16];
    cr.setSourceRGBA(track[0], track[1], track[2], track[3]);
    cr.paint();

    if (plan.total > 0) {
        let acc = 0; // accumulated fraction, 0..1
        let index = 0;
        const overlap = SEGMENT_OVERLAP / Math.max(1, w);

        for (const segment of plan.segments) {
            let fraction = segment.value / plan.total;
            if (!Number.isFinite(fraction) || fraction <= 0) {
                index++;
                continue;
            }

            fraction = Math.min(fraction, 1 - acc);
            if (fraction <= 0)
                break;

            const start = Math.max(0, acc - (index > 0 ? overlap : 0));
            const size = fraction + (index > 0 ? overlap : 0);
            const rgb = colors[segment.color] ?? colors.memory ?? [0.2, 0.5, 0.9];

            cr.setSourceRGBA(rgb[0], rgb[1], rgb[2], 1);
            cr.rectangle(x + start * w, y, size * w, h);
            cr.fill();

            acc += fraction;
            index++;

            if (acc >= 1)
                break;
        }
    }

    cr.restore();
}
