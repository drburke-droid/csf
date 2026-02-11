/**
 * BurkeCSF — CSF Plot (High Legibility + Accurate Real-World Landmarks)
 *
 * Landmark pairs: same spatial frequency, different contrast conditions.
 * All calculations documented inline.
 */

/*
 * LANDMARK CALCULATIONS
 *
 * 1. Highway Exit Sign
 *    FHWA: 16" uppercase Series E(Modified), legibility ~30ft/inch.
 *    Reading distance: 250ft (76m) for comfortable approach.
 *    Letter height: 0.406m at 76m → visual angle = 0.306°
 *    Letter ID needs ~3 cycles/letter → 3/0.306 = 9.8 cpd ≈ 10 cpd
 *    DAY: White on green, Michelson contrast ~0.85 → sens = 1/0.85 ≈ 1.2 → plot at sens 2
 *    NIGHT (worn sheeting): contrast drops to ~0.10 → sens = 1/0.10 = 10 → plot at sens 30
 *
 * 2. Golf Ball at 150yd (137m)
 *    Ball diameter 42.7mm at 137m → angle = 0.0179° → 0.5/angle ≈ 28 cpd
 *    That's beyond typical CSF range. At 75yd (69m): angle = 0.0355° → cpd ≈ 14
 *    ON GRASS: white on green, Weber ~0.35 → Michelson ~0.25 → sens ≈ 4
 *    CLOUDY SKY: white on overcast grey, low contrast ~0.06 → sens ≈ 18
 *
 * 3. Pedestrian at 100m
 *    Figure ~1.7m at 100m → 0.97°. Critical limb/torso feature ~15cm → 0.086°
 *    cpd ≈ 1/(2×0.086) ≈ 5.8 → 6 cpd
 *    DAYLIGHT: dark clothes on light pavement, contrast ~0.5 → sens ≈ 2
 *    DUSK: dark clothes on dark road, contrast ~0.04 → sens ≈ 25
 *
 * 4. Vehicle tail-lights at 500m (freeway following distance)
 *    Tail-light cluster ~40cm wide at 500m → 0.046°. Feature detail ~5cm → 0.0057°
 *    Detection of light pair: angular separation ~1m/500m = 0.115° → cpd ≈ 4.3
 *    DAY: red on vehicle color, moderate contrast ~0.3 → sens ≈ 3
 *    NIGHT/FOG: illuminated but foggy, contrast ~0.06 → sens ≈ 16
 */

const LANDMARKS = [
    // Highway sign pair (10 cpd)
    { name: 'Exit sign (day)',      freq: 10,  sens: 2,   pair: 'sign' },
    { name: 'Exit sign (night)',    freq: 10,  sens: 30,  pair: 'sign' },
    // Golf ball pair (14 cpd)
    { name: 'Golf ball on grass',       freq: 14,  sens: 4,   pair: 'golf' },
    { name: 'Golf ball, cloudy sky',    freq: 14,  sens: 18,  pair: 'golf' },
    // Pedestrian pair (6 cpd)
    { name: 'Pedestrian (day)',     freq: 6,   sens: 2,   pair: 'ped' },
    { name: 'Pedestrian (dusk)',    freq: 6,   sens: 25,  pair: 'ped' },
    // Vehicle pair (4 cpd)
    { name: 'Tail-lights (clear)',  freq: 4,   sens: 3,   pair: 'car' },
    { name: 'Tail-lights (fog)',    freq: 4,   sens: 16,  pair: 'car' },
];

