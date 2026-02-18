/**
 * Burke Vision Lab — Results & Scoring
 */

export function computeResult(engine) {
    // Use MAP/posterior-best parameters directly for display so the drawn curve
    // tracks tested points instead of an over-smoothed population average.
    const params = engine.getEstimate();
    const aulcsf = engine.computeAULCSF(params);

    // Thresholds calibrated for 0.5–36 cpd integration range
    let rank;
    if      (aulcsf > 3.5) rank = 'SUPERIOR';
    else if (aulcsf > 2.8) rank = 'ABOVE AVERAGE';
    else if (aulcsf > 2.0) rank = 'NORMAL';
    else if (aulcsf > 1.3) rank = 'BELOW AVERAGE';
    else                    rank = 'IMPAIRED';

    const peakSens = Math.pow(10, params.peakGain).toFixed(0);
    const peakFreq = params.peakFreq.toFixed(1);

    // Patient-friendly detail line
    const sensDesc = peakSens >= 200 ? 'Excellent' : peakSens >= 80 ? 'Good' : peakSens >= 30 ? 'Fair' : 'Reduced';
    const detail = `Peak sensitivity: ${peakSens} (${sensDesc}) at ${peakFreq} cpd — `
        + `your eyes are most sensitive to patterns around this level of detail`;

    // Curve data for tablet rendering
    const curve = engine.getCSFCurve(params);

    return { aulcsf, rank, detail, params, curve };
}
