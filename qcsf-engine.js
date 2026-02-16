/**
* Burke Vision Lab — Bayesian Adaptive Engine
 * ====================================
 * Quick Contrast Sensitivity Function using Bayesian adaptive estimation.
 *
 * Supports both forced-choice (nAFC) and Yes/No detection paradigms.
 *
 * Yes/No paradigm (numAFC = 1):
 *   - gamma = 0 (no guessing correction — false alarm rate handled by lapse)
 *   - "I see it" = correct detection
 *   - "I don't see it" = definite non-detection (no stimulus is ever absent)
 *   - This asymmetry gives strong below-threshold evidence on "no" responses
 *
 * References:
 *   Lesmes, Lu, Baek & Albright (2010). J Vis 10(3):17.
 *   Watson & Ahumada (2005). J Vis 5(9):717-740.
 */

import { linspace } from './utils.js';

// Empirical upper bound for high-contrast human acuity (100% contrast cutoff).
// 60 cpd is a commonly cited ceiling for healthy foveal vision under ideal conditions.
export const MAX_HUMAN_CUTOFF_CPD = 60;

/**
   * Smooth band-pass CSF approximation.
 *
 * The curve intentionally rises from low spatial frequencies, reaches a peak,
 * then falls at high frequencies (classic human CSF shape):
 *
*   logS(f) = g - b * (log10(f) - log10(f0))^2 - d * max(0, log10(f)-log10(f0))^4
 *
  * where:
 *   g  = peak log-sensitivity,
 *   f0 = peak frequency,
 *   b  = overall curvature,
 *   d  = extra high-frequency steepening.
 */
export function logParabolaCSF(freq, g, f, b, d) {
    const safeFreq = Math.max(0.05, freq);
    const logF = Math.log10(safeFreq);
    const logPeak = Math.log10(Math.max(0.2, f));
    const delta = logF - logPeak;
    const baseDrop = Math.max(0.2, b) * delta * delta;
    const highFreqDrop = (delta > 0) ? Math.max(0.2, d) * Math.pow(delta, 4) : 0;
    return g - baseDrop - highFreqDrop;
}

// Frequency bands with minimum trial guarantees for clinical coverage
const FREQ_BANDS = [
    { min: 0.5, max: 2,  minTrials: 8  },  // low spatial freq
    { min: 2,   max: 6,  minTrials: 10 },  // mid (clinical core)
    { min: 6,   max: 16, minTrials: 8  },   // high-mid
    { min: 16,  max: 30, minTrials: 5  },   // high
];

const LOG4 = Math.log10(4); // ~4 cpd center for clinical importance

const DEFAULTS = {
    numAFC:             5,      // 4 orientations + optional "no target" response
    lapse:              0.04,
    falseAlarmRate:     0.01,   // unused in AFC mode
    psychometricSlope:  3.5,
    peakGainValues:     linspace(0.5, 2.8, 10),
    peakFreqValues:     [0.8, 1.2, 1.8, 2.5, 3.5, 5, 7, 10, 14, 18],
    bandwidthValues:    [0.8, 1.05, 1.3, 1.6, 1.95],
    truncationValues:   [1.0, 1.4, 1.8, 2.2, 2.6],
    stimFreqs:          [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 8, 12, 16, 24],
    stimLogContrasts:   linspace(-3.0, 0.0, 30),
    robustLikelihoodMix: 0.03,
    boundarySigmaLogC:  0.2,
};

