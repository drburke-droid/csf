import { MAX_HUMAN_CUTOFF_CPD } from './qcsf-engine.js';

/**
 * Burke Vision Lab — CSF Plot (v7 — AAA Quality)
 * 
 * Accurate real-world landmark pairs + predicted Snellen acuity.
 * 
 * LANDMARK CALCULATIONS (all long-distance scenarios):
 *
 * 1. Highway Exit Sign — FHWA Series E(Modified) 16" uppercase
 *    Reading at 250 ft (76 m): letter angle = atan(0.406/76) = 0.306 deg
 *    Critical SF for letter ID = 3 cycles/letter / 0.306 = ~10 cpd
 *    DAY: White on retroreflective green, Michelson ~0.85 → sens ~1.2 → plot 2
 *     NIGHT (worn sheeting): contrast ~0.03 → sens ~140
 *
 * 2. Golf Ball at 150 yd (137 m) — diam 42.7 mm
 *    Angle = atan(0.0427/137.16) = 0.0178 deg → cpd = 0.5/0.0178 = ~28 cpd
 *    ON GRASS: moderate luminance split, contrast ~0.50 → sens ~2
 *    CLOUDY SKY: white vs overcast grey, contrast ~0.10 → sens ~10
 *
 * 3. Pedestrian at 100 m — limb feature ~15 cm
 *    Feature angle = atan(0.15/100) = 0.086 deg → cpd = 1/(2*0.086) = ~6 cpd
 *    DAYLIGHT: dark on light pavement, contrast ~0.50 → sens ~2
 *    DUSK: dark on dark road, contrast ~0.03 → sens ~170
 *
 * 4. Vehicle Tail-lights at 500 m — pair separation ~1 m
 *    Angle = atan(1.0/500) = 0.115 deg → cpd = 1/(2*0.115) = ~4 cpd
 *    CLEAR: red lights on body color, contrast ~0.30 → sens ~3
 *    FOG: scattered, contrast ~0.03 → sens ~160
 *
 * SNELLEN ACUITY:
 *    20/20 letter = 5 arcmin, stroke = 1 arcmin → critical SF ~30 cpd
 *    Acuity cutoff = frequency where CSF crosses sensitivity = 1
 *    Predicted Snellen = 20 / (20 * 30 / cutoff_cpd)
 */

const LANDMARKS = [
    { name: 'Exit sign (day)',       freq: 10, sens: 2,    pair: 'sign' },
    { name: 'Exit sign (night)',     freq: 10, sens: 140,   pair: 'sign' },
    { name: 'Golf ball on grass',    freq: 28, sens: 2,    pair: 'golf' },
    { name: 'Golf ball, cloudy sky', freq: 28, sens: 10,   pair: 'golf' },
    { name: 'Pedestrian (day)',      freq: 6,  sens: 2,    pair: 'ped'  },
    { name: 'Pedestrian (dusk)',     freq: 6,  sens: 170,   pair: 'ped'  },
    { name: 'Tail-lights (clear)',   freq: 4,  sens: 3,    pair: 'car'  },
    { name: 'Tail-lights (fog)',     freq: 4,  sens: 160,   pair: 'car'  },
];

const PAIR_COLORS = {
    sign: '#5B9CF5',
    golf: '#F5A623',
    ped:  '#FF6B6B',
    car:  '#A78BFA',
};

