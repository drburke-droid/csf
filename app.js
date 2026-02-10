/**
 * BurkeCSF — Display Controller
 * ==============================
 * Gabor Yes/No detection paradigm.
 * Stimulus always present; user responds "I see it" or "No patch".
 */

import { isCalibrated, getCalibrationData, isCalibrationStale } from './utils.js';
import { QCSFEngine }    from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawCSFPlot }   from './csf-plot.js';
import { initSync }      from './peer-sync.js';
import { initKeyboard }  from './keyboard.js';
import { computeResult } from './results.js';

const MAX_TRIALS  = 50;
const DEBOUNCE_MS = 250;

// Default: Gabor Yes/No
let currentModeId = 'gabor';

// ── Calibration ──────────────────────────────────────────────────────────

if (!isCalibrated()) {
    document.getElementById('cal-guard').style.display = 'flex';
    throw new Error('[App] Calibration required.');
}

const cal = getCalibrationData();

if (isCalibrationStale()) {
    const w = document.getElementById('stale-cal-warning');
    if (w) w.style.display = 'block';
}

if (cal.isMirror) {
    const mt = document.getElementById('mirror-target');
    const rc = document.getElementById('result-content');
    if (mt) mt.classList.add('mirror-flip');
    if (rc) rc.classList.add('mirror-flip');
}

// ── State ────────────────────────────────────────────────────────────────

let mode = null, engine = null, currentStim = null;
let testComplete = false, testStarted = false, lastInputTime = 0;
let sync = null;

// ── Mode Init ────────────────────────────────────────────────────────────

function initMode(modeId) {
    currentModeId = modeId;
    mode = createMode(modeId);

    const label = document.getElementById('mode-label');
    if (label) label.textContent = mode.name;

    try { mode.generate(); } catch (e) { console.error('[App] Generate failed:', e); }

    engine = new QCSFEngine({
        numAFC: mode.numAFC,
        psychometricSlope: mode.psychometricSlope
    });

    testComplete = false;
    testStarted  = false;
    currentStim  = null;
    updateProgress(0);

    if (sync && sync.connected) {
        sync.sendState({
            mode: mode.id, labels: mode.labels, keys: mode.keys,
            responseType: mode.responseType,
            trial: 0, maxTrials: MAX_TRIALS
        });
    }
    showWaiting();
}