export class QCSFEngine {
    constructor(options = {}) {
        const cfg = { ...DEFAULTS, ...options };

        this.numAFC     = cfg.numAFC;
        this.isYesNo    = (cfg.numAFC <= 1);
        this.gamma      = this.isYesNo ? cfg.falseAlarmRate : (1 / this.numAFC);
        this.lapse      = cfg.lapse;
        this.slopeParam = cfg.psychometricSlope;
        this.robustLikelihoodMix = cfg.robustLikelihoodMix;
        this.boundarySigmaLogC = cfg.boundarySigmaLogC;

        // Parameter grid
        this.paramGrid = [];
        for (const g of cfg.peakGainValues)
            for (const f of cfg.peakFreqValues)
                for (const b of cfg.bandwidthValues)
                   for (const d of cfg.truncationValues) {
                        const highCutoffLogSens = logParabolaCSF(MAX_HUMAN_CUTOFF_CPD, g, f, b, d);
                        if (highCutoffLogSens <= 0) this.paramGrid.push({ g, f, b, d });
                    }
        this.nParams = this.paramGrid.length;

        // Stimulus grid
        this.stimGrid = [];
        for (const freq of cfg.stimFreqs)
            for (const logC of cfg.stimLogContrasts)
                this.stimGrid.push({ freq, logContrast: logC });
        this.nStim = this.stimGrid.length;

        // Uniform prior
        this.prior = new Float64Array(this.nParams).fill(1 / this.nParams);

        this._precompute();
        this.trialCount = 0;
        this.history    = [];
        this.freqTrialCounts = new Map();
    }

    /**
     * For Yes/No: p("yes" | hypothesis, stimulus)
     *   = gamma + (1 - gamma - lapse) * psi(x)
     * where gamma = falseAlarmRate (≈0.01) and psi is logistic.
     *
     * For nAFC: same formula with gamma = 1/n.
     */
    _precompute() {
        this.pCorrectMatrix = [];
        for (let h = 0; h < this.nParams; h++) {
            const p   = this.paramGrid[h];
            const row = new Float64Array(this.nStim);
            for (let s = 0; s < this.nStim; s++) {
                const stim    = this.stimGrid[s];
                const logSens = logParabolaCSF(stim.freq, p.g, p.f, p.b, p.d);
                const x   = logSens - (-stim.logContrast);
                const psi = 1 / (1 + Math.exp(-this.slopeParam * x));
                const pC  = this.gamma + (1 - this.gamma - this.lapse) * psi;
                row[s] = Math.max(0.001, Math.min(0.999, pC));
            }
            this.pCorrectMatrix.push(row);
        }
    }

    selectStimulus() {
        const pHat = this.getExpectedEstimate();
        const ee = new Float64Array(this.nStim);
        const bandCounts = this._getBandCounts();

        for (let s = 0; s < this.nStim; s++) {
            let pCorr = 0;
            for (let h = 0; h < this.nParams; h++) {
                pCorr += this.pCorrectMatrix[h][s] * this.prior[h];
            }
            const pInc = 1 - pCorr;
            let hC = 0, hI = 0;
            for (let h = 0; h < this.nParams; h++) {
                const ph = this.prior[h];
                if (ph < 1e-30) continue;
                const pCH = this.pCorrectMatrix[h][s];
                if (pCorr > 1e-30) {
                    const n = (ph * pCH) / pCorr;
                    if (n > 1e-30) hC -= n * Math.log2(n);
                }
                if (pInc > 1e-30) {
                    const n = (ph * (1 - pCH)) / pInc;
                    if (n > 1e-30) hI -= n * Math.log2(n);
                }
            }

            const stim = this.stimGrid[s];
            const baseEntropy = pCorr * hC + pInc * hI;

            // Boundary weight: prefer stimuli near posterior-predicted threshold
            const predictedBoundaryLogC = -this.evaluateCSF(stim.freq, pHat);
            const boundaryDelta = stim.logContrast - predictedBoundaryLogC;
            const boundaryWeight = Math.exp(-0.5 * Math.pow(boundaryDelta / this.boundarySigmaLogC, 2));

            // Smooth clinical frequency importance (Gaussian centered at ~4 cpd)
            const logF = Math.log10(stim.freq);
            const freqWeight = 1.0 + 1.5 * Math.exp(-0.5 * ((logF - LOG4) / 0.55) ** 2);

            // Frequency diversity penalty: penalize oversampled frequencies
            const freqCount = this.freqTrialCounts.get(stim.freq) || 0;
            const diversityPenalty = 1 + freqCount * 1.5;

            // Band coverage boost: strongly prefer under-tested bands
            const band = this._getBand(stim.freq);
            const coverageBoost = (band && bandCounts.get(band) < band.minTrials) ? 3.0 : 1.0;

            // CORRECTED utility: lower ee = more preferred
            // Divide by desirable weights (lower ee), multiply by penalties (raise ee)
            ee[s] = baseEntropy * diversityPenalty / ((1 + boundaryWeight) * freqWeight * coverageBoost);
        }

        // Deterministic selection: always pick the best (lowest ee) stimulus
        let bestIdx = 0;
        for (let s = 1; s < this.nStim; s++) {
            if (ee[s] < ee[bestIdx]) bestIdx = s;
        }
        const stim = this.stimGrid[bestIdx];
        return {
            frequency:   stim.freq,
            contrast:    Math.pow(10, stim.logContrast),
            logContrast: stim.logContrast,
            stimIndex:   bestIdx,
        };
    }

