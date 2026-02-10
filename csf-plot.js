/**
 * BurkeCSF — Enhanced CSF Plot
 * ============================
 * Dual axis labels: technical (cpd, sensitivity) + layman terms.
 * Real-world landmarks plotted as reference points.
 * Returns canvas data URL for sharing with tablet.
 */

// Real-world landmarks: { name, freq (cpd), sensitivity, description }
const LANDMARKS = [
    { name: 'Highway sign',     freq: 2,    sens: 5,    desc: 'Road sign at design distance', icon: '🛣️' },
    { name: 'Face recognition', freq: 4,    sens: 15,   desc: 'Recognizing a face across a room', icon: '👤' },
    { name: 'Golf ball',        freq: 12,   sens: 50,   desc: 'White ball, overcast sky, 150yd', icon: '⛳' },
    { name: 'Night driving',    freq: 1.5,  sens: 3,    desc: 'Low-contrast sign at dusk', icon: '🌙' },
    { name: 'Fine print',       freq: 20,   sens: 100,  desc: '6pt text at reading distance', icon: '📄' },
];

/**
 * Draw the CSF plot with enhanced labels and landmarks.
 * @param {HTMLCanvasElement} canvas
 * @param {object} engine - QCSFEngine
 * @param {object} params - CSF parameters
 * @returns {string} data URL of the rendered plot
 */
export function drawCSFPlot(canvas, engine, params) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = 560, cssH = 340;
    canvas.width  = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = cssW, H = cssH;
    const pad = { top: 24, right: 28, bottom: 58, left: 72 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    const logFMin = -0.3, logFMax = 1.7;
    const logSMin = -0.3, logSMax = 2.5;

    const toX = logF => pad.left + (logF - logFMin) / (logFMax - logFMin) * plotW;
    const toY = logS => pad.top  + plotH - (logS - logSMin) / (logSMax - logSMin) * plotH;

    // ── Background ──
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // ── Grid ──
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (const f of [0.5, 1, 2, 4, 8, 16, 32]) {
        const x = toX(Math.log10(f));
        if (x >= pad.left && x <= pad.left + plotW) {
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
        }
    }
    for (const s of [1, 3, 10, 30, 100, 300]) {
        const y = toY(Math.log10(s));
        if (y >= pad.top && y <= pad.top + plotH) {
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
        }
    }

    // ── Landmarks ──
    for (const lm of LANDMARKS) {
        const lx = toX(Math.log10(lm.freq));
        const ly = toY(Math.log10(lm.sens));
        if (lx < pad.left || lx > pad.left + plotW || ly < pad.top || ly > pad.top + plotH) continue;

        // Diamond marker
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(lx, ly - 4); ctx.lineTo(lx + 4, ly); ctx.lineTo(lx, ly + 4); ctx.lineTo(lx - 4, ly);
        ctx.closePath(); ctx.fill();

        // Label
        ctx.globalAlpha = 0.2;
        ctx.font = '8px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lm.name, lx + 7, ly + 3);
        ctx.restore();
    }

    // ── CSF Curve ──
    const curve = engine.getCSFCurve(params);
    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, 'rgba(0,255,204,0.08)');
    grad.addColorStop(1, 'rgba(0,255,204,0.0)');

    ctx.beginPath();
    let started = false, firstX, lastX, lastY;
    for (const pt of curve) {
        if (pt.logS < logSMin) continue;
        const x = toX(Math.log10(pt.freq));
        const y = toY(Math.min(pt.logS, logSMax));
        if (!started) { ctx.moveTo(x, y); firstX = x; started = true; }
        else ctx.lineTo(x, y);
        lastX = x; lastY = y;
    }
    // Fill
    ctx.lineTo(lastX, pad.top + plotH);
    ctx.lineTo(firstX, pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke
    ctx.beginPath(); started = false;
    for (const pt of curve) {
        if (pt.logS < logSMin) continue;
        const x = toX(Math.log10(pt.freq));
        const y = toY(Math.min(pt.logS, logSMax));
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(0,255,204,0.3)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── Trial markers ──
    for (const trial of engine.history) {
        const s = engine.stimGrid[trial.stimIndex];
        const x = toX(Math.log10(s.freq));
        const y = toY(-s.logContrast);
        if (y < pad.top || y > pad.top + plotH) continue;
        ctx.beginPath();
        ctx.arc(x, y, trial.correct ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = trial.correct ? 'rgba(0,255,150,0.45)' : 'rgba(255,80,80,0.4)';
        ctx.fill();
    }

    // ── X-Axis Labels ──
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px JetBrains Mono, SF Mono, monospace';
    ctx.textAlign = 'center';
    for (const f of [0.5, 1, 2, 4, 8, 16, 32]) {
        const x = toX(Math.log10(f));
        if (x >= pad.left && x <= pad.left + plotW) {
            ctx.fillText(String(f), x, pad.top + plotH + 14);
        }
    }
    // Technical label
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText('Spatial Frequency (cpd)', W / 2, pad.top + plotH + 28);
    // Layman label
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '8px -apple-system, sans-serif';
    ctx.fillText('Level of Detail', W / 2, pad.top + plotH + 40);
    // Range labels
    ctx.font = '7px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.textAlign = 'left';
    ctx.fillText('← Coarse', pad.left, pad.top + plotH + 52);
    ctx.textAlign = 'right';
    ctx.fillText('Fine →', pad.left + plotW, pad.top + plotH + 52);

    // ── Y-Axis Labels ──
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    for (const s of [1, 3, 10, 30, 100, 300]) {
        const y = toY(Math.log10(s));
        if (y >= pad.top && y <= pad.top + plotH) {
            ctx.fillText(String(s), pad.left - 8, y + 3);
        }
    }
    // Technical label (rotated)
    ctx.save();
    ctx.translate(13, H / 2 - 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Sensitivity', 0, 0);
    ctx.restore();
    // Layman label (rotated)
    ctx.save();
    ctx.translate(24, H / 2 - 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Contrast Needed', 0, 0);
    ctx.restore();
    // Range labels (rotated)
    ctx.save();
    ctx.translate(6, pad.top + plotH);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.font = '6.5px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Black/White', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(6, pad.top);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.font = '6.5px JetBrains Mono, monospace';
    ctx.fillText('Gray/Gray', 0, 0);
    ctx.restore();

    // Plot border
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    return canvas.toDataURL('image/png', 0.9);
}