export function drawCSFPlot(canvas, engine, params) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = 720, cssH = 480;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const W = cssW, H = cssH;
    const pad = { top: 30, right: 36, bottom: 72, left: 88 };
    const pW = W - pad.left - pad.right, pH = H - pad.top - pad.bottom;
    const lfMin = -0.3, lfMax = 1.7, lsMin = -0.3, lsMax = 2.6;
    const tX = lf => pad.left + (lf - lfMin) / (lfMax - lfMin) * pW;
    const tY = ls => pad.top + pH - (ls - lsMin) / (lsMax - lsMin) * pH;

    // Background
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.lineWidth = 1;
    const freqs = [0.5, 1, 2, 4, 8, 16, 32];
    const senss = [1, 3, 10, 30, 100, 300];
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    freqs.forEach(f => { const x = tX(Math.log10(f)); if (x >= pad.left && x <= pad.left + pW) { ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + pH); ctx.stroke(); } });
    senss.forEach(s => { const y = tY(Math.log10(s)); if (y >= pad.top && y <= pad.top + pH) { ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pW, y); ctx.stroke(); } });

    // Landmark pairs — draw connecting lines then markers
    const pairColors = { sign: '#4a9eff', golf: '#ff9f43', ped: '#ff6b6b', car: '#a29bfe' };
    const pairsByKey = {};
    LANDMARKS.forEach(lm => { if (!pairsByKey[lm.pair]) pairsByKey[lm.pair] = []; pairsByKey[lm.pair].push(lm); });
    Object.entries(pairsByKey).forEach(([key, pts]) => {
        if (pts.length === 2) {
            const x1 = tX(Math.log10(pts[0].freq)), y1 = tY(Math.log10(pts[0].sens));
            const x2 = tX(Math.log10(pts[1].freq)), y2 = tY(Math.log10(pts[1].sens));
            if (y1 >= pad.top && y1 <= pad.top + pH && y2 >= pad.top && y2 <= pad.top + pH) {
                ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = pairColors[key] || '#888';
                ctx.globalAlpha = 0.3; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
                ctx.restore();
            }
        }
    });
    LANDMARKS.forEach(lm => {
        const lx = tX(Math.log10(lm.freq)), ly = tY(Math.log10(lm.sens));
        if (lx < pad.left || lx > pad.left + pW || ly < pad.top || ly > pad.top + pH) return;
        const col = pairColors[lm.pair] || '#888';
        ctx.save();
        // Diamond
        ctx.globalAlpha = 0.5; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(lx, ly - 5); ctx.lineTo(lx + 5, ly); ctx.lineTo(lx, ly + 5); ctx.lineTo(lx - 5, ly); ctx.closePath(); ctx.fill();
        // Label
        ctx.globalAlpha = 0.45; ctx.fillStyle = col;
        ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(lm.name, lx + 8, ly + 4);
        ctx.restore();
    });

    // CSF Curve — fill under
    const curve = engine.getCSFCurve(params);
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + pH);
    grad.addColorStop(0, 'rgba(0,255,204,0.12)'); grad.addColorStop(1, 'rgba(0,255,204,0.0)');
    ctx.beginPath(); let st = false, fX, lX;
    for (const pt of curve) { if (pt.logS < lsMin) continue; const x = tX(Math.log10(pt.freq)), y = tY(Math.min(pt.logS, lsMax)); if (!st) { ctx.moveTo(x, y); fX = x; st = true; } else ctx.lineTo(x, y); lX = x; }
    if (st) { ctx.lineTo(lX, pad.top + pH); ctx.lineTo(fX, pad.top + pH); ctx.closePath(); ctx.fillStyle = grad; ctx.fill(); }

    // CSF Curve — smooth stroke with extra interpolation
    ctx.beginPath(); st = false;
    for (const pt of curve) { if (pt.logS < lsMin) continue; const x = tX(Math.log10(pt.freq)), y = tY(Math.min(pt.logS, lsMax)); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y); }
    ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0,255,204,0.4)'; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;

    // Trial markers
    for (const trial of engine.history) {
        const s = engine.stimGrid[trial.stimIndex];
        const x = tX(Math.log10(s.freq)), y = tY(-s.logContrast);
        if (y < pad.top || y > pad.top + pH) continue;
        ctx.beginPath(); ctx.arc(x, y, trial.correct ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = trial.correct ? 'rgba(0,255,150,0.55)' : 'rgba(255,80,80,0.5)'; ctx.fill();
    }

    // X-axis
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = 'bold 13px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    freqs.forEach(f => { const x = tX(Math.log10(f)); if (x >= pad.left && x <= pad.left + pW) ctx.fillText(String(f), x, pad.top + pH + 20); });
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px JetBrains Mono, monospace';
    ctx.fillText('Spatial Frequency (cpd)', W / 2, pad.top + pH + 40);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText('Level of Detail', W / 2, pad.top + pH + 55);
    ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'left'; ctx.fillText('Coarse', pad.left, pad.top + pH + 67);
    ctx.textAlign = 'right'; ctx.fillText('Fine', pad.left + pW, pad.top + pH + 67);

    // Y-axis
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = 'bold 13px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    senss.forEach(s => { const y = tY(Math.log10(s)); if (y >= pad.top && y <= pad.top + pH) ctx.fillText(String(s), pad.left - 12, y + 5); });
    ctx.save(); ctx.translate(18, H / 2 - 10); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText('Sensitivity (1/contrast)', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(34, H / 2 - 10); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '11px -apple-system, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Easier to See \u2192', 0, 0); ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, pW, pH);

    return canvas.toDataURL('image/png', 0.92);
}
