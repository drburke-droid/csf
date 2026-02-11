/**
 * BurkeCSF — Stimulus Modes
 * =========================
 * Default: Gabor Yes/No detection (always present, user says "I see it" or not)
 * Hidden:  tumblingE, sloan (4-AFC and 10-AFC modes preserved for future use)
 */

import { drawGabor }                               from './gabor.js';
import { generateFilteredEs, E_ORIENTATIONS }      from './tumbling-e.js';
import { generateFilteredTemplates, SLOAN_LETTERS } from './sloan-filter.js';
import { drawFilteredLetter }                      from './letter-renderer.js';

const CENTER_FREQ = 4;
const BANDWIDTH   = 1;
const ORIENTATIONS_4 = [0, 45, 90, 135];

export function createMode(mode) {
    switch (mode) {
        case 'gabor':      return createGaborYesNoMode();
        case 'gabor4afc':  return createGabor4AFCMode();
        case 'tumblingE':  return createTumblingEMode();
        case 'sloan':      return createSloanMode();
        default: return createGaborYesNoMode();
    }
}

// ─── Gabor 4-AFC (DEFAULT) ───────────────────────────────────────────────
// Stimulus is ALWAYS present with one of 4 orientations.
// This keeps the response model aligned with the Bayesian engine (numAFC = 4).

function createGaborYesNoMode() {
    let currentAngle = 0;

    return {
        id: 'gabor',
        name: 'Gabor 4-AFC',
        numAFC: 4,
        psychometricSlope: 3.5,
        labels: ['↑', '↗', '→', '↖'],
        keys:   ['up', 'upright', 'right', 'upleft'],
        responseType: 'orientation',

        generate() { /* No templates */ },

        render(canvas, stim, cal) {
            currentAngle = ORIENTATIONS_4[Math.floor(Math.random() * 4)];
            drawGabor(canvas, {
                cpd: stim.frequency,
                contrast: stim.contrast,
                angle: currentAngle
            }, cal);
            return currentAngle;
        },

        checkAnswer(response) {
            const map = { up: 0, right: 90, upright: 45, upleft: 135 };
            return map[response] === currentAngle;
        }
    };
}

// ─── Gabor 4-AFC (hidden) ────────────────────────────────────────────────

function createGabor4AFCMode() {
    const ANGLE_MAP = { 0:'up', 90:'right', 45:'upright', 135:'upleft' };
    let currentAngle = 0;
    return {
        id: 'gabor4afc', name: 'Gabor 4-AFC', numAFC: 4, psychometricSlope: 3.5,
        labels: ['↑','→','↗','↖'], keys: ['up','right','upright','upleft'],
        responseType: 'orientation',
        generate() {},
        render(canvas, stim, cal) {
            currentAngle = ORIENTATIONS_4[Math.floor(Math.random() * 4)];
            drawGabor(canvas, { cpd: stim.frequency, contrast: stim.contrast, angle: currentAngle }, cal);
            return currentAngle;
        },
        checkAnswer(response) { return ({up:0,right:90,upright:45,upleft:135})[response] === currentAngle; }
    };
}

// ─── Tumbling E (hidden) ─────────────────────────────────────────────────

function createTumblingEMode() {
    let data = null, currentIdx = 0;
    return {
        id: 'tumblingE', name: 'Tumbling E', numAFC: 4, psychometricSlope: 3.5,
        labels: ['→','↓','←','↑'], keys: ['right','down','left','up'],
        responseType: 'direction',
        generate() { data = generateFilteredEs({ centerFreq: CENTER_FREQ, bandwidth: BANDWIDTH }); },
        render(canvas, stim, cal) {
            currentIdx = Math.floor(Math.random() * 4);
            drawFilteredLetter(canvas, { template: data.templates[currentIdx], templateRes: data.resolution, centerFreq: data.centerFreq, cpd: stim.frequency, contrast: stim.contrast }, cal);
            return E_ORIENTATIONS[currentIdx];
        },
        checkAnswer(response) { return response === E_ORIENTATIONS[currentIdx]; }
    };
}

// ─── Sloan Letters (hidden) ──────────────────────────────────────────────

function createSloanMode() {
    let data = null, currentIdx = 0;
    return {
        id: 'sloan', name: 'Sloan Letters', numAFC: 10, psychometricSlope: 4.05,
        labels: [...SLOAN_LETTERS], keys: SLOAN_LETTERS.map(l => l.toLowerCase()),
        responseType: 'letter',
        generate() { data = generateFilteredTemplates({ centerFreq: CENTER_FREQ, bandwidth: BANDWIDTH }); },
        render(canvas, stim, cal) {
            currentIdx = Math.floor(Math.random() * 10);
            drawFilteredLetter(canvas, { template: data.templates[currentIdx], templateRes: data.resolution, centerFreq: data.centerFreq, cpd: stim.frequency, contrast: stim.contrast }, cal);
            return SLOAN_LETTERS[currentIdx];
        },
        checkAnswer(response) { return response.toUpperCase() === SLOAN_LETTERS[currentIdx]; }
    };
}

export const MODE_IDS = ['gabor'];  // Only Gabor exposed for now
