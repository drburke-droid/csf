/**
 * BurkeCSF — Enhanced CSF Plot (High Legibility)
 * Larger fonts, higher contrast colors, bigger canvas.
 */

const LANDMARKS = [
    { name: 'Highway sign',     freq: 2,   sens: 5,   icon: '' },
    { name: 'Face recognition', freq: 4,   sens: 15,  icon: '' },
    { name: 'Golf ball',        freq: 12,  sens: 50,  icon: '' },
    { name: 'Night driving',    freq: 1.5, sens: 3,   icon: '' },
    { name: 'Fine print',       freq: 20,  sens: 100, icon: '' },
];

export function drawCSFPlot(canvas, engine, params) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = 640, cssH = 420;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const W = cssW, H = cssH;
    const pad = { top: 28, right: 32, bottom: 68, left: 80 };
    const pW = W - pad.left - pad.right, pH = H - pad.top - pad.bottom;
    const lfMin = -0.3, lfMax = 1.7, lsMin = -0.3, lsMax = 2.5;
    const tX = lf => pad.left + (lf - lfMin) / (lfMax - lfMin) * pW;
    const tY = ls => pad.top + pH - (ls - lsMin) / (lsMax - lsMin) * pH;

    // Background
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (const f of [0.5, 1, 2, 4, 8, 16, 32]) {
        const x = tX(Math.log10(f));
        if (x >= pad.left && x <= pad.left + pW) { ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + pH); ctx.stroke(); }
    }
    for (const s of [1, 3, 10, 30, 100, 300]) {
        const y = tY(Math.log10(s));
        if (y >= pad.top && y <= pad.top + pH) { ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pW, y); ctx.stroke(); }
    }

    // Landmarks
    for (const lm of LANDMARKS) {
        const lx = tX(Math.log10(lm.freq)), ly = tY(Math.log10(lm.sens));
        if (lx < pad.left || lx > pad.left + pW || ly < pad.top || ly > pad.top + pH) continue;
        ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(lx, ly - 5); ctx.lineTo(lx + 5, ly); ctx.lineTo(lx, ly + 5); ctx.lineTo(lx - 5, ly); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.3; ctx.font = '11px -apple-system, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(lm.name, lx + 9, ly + 4); ctx.restore();
    }

    // CSF Curve — fill
    const curve = engine.getCSFCurve(params);
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + pH);
    grad.addColorStop(0, 'rgba(0,255,204,0.10)'); grad.addColorStop(1, 'rgba(0,255,204,0.0)');
    ctx.beginPath(); let st = false, fX, lX, lY2;
    for (const pt of curve) {
        if (pt.logS < lsMin) continue;
        const x = tX(Math.log10(pt.freq)), y = tY(Math.min(pt.logS, lsMax));
        if (!st) { ctx.moveTo(x, y); fX = x; st = true; } else ctx.lineTo(x, y);
        lX = x; lY2 = y;
    }
    ctx.lineTo(lX, pad.top + pH); ctx.lineTo(fX, pad.top + pH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // CSF Curve — stroke
    ctx.beginPath(); st = false;
    for (const pt of curve) {
        if (pt.logS < lsMin) continue;
        const x = tX(Math.log10(pt.freq)), y = tY(Math.min(pt.logS, lsMax));
        if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0,255,204,0.35)'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;

    // Trial markers
    for (const trial of engine.history) {
        const s = engine.stimGrid[trial.stimIndex];
        const x = tX(Math.log10(s.freq)), y = tY(-s.logContrast);
        if (y < pad.top || y > pad.top + pH) continue;
        ctx.beginPath(); ctx.arc(x, y, trial.correct ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = trial.correct ? 'rgba(0,255,150,0.55)' : 'rgba(255,80,80,0.5)'; ctx.fill();
    }

    // X axis
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = 'bold 12px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    for (const f of [0.5, 1, 2, 4, 8, 16, 32]) {
        const x = tX(Math.log10(f));
        if (x >= pad.left && x <= pad.left + pW) ctx.fillText(String(f), x, pad.top + pH + 18);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '12px JetBrains Mono, monospace';
    ctx.fillText('Spatial Frequency (cpd)', W / 2, pad.top + pH + 36);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '10px -apple-system, sans-serif';
    ctx.fillText('Level of Detail', W / 2, pad.top + pH + 50);
    ctx.font = '9px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'left'; ctx.fillText('Coarse', pad.left, pad.top + pH + 62);
    ctx.textAlign = 'right'; ctx.fillText('Fine', pad.left + pW, pad.top + pH + 62);

    // Y axis
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = 'bold 12px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    for (const s of [1, 3, 10, 30, 100, 300]) {
        const y = tY(Math.log10(s));
        if (y >= pad.top && y <= pad.top + pH) ctx.fillText(String(s), pad.left - 10, y + 4);
    }
    ctx.save(); ctx.translate(16, H / 2 - 10); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '12px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText('Sensitivity', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(30, H / 2 - 10); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Contrast Needed', 0, 0); ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, pW, pH);

    return canvas.toDataURL('image/png', 0.92);
}