export function drawCSFPlot(canvas, engine, params) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = 1440, cssH = 1000;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = cssW, H = cssH;
    const pad = { top: 40, right: 52, bottom: 230, left: 280 };
    const pW = W - pad.left - pad.right;
    const pH = H - pad.top  - pad.bottom;

    const lfMin = -0.3, lfMax = 1.75;
    const lsMin = -0.3, lsMax = 2.65;
    const tX = lf => pad.left + (lf - lfMin) / (lfMax - lfMin) * pW;
    const tY = ls => pad.top  + pH - (ls - lsMin) / (lsMax - lsMin) * pH;

    // ── Background ──
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0c0c10');
    bgGrad.addColorStop(1, '#08080c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Grid ──
    const freqs = [0.5, 1, 2, 4, 8, 16, 32];
    const senss = [1, 3, 10, 30, 100, 300];
    ctx.lineWidth = 1;

    freqs.forEach(f => {
        const x = tX(Math.log10(f));
        if (x < pad.left || x > pad.left + pW) return;
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + pH); ctx.stroke();
    });
    senss.forEach(s => {
        const y = tY(Math.log10(s));
        if (y < pad.top || y > pad.top + pH) return;
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pW, y); ctx.stroke();
    });

    // ── Landmark pairs — connecting lines ──
    const byPair = {};
    LANDMARKS.forEach(lm => { (byPair[lm.pair] = byPair[lm.pair] || []).push(lm); });

    Object.entries(byPair).forEach(([key, pts]) => {
        if (pts.length !== 2) return;
        const x1 = tX(Math.log10(pts[0].freq)), y1 = tY(Math.log10(pts[0].sens));
        const x2 = tX(Math.log10(pts[1].freq)), y2 = tY(Math.log10(pts[1].sens));
        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = PAIR_COLORS[key] || '#888';
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
    });

    // ── Landmark markers + labels ──
    LANDMARKS.forEach(lm => {
        const lx = tX(Math.log10(lm.freq));
        const ly = tY(Math.log10(lm.sens));
        if (lx < pad.left || lx > pad.left + pW || ly < pad.top || ly > pad.top + pH) return;
        const col = PAIR_COLORS[lm.pair] || '#888';

        // Diamond marker
        ctx.save();
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 5); ctx.lineTo(lx + 5, ly);
        ctx.lineTo(lx, ly + 5); ctx.lineTo(lx - 5, ly);
        ctx.closePath(); ctx.fill();

        // Label
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = col;
        ctx.font = '500 10px "DM Sans", -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lm.name, lx + 9, ly + 4);
        ctx.restore();
    });

    // ── CSF Curve data ──
    const curve = engine.getCSFCurve(params);
    const curvGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + pH);
    curvGrad.addColorStop(0, 'rgba(0,255,204,0.14)');
    curvGrad.addColorStop(0.7, 'rgba(0,255,204,0.03)');
    curvGrad.addColorStop(1, 'rgba(0,255,204,0.0)');

    // ── CSF Curve — smooth stroke with glow ──
    // Build array of plot points
    const pts = [];
    for (const pt of curve) {
        if (pt.logS < lsMin - 0.5) continue; // slight undershoot allowed for smoothing
        const x = tX(Math.log10(pt.freq));
        const y = tY(Math.min(pt.logS, lsMax));
        pts.push({ x, y, logS: pt.logS });
    }

    // Draw smooth curve using cardinal spline
    function drawSmoothCurve(points) {
        if (points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        if (points.length === 2) {
            ctx.lineTo(points[1].x, points[1].y);
            return;
        }
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
    }

    // Clip to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left - 1, pad.top - 1, pW + 2, pH + 2);
    ctx.clip();

    // Glow pass
    drawSmoothCurve(pts);
    ctx.strokeStyle = 'rgba(0,255,204,0.3)';
    ctx.lineWidth = 8;
    ctx.filter = 'blur(6px)';
    ctx.stroke();
    ctx.filter = 'none';

    // Main stroke
    drawSmoothCurve(pts);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // Gradient fill under curve
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, pW, pH);
    ctx.clip();
    const fillPts = pts.filter(p => p.logS >= lsMin);
    if (fillPts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(fillPts[0].x, fillPts[0].y);
        for (let i = 0; i < fillPts.length - 1; i++) {
            const p0 = fillPts[Math.max(0, i - 1)];
            const p1 = fillPts[i];
            const p2 = fillPts[i + 1];
            const p3 = fillPts[Math.min(fillPts.length - 1, i + 2)];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.lineTo(fillPts[fillPts.length - 1].x, pad.top + pH);
        ctx.lineTo(fillPts[0].x, pad.top + pH);
        ctx.closePath();
        ctx.fillStyle = curvGrad;
        ctx.fill();
    }
    ctx.restore();

    // ── Trial markers ──
    for (const trial of engine.history) {
        const s = engine.stimGrid[trial.stimIndex];
        const x = tX(Math.log10(s.freq));
        const y = tY(-s.logContrast);
        if (y < pad.top || y > pad.top + pH) continue;
        ctx.beginPath();
        ctx.arc(x, y, trial.correct ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = trial.correct ? 'rgba(0,255,150,0.5)' : 'rgba(255,80,80,0.45)';
        ctx.fill();
    }

    // ── Snellen Acuity prediction ──
    // Find x-intercept: where logS crosses 0 (sensitivity = 1, i.e. contrast = 100%)
    let cutoffCpd = NaN;
    for (let i = 1; i < curve.length; i++) {
        if (curve[i - 1].logS >= 0 && curve[i].logS < 0) {
            // Linear interpolation
            const f1 = Math.log10(curve[i - 1].freq), f2 = Math.log10(curve[i].freq);
            const s1 = curve[i - 1].logS, s2 = curve[i].logS;
            const frac = (0 - s1) / (s2 - s1);
            cutoffCpd = Math.pow(10, f1 + frac * (f2 - f1));
            break;
        }
    }

    if (!isNaN(cutoffCpd)) cutoffCpd = Math.min(cutoffCpd, MAX_HUMAN_CUTOFF_CPD);

    if (!isNaN(cutoffCpd) && cutoffCpd > 0.5 && cutoffCpd <= MAX_HUMAN_CUTOFF_CPD) {
        const snellenDenom = Math.round(20 * 30 / cutoffCpd);
        const cx = tX(Math.log10(cutoffCpd));
        const cy = tY(0);

        // Marker
        ctx.save();
        ctx.fillStyle = '#00ffcc';
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0c0c10';
        ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();

        // Label
        ctx.fillStyle = 'rgba(0,255,204,0.85)';
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        const label = `20/${snellenDenom}`;
        const labelY = cy - 14;
        ctx.fillText(label, cx, labelY);
        ctx.font = '10px "DM Sans", sans-serif';
        ctx.fillStyle = 'rgba(0,255,204,0.5)';
        ctx.fillText('Predicted Acuity', cx, labelY - 14);
        ctx.restore();
    }

    // ── X-Axis ──
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '600 36px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    freqs.forEach(f => {
        const x = tX(Math.log10(f));
        if (x >= pad.left && x <= pad.left + pW)
            ctx.fillText(String(f), x, pad.top + pH + 56);
    });
    // Primary label
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.font = '500 39px "DM Sans", sans-serif';
    ctx.fillText('Level of Detail', W / 2, pad.top + pH + 112);
    // Secondary scientific label
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.font = '30px "JetBrains Mono", monospace';
    ctx.fillText('Spatial Frequency (cpd)', W / 2, pad.top + pH + 154);
    // Range
    ctx.font = '500 27px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.textAlign = 'left';
    ctx.fillText('Coarse', pad.left, pad.top + pH + 204);
    ctx.textAlign = 'right';
    ctx.fillText('Fine', pad.left + pW, pad.top + pH + 204);

    // ── Y-Axis ──
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '600 36px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    senss.forEach(s => {
        const y = tY(Math.log10(s));
        if (y >= pad.top && y <= pad.top + pH)
            ctx.fillText(String(s), pad.left - 24, y + 12);
    });
    // Primary label (rotated)
    ctx.save();
    ctx.translate(34, H / 2 - 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.font = '500 39px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Boldness', 0, 0);
    ctx.restore();
    // Secondary scientific label
    ctx.save();
    ctx.translate(112, H / 2 - 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.font = '30px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Sensitivity (1/contrast)', 0, 0);
    ctx.restore();
    // Range labels
    ctx.save();
    ctx.translate(168, pad.top + pH);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '500 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Black on White', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(168, pad.top);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '500 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('Gray on Gray', 0, 0);
    ctx.restore();

    // ── Plot border ──
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, pW, pH);

    // ── Legend ──
    const legX = pad.left + 10, legY = pad.top + 12;
    ctx.font = '500 8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    let row = 0;
    Object.entries(PAIR_COLORS).forEach(([key, col]) => {
        const labels = { sign: 'Exit Sign', golf: 'Golf Ball', ped: 'Pedestrian', car: 'Tail-lights' };
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(legX, legY + row * 13, 8, 8);
        ctx.globalAlpha = 0.4;
        ctx.fillText(labels[key] || key, legX + 12, legY + row * 13 + 7);
        ctx.globalAlpha = 1.0;
        row++;
    });

    return canvas.toDataURL('image/png', 0.92);
}