function showWaiting() {
    const canvas = document.getElementById('stimCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const mp = cal.midPoint;
    ctx.fillStyle = `rgb(${mp},${mp},${mp})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${mp + 30},${mp + 30},${mp + 30},0.5)`;
    ctx.fill();
}

// ── Input Handling ───────────────────────────────────────────────────────

function handleInput(value) {
    if (testComplete) return;

    // First input starts the test
    if (!testStarted) {
        testStarted = true;
        nextTrial();
        return;
    }

    if (!currentStim || !mode) return;

    // Only accept valid responses
    const validKeys = new Set(mode.keys);
    if (!validKeys.has(value)) return;

    const now = performance.now();
    if (now - lastInputTime < DEBOUNCE_MS) return;
    lastInputTime = now;

    const detected = mode.checkAnswer(value);

    try { engine.update(currentStim.stimIndex, detected); }
    catch (e) { console.error('[App] Update failed:', e); finish(); return; }

    updateProgress(engine.trialCount);
    if (sync && sync.connected) sync.sendProgress(engine.trialCount, MAX_TRIALS);

    if (engine.trialCount >= MAX_TRIALS) { finish(); return; }
    nextTrial();
}

window.handleInput = handleInput;

// ── Keyboard fallback ────────────────────────────────────────────────────

const teardownKeyboard = initKeyboard(key => {
    if (!testComplete) {
        // Orientation keys
        if (key === 'up' || key === 'right' || key === 'upright' || key === 'upleft') handleInput(key);
        // N = no target
        else if (key === 'n') handleInput('none');
        // Space/Y = start test
        else if (key === 'space' || key === 'y') handleInput('_start');
        else handleInput(key.toLowerCase());
    }
});

// ── PeerJS ───────────────────────────────────────────────────────────────

const laneID = 'CSF-' + Math.floor(1000 + Math.random() * 9000);

function initPeerSync() {
    if (typeof Peer === 'undefined') {
        const so = document.getElementById('sync-overlay');
        if (so) so.innerHTML = '<p style="font-size:0.8rem;color:rgba(255,255,255,0.3)">Tablet sync unavailable</p><button class="sync-dismiss-btn" onclick="document.getElementById(\'sync-overlay\').style.display=\'none\'">Use Keyboard</button>';
        return;
    }
    try {
        sync = initSync(laneID, {
            onReady(tabletURL) {
                console.log('[App] Ready:', tabletURL);
                const dbg = document.getElementById('sync-debug');
                if (dbg) dbg.textContent = `Lane: ${laneID}`;
                if (typeof QRCode !== 'undefined') {
                    new QRCode(document.getElementById('qrcode'), { text: tabletURL, width: 180, height: 180, colorDark: '#000', colorLight: '#fff' });
                } else {
                    const el = document.getElementById('qrcode');
                    if (el) el.innerHTML = `<p style="font-size:0.5rem;opacity:.5;word-break:break-all">${tabletURL}</p>`;
                }
            },
            onConnect() {
                console.log('[App] Tablet connected');
                const so = document.getElementById('sync-overlay');
                if (so) so.style.display = 'none';
                if (mode) {
                    sync.sendState({
                        mode: mode.id, labels: mode.labels, keys: mode.keys,
                        responseType: mode.responseType,
                        trial: engine ? engine.trialCount : 0, maxTrials: MAX_TRIALS
                    });
                }
            },
            onInput(value) { handleInput(value); },
            onModeChange(newMode) { initMode(newMode); },
            onCommand(action) {
                if (action === 'restart') location.reload();
                if (action === 'calibrate') window.location.href = 'calibration.html';
            },
            onDisconnect() { console.info('[App] Disconnected'); }
        });
    } catch (e) { console.warn('[App] PeerJS init failed:', e); }
}

initPeerSync();

// ── Trial Loop ───────────────────────────────────────────────────────────

function nextTrial() {
    try { currentStim = engine.selectStimulus(); }
    catch (e) { console.error('[App] Select failed:', e); finish(); return; }

    if (currentStim.contrast <= 0 || currentStim.contrast > 1 || isNaN(currentStim.contrast))
        currentStim.contrast = Math.max(0.001, Math.min(1.0, currentStim.contrast || 0.5));
    if (currentStim.frequency <= 0 || isNaN(currentStim.frequency))
        currentStim.frequency = 4;

    const canvas = document.getElementById('stimCanvas');
    if (!canvas) return;
    try { mode.render(canvas, currentStim, cal); }
    catch (e) { console.error('[App] Render failed:', e); }
}

// ── Progress ─────────────────────────────────────────────────────────────

function updateProgress(trial) {
    const el = document.getElementById('live-progress');
    if (el) el.textContent = `${trial} / ${MAX_TRIALS}`;
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${(trial / MAX_TRIALS) * 100}%`;
}

// ── Finish ───────────────────────────────────────────────────────────────

function finish() {
    testComplete = true;

    let result;
    try { result = computeResult(engine); }
    catch (e) { result = { aulcsf: 0, rank: 'ERROR', detail: 'Failed', params: engine.getExpectedEstimate(), curve: [] }; }
    if (result.aulcsf <= 0) result.rank = 'INCONCLUSIVE';

    document.getElementById('results-overlay').style.display = 'flex';
    const setEl = (id, t) => { const e = document.getElementById(id); if (e) e.innerText = t; };
    setEl('final-auc', result.aulcsf.toFixed(2));
    setEl('final-rank', result.rank);
    setEl('final-detail', result.detail);

    let plotDataUrl = '';
    try {
        const plotCanvas = document.getElementById('csf-plot');
        if (plotCanvas) plotDataUrl = drawCSFPlot(plotCanvas, engine, result.params);
    } catch (e) { console.error('[App] Plot failed:', e); }

    // Send results + plot to tablet
    if (sync && sync.connected) {
        sync.sendResults(result.aulcsf.toFixed(2), result.rank, result.detail);
        // Send curve data so tablet can render its own chart
        try {
            sync.sendState({
                type: 'results-extended',
                score: result.aulcsf.toFixed(2),
                rank: result.rank,
                detail: result.detail,
                plotDataUrl: plotDataUrl,
                curve: result.curve || [],
                history: engine.history.map(h => ({
                    stimIndex: h.stimIndex,
                    correct: h.correct,
                    freq: engine.stimGrid[h.stimIndex].freq,
                    logContrast: engine.stimGrid[h.stimIndex].logContrast
                }))
            });
        } catch (e) { /* curve too large, skip */ }
    }

    if (teardownKeyboard) teardownKeyboard();
}

// ── Start ────────────────────────────────────────────────────────────────

initMode(currentModeId);
