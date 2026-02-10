/**
 * BurkeCSF — Bayesian Adaptive Engine
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

const KAPPA = Math.log10(2);

/**
 * Truncated log-parabola CSF model.
 */
export function logParabolaCSF(freq, g, f, b, d) {
    const betaPrime = Math.log10(Math.pow(2, b));
    const logF    = Math.log10(freq);
    const logFmax = Math.log10(f);
    let logSens = g - KAPPA * Math.pow((logF - logFmax) / (betaPrime / 2), 2);
    if (freq <= f) {
        const truncLevel = g - d;
        if (logSens < truncLevel) logSens = truncLevel;
    }
    return logSens;
}

const DEFAULTS = {
    numAFC:             4,      // 4 orientations (with additional "no target" option)
    lapse:              0.04,
    falseAlarmRate:     0.01,   // unused in AFC mode
    psychometricSlope:  3.5,
    peakGainValues:     linspace(0.5, 2.8, 10),
    peakFreqValues:     [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16],
    bandwidthValues:    linspace(1.0, 6.0, 6),
    truncationValues:   [0, 0.5, 1.0, 1.5, 2.0],
    stimFreqs:          [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24],
    stimLogContrasts:   linspace(-3.0, 0.0, 30),
};

export class QCSFEngine {
    constructor(options = {}) {
        const cfg = { ...DEFAULTS, ...options };

        this.numAFC     = cfg.numAFC;
        this.isYesNo    = (cfg.numAFC <= 1);
        this.gamma      = this.isYesNo ? cfg.falseAlarmRate : (1 / this.numAFC);
        this.lapse      = cfg.lapse;
        this.slopeParam = cfg.psychometricSlope;

        // Parameter grid
        this.paramGrid = [];
        for (const g of cfg.peakGainValues)
            for (const f of cfg.peakFreqValues)
                for (const b of cfg.bandwidthValues)
                    for (const d of cfg.truncationValues)
                        this.paramGrid.push({ g, f, b, d });
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
        const ee = new Float64Array(this.nStim);
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
            ee[s] = pCorr * hC + pInc * hI;
        }

        const sorted = Array.from(ee).map((e, i) => ({ e, i })).sort((a, b) => a.e - b.e);
        const topN   = Math.max(1, Math.ceil(this.nStim * 0.1));
        const chosen = sorted[Math.floor(Math.random() * topN)];
        const stim   = this.stimGrid[chosen.i];
        return {
            frequency:   stim.freq,
            contrast:    Math.pow(10, stim.logContrast),
            logContrast: stim.logContrast,
            stimIndex:   chosen.i,
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
            this.prior[h] *= detected ? pCH : (1 - pCH);
            total += this.prior[h];
        }
        if (total > 0) {
            for (let h = 0; h < this.nParams; h++) this.prior[h] /= total;
        }
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
        for (let i = 0; i < 100; i++) {
            const f = Math.pow(10, -0.3 + i * 2.0 / 99);
            curve.push({ freq: f, logS: this.evaluateCSF(f, p) });
        }
        return curve;
    }
}