    /**
     * @param {number}  stimIndex
     * @param {boolean} detected – true = "I see it" or correct AFC, false = "I don't see it" or incorrect
     */
    update(stimIndex, detected) {
        let total = 0;
        for (let h = 0; h < this.nParams; h++) {
            const pCH = this.pCorrectMatrix[h][stimIndex];
            const pObsRaw = detected ? pCH : (1 - pCH);
            const pObs = (1 - this.robustLikelihoodMix) * pObsRaw + this.robustLikelihoodMix * 0.5;
            this.prior[h] *= pObs;
            total += this.prior[h];
        }
        if (total > 0) {
            for (let h = 0; h < this.nParams; h++) this.prior[h] /= total;
        }
        // Track frequency usage for diversity weighting
        const freq = this.stimGrid[stimIndex].freq;
        this.freqTrialCounts.set(freq, (this.freqTrialCounts.get(freq) || 0) + 1);
        this.trialCount++;
        this.history.push({ trial: this.trialCount, stimIndex, correct: detected });
    }

    getEstimate() {
        let best = 0;
        for (let h = 1; h < this.nParams; h++) {
            if (this.prior[h] > this.prior[best]) best = h;
        }
        const p = this.paramGrid[best];
        return { peakGain: p.g, peakFreq: p.f, bandwidth: p.b, truncation: p.d };
    }

    getExpectedEstimate() {
        let gM = 0, fM = 0, bM = 0, dM = 0;
        for (let h = 0; h < this.nParams; h++) {
            const w = this.prior[h], p = this.paramGrid[h];
            gM += w * p.g; fM += w * Math.log10(p.f); bM += w * p.b; dM += w * p.d;
        }
        return { peakGain: gM, peakFreq: Math.pow(10, fM), bandwidth: bM, truncation: dM };
    }

    evaluateCSF(freq, params) {
        const p = params || this.getExpectedEstimate();
        return logParabolaCSF(freq, p.peakGain, p.peakFreq, p.bandwidth, p.truncation);
    }

    computeAULCSF(params) {
        const p = params || this.getExpectedEstimate();
        const N = 500, logMin = Math.log10(0.5), logMax = Math.log10(36);
        const dLogF = (logMax - logMin) / N;
        let area = 0;
        for (let i = 0; i <= N; i++) {
            const f = Math.pow(10, logMin + i * dLogF);
            const logS = this.evaluateCSF(f, p);
            if (logS > 0) area += logS * dLogF * ((i === 0 || i === N) ? 0.5 : 1.0);
        }
        return area;
    }

    getCSFCurve(params) {
        const p = params || this.getExpectedEstimate();
        const curve = [];
        for (let i = 0; i < 200; i++) {
            const f = Math.pow(10, -0.3 + i * 2.0 / 199);
            curve.push({ freq: f, logS: this.evaluateCSF(f, p) });
        }
        return curve;
    }

    _getBand(freq) {
        return FREQ_BANDS.find(b => freq >= b.min && freq < b.max) || null;
    }

    _getBandCounts() {
        const counts = new Map();
        for (const band of FREQ_BANDS) {
            let count = 0;
            for (const [freq, n] of this.freqTrialCounts) {
                if (freq >= band.min && freq < band.max) count += n;
            }
            counts.set(band, count);
        }
        return counts;
    }
}
