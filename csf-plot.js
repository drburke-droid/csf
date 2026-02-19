import { MAX_HUMAN_CUTOFF_CPD } from './qcsf-engine.js';

/**
 * Burke Vision Lab — CSF Plot (v8 — Clean)
 *
 * Displays the fitted CSF curve, trial markers, and predicted Snellen acuity.
 * Real-world object analysis is handled separately by CSF Explorer.
 *
 * SNELLEN ACUITY:
 *    20/20 letter = 5 arcmin, stroke = 1 arcmin → critical SF ~30 cpd
 *    Acuity cutoff = frequency where CSF crosses sensitivity = 1
 *    Predicted Snellen = 20 / (20 * 30 / cutoff_cpd)
 */

export function drawCSFPlot(canvas, engine, params) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = 1440, cssH = 1000;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width  = '100%';
    canvas.style.height = 'auto';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = cssW, H = cssH;
    const pad = { top: 40, right: 52, bottom: 230, left: 280 };
    const pW = W - pad.left - pad.right;
    const pH = H - pad.top  - pad.bottom;

    const lfMin = -0.3, lfMax = 1.75;

    // ── Auto-scale Y-axis: compute curve first, scan for max logS ──
    const curve = engine.getCSFCurve(params);
    let computedLsMax = 2.65;
    for (const pt of curve) {
        if (pt.logS > computedLsMax) computedLsMax = pt.logS;
    }
    for (const trial of engine.history) {
        const trialLogS = -engine.stimGrid[trial.stimIndex].logContrast;
        if (trialLogS > computedLsMax) computedLsMax = trialLogS;
    }
    const lsMax = computedLsMax + 0.15;

    const lsMin = -0.3;
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
    if (lsMax > Math.log10(300) + 0.1) senss.push(1000);
    if (lsMax > Math.log10(1000) + 0.1) senss.push(3000);
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

    // ── CSF Curve rendering ──
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
        const y = tY(pt.logS);
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

    // ── Trial markers (graded coloring by angular distance) ──
    for (const trial of engine.history) {
        const s = engine.stimGrid[trial.stimIndex];
        const x = tX(Math.log10(s.freq));
        const y = tY(-s.logContrast);
        if (y < pad.top || y > pad.top + pH) continue;
        const d = trial.angularDistance;
        let radius, color;
        if (d === 0) {
            radius = 4; color = 'rgba(0,255,150,0.55)';      // correct — green
        } else if (d === 1) {
            radius = 3.5; color = 'rgba(180,255,80,0.45)';    // close — yellow-green
        } else {
            radius = 3; color = 'rgba(255,80,80,0.45)';       // far/none — red
        }
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
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

    return canvas.toDataURL('image/png', 0.92);
}
