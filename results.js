/**
 * BurkeCSF — Results & Scoring
 */

export function computeResult(engine) {
    const params = engine.getExpectedEstimate();
    const aulcsf = engine.computeAULCSF(params);

    let rank;
    if      (aulcsf > 2.0) rank = 'SUPERIOR';
    else if (aulcsf > 1.6) rank = 'ABOVE AVERAGE';
    else if (aulcsf > 1.2) rank = 'NORMAL';
    else if (aulcsf > 0.8) rank = 'BELOW AVERAGE';
    else                    rank = 'IMPAIRED';

    const peakSens = Math.pow(10, params.peakGain).toFixed(0);
    const detail   = `Peak: ${peakSens} @ ${params.peakFreq.toFixed(1)} cpd | BW: ${params.bandwidth.toFixed(1)} oct`;

    // Curve data for tablet rendering
    const curve = engine.getCSFCurve(params);

    return { aulcsf, rank, detail, params, curve };
}
