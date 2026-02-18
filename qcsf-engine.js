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

// Graded response model constants (7-AFC: 6 orientations + "no target")
const GRADED_KERNEL = [0.70, 0.10, 0.04, 0.02]; // K(d) for d=0,1,2,3 steps
const GRADED_GUESS_RATE = 0.10;  // g: probability of guessing an orientation when blind
const GRADED_LAPSE = 0.02;       // λ: lapse rate

const DEFAULTS = {
    numAFC:             7,      // 6 orientations + "no target" = 7-AFC
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
    priorMeans: { peakGain: 1.8, logPeakFreq: 0.602, bandwidth: 1.3, truncation: 1.8 },
    priorSDs:   { peakGain: 0.5, logPeakFreq: 0.3, bandwidth: 0.3, truncation: 0.5 },
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

        // Gaussian-weighted prior
        const pm = cfg.priorMeans, ps = cfg.priorSDs;
        this.prior = new Float64Array(this.nParams);
        let priorSum = 0;
        for (let h = 0; h < this.nParams; h++) {
            const p = this.paramGrid[h];
            const zG = (p.g - pm.peakGain) / ps.peakGain;
            const zF = (Math.log10(p.f) - pm.logPeakFreq) / ps.logPeakFreq;
            const zB = (p.b - pm.bandwidth) / ps.bandwidth;
            const zD = (p.d - pm.truncation) / ps.truncation;
            const w = Math.exp(-0.5 * (zG*zG + zF*zF + zB*zB + zD*zD));
            this.prior[h] = w;
            priorSum += w;
        }
        for (let h = 0; h < this.nParams; h++) this.prior[h] /= priorSum;

        this._precompute();
        this.trialCount = 0;
        this.history    = [];
        this.freqTrialCounts = new Map();
    }

    /**
     * Precompute raw detection probability psi(c,f) for each hypothesis × stimulus.
     * The graded response model wraps psi with kernel/lapse/guess in selectStimulus/update.
     */
    _precompute() {
        this.psiMatrix = [];
        for (let h = 0; h < this.nParams; h++) {
            const p   = this.paramGrid[h];
            const row = new Float64Array(this.nStim);
            for (let s = 0; s < this.nStim; s++) {
                const stim    = this.stimGrid[s];
                const logSens = logParabolaCSF(stim.freq, p.g, p.f, p.b, p.d);
                const x   = logSens - (-stim.logContrast);
                const psi = 1 / (1 + Math.exp(-this.slopeParam * x));
                row[s] = Math.max(0.001, Math.min(0.999, psi));
            }
            this.psiMatrix.push(row);
        }
    }

    selectStimulus() {
        const pHat = this.getExpectedEstimate();
        const ee = new Float64Array(this.nStim);
        const bandCounts = this._getBandCounts();

        // Graded model constants (inlined for hot-loop performance)
        const K = GRADED_KERNEL;          // [0.70, 0.10, 0.04, 0.02]
        const lam = GRADED_LAPSE;         // 0.02
        const g = GRADED_GUESS_RATE;      // 0.10
        const g6 = g / 6;                 // guess prob per orientation when blind
        const oneMinusG = 1 - g;          // prob of "none" when blind
        // Multiplicity: d=0→×1, d=1→×2, d=2→×2, d=3→×1 = 6 orientations total
        // 5 outcomes: d=0, d=1, d=2, d=3, none (averaged over random true orientation)
        // Outcome counts: [1, 2, 2, 1] orientations at each distance, plus 1 "none"

        for (let s = 0; s < this.nStim; s++) {
            // Compute marginal outcome probabilities (averaged over hypotheses)
            let mP0 = 0, mP1 = 0, mP2 = 0, mP3 = 0, mPN = 0;
            for (let h = 0; h < this.nParams; h++) {
                const ph = this.prior[h];
                if (ph < 1e-30) continue;
                const psi = this.psiMatrix[h][s];
                const det = psi * (1 - lam);
                // P(orient at dist d) = det*K[d] + (1-psi)*g/6
                // P("none") = psi*lam + (1-psi)*(1-g)
                const blind = 1 - psi;
                mP0 += ph * (det * K[0] + blind * g6);
                mP1 += ph * (det * K[1] + blind * g6);
                mP2 += ph * (det * K[2] + blind * g6);
                mP3 += ph * (det * K[3] + blind * g6);
                mPN += ph * (psi * lam + blind * oneMinusG);
            }

            // 5-outcome expected posterior entropy
            // For each outcome o, H_o = -Σ_h p(h|o) log2 p(h|o)
            // E[H] = Σ_o mult[o] * P(o) * H_o
            // mult: d0=1, d1=2, d2=2, d3=1, none=1
            let baseEntropy = 0;
            const marginals = [mP0, mP1, mP2, mP3, mPN];
            const mults = [1, 2, 2, 1, 1];

            for (let o = 0; o < 5; o++) {
                const marg = marginals[o] * mults[o];
                if (marg < 1e-30) continue;
                let hO = 0;
                for (let h = 0; h < this.nParams; h++) {
                    const ph = this.prior[h];
                    if (ph < 1e-30) continue;
                    const psi = this.psiMatrix[h][s];
                    const det = psi * (1 - lam);
                    const blind = 1 - psi;
                    let pOH;
                    if (o < 4) pOH = det * K[o] + blind * g6;
                    else       pOH = psi * lam + blind * oneMinusG;
                    const posterior = (ph * pOH) / (marginals[o]);
                    if (posterior > 1e-30) hO -= posterior * Math.log2(posterior);
                }
                baseEntropy += marg * hO;
            }

            const stim = this.stimGrid[s];

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

            // Lower ee = more preferred
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
     * @param {number} stimIndex
     * @param {number} angularDistance – 0-3 (orientation steps from true) or -1 for "none"
     */
    update(stimIndex, angularDistance) {
        const K = GRADED_KERNEL;
        const lam = GRADED_LAPSE;
        const g = GRADED_GUESS_RATE;
        const g6 = g / 6;
        const oneMinusG = 1 - g;
        const mix = this.robustLikelihoodMix;
        const uniformP = 1 / 7;  // robust mixing: uniform over 7 outcomes

        let total = 0;
        for (let h = 0; h < this.nParams; h++) {
            const psi = this.psiMatrix[h][stimIndex];
            const det = psi * (1 - lam);
            const blind = 1 - psi;
            let pObsRaw;
            if (angularDistance >= 0 && angularDistance <= 3) {
                pObsRaw = det * K[angularDistance] + blind * g6;
            } else {
                // "none" response
                pObsRaw = psi * lam + blind * oneMinusG;
            }
            const pObs = (1 - mix) * pObsRaw + mix * uniformP;
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
        this.history.push({ trial: this.trialCount, stimIndex, angularDistance });
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
