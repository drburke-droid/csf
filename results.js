/**
 * Burke Vision Lab — Results & Scoring
 */

export function computeResult(engine) {
    // Use MAP/posterior-best parameters directly for display so the drawn curve
    // tracks tested points instead of an over-smoothed population average.
    const params = engine.getEstimate();
    const aulcsf = engine.computeAULCSF(params);

    let rank;
    if      (aulcsf > 2.0) rank = 'SUPERIOR';
    else if (aulcsf > 1.6) rank = 'ABOVE AVERAGE';
    else if (aulcsf > 1.2) rank = 'NORMAL';
    else if (aulcsf > 0.8) rank = 'BELOW AVERAGE';
    else                    rank = 'IMPAIRED';

    const peakSens = Math.pow(10, params.peakGain).toFixed(0);
    const detail   = `Low-freq Sens: ${peakSens} | Knee: ${params.peakFreq.toFixed(1)} cpd | Curvature: ${params.truncation.toFixed(1)}`;

    // Curve data for tablet rendering
    const curve = engine.getCSFCurve(params);

    return { aulcsf, rank, detail, params, curve };
}
