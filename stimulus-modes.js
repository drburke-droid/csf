/**
  * Burke Vision Lab — Stimulus Modes
 * =========================
 * Default: Gabor orientation with optional "No Target" response.
 * Hidden:  tumblingE, sloan (4-AFC and 10-AFC modes preserved for future use)
 */

import { drawGabor }                               from './gabor.js';
import { generateFilteredEs, E_ORIENTATIONS }      from './tumbling-e.js';
import { generateFilteredTemplates, SLOAN_LETTERS } from './sloan-filter.js';
import { drawFilteredLetter }                      from './letter-renderer.js';

const CENTER_FREQ = 4;
const BANDWIDTH   = 1;
const ORIENTATIONS_6 = [0, 30, 60, 90, 120, 150];

export function createMode(mode) {
    switch (mode) {
        case 'gabor':      return createGaborYesNoMode();
        case 'gabor4afc':  return createGabor4AFCMode();
        case 'tumblingE':  return createTumblingEMode();
        case 'sloan':      return createSloanMode();
        default: return createGaborYesNoMode();
    }
}

// // ─── Gabor 6-AFC + "No Target" (DEFAULT) ─────────────────────────────────
// Stimulus is ALWAYS present with one of 6 orientations (30° steps, Gabor symmetry).
// "No target" is allowed as a high-value below-threshold response.
// Graded response model: checkAnswer returns angular distance (0-3) or -1 for "none".

function createGaborYesNoMode() {
    let currentAngle = 0;

    return {
        id: 'gabor',
        name: 'Gabor 6-AFC + No Target',
        numAFC: 7,
        psychometricSlope: 3.5,
        labels: ['12', '1', '2', '3', '4', '5', 'Ø'],
        keys:   ['12oclock', '1oclock', '2oclock', '3oclock', '4oclock', '5oclock', 'none'],
        responseType: 'orientation',

        generate() { /* No templates */ },

        render(canvas, stim, cal) {
            currentAngle = ORIENTATIONS_6[Math.floor(Math.random() * 6)];
            drawGabor(canvas, {
                cpd: stim.frequency,
                contrast: stim.contrast,
                angle: currentAngle
            }, cal);
            return currentAngle;
        },

        checkAnswer(response) {
            if (response === 'none') return -1;
            const map = {
                '12oclock': 0, '1oclock': 30, '2oclock': 60,
                '3oclock': 90, '4oclock': 120, '5oclock': 150
            };
            const respAngle = map[response];
            if (respAngle === undefined) return -1;
            const diff = Math.abs(currentAngle - respAngle);
            // Gabor symmetry: 0°=180°, so max distance is 90° (3 steps)
            const angDist = Math.min(diff, 180 - diff);
            return Math.round(angDist / 30); // 0, 1, 2, or 3 steps
        }
    };
}

// ─── Gabor 4-AFC (hidden) ────────────────────────────────────────────────

function createGabor4AFCMode() {
    const LEGACY_ORIENTATIONS = [0, 45, 90, 135];
    const ANGLE_MAP = { 0:'up', 90:'right', 45:'upright', 135:'upleft' };
    let currentAngle = 0;
    return {
        id: 'gabor4afc', name: 'Gabor 4-AFC', numAFC: 4, psychometricSlope: 3.5,
        labels: ['↑','→','↗','↖'], keys: ['up','right','upright','upleft'],
        responseType: 'orientation',
        generate() {},
        render(canvas, stim, cal) {
            currentAngle = LEGACY_ORIENTATIONS[Math.floor(Math.random() * 4)];
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
