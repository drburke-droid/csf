/**
 * BurkeCSF — Unified Display Controller
 * ======================================
 * Single page handles: QR connect → Calibration → Test → Results
 * PeerJS connection persists throughout all phases.
 */
import { QCSFEngine }    from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawCSFPlot }   from './csf-plot.js';
import { computeResult } from './results.js';
import { createHost }    from './peer-sync.js';

const MAX_TRIALS = 50;
const DEBOUNCE_MS = 250;

// ═══ Screen management ═══
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
window.showScreen = showScreen;

// ═══ PeerJS ═══
const laneID = 'CSF-' + Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b=>b.toString(16).padStart(2,'0')).join('');
let host = null;
let phoneConnected = false;

function initPeer() {
    if (typeof Peer === 'undefined') return;
    host = createHost(laneID,
        // onConnect
        () => {
            phoneConnected = true;
            console.log('[App] Phone connected');
            document.getElementById('gamma-local').style.display = 'none';
            document.getElementById('gamma-remote').style.display = 'block';
            showScreen('scr-cal');
            calGo(0);
        },
        // onData
        (d) => handlePhoneMessage(d),
        // onDisconnect
        () => {
            phoneConnected = false;
            console.log('[App] Phone disconnected');
            document.getElementById('gamma-local').style.display = 'block';
            document.getElementById('gamma-remote').style.display = 'none';
        },
        // onReady — called with actual registered ID
        (actualID) => {
            const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
            const url = `${location.origin}${dir}/tablet.html?id=${actualID}`;
            document.getElementById('qr-debug').textContent = `Lane: ${actualID}`;
            const qrEl = document.getElementById('qrcode');
            qrEl.innerHTML = ''; // clear any previous
            if (typeof QRCode !== 'undefined') {
                new QRCode(qrEl, { text: url, width: 180, height: 180, colorDark: '#000', colorLight: '#fff' });
            } else {
                qrEl.innerHTML = `<p style="font-size:.5rem;word-break:break-all;max-width:200px">${url}</p>`;
            }
        }
    );
}

function tx(msg) { if (host && host.connected) host.send(msg); }

function handlePhoneMessage(d) {
    // Calibration messages
    if (d.type === 'gamma') { document.getElementById('gs').value = d.value; updateGamma(); }
    if (d.type === 'cardSize') { document.getElementById('ss').value = d.value; updateCardSize(); }
    if (d.type === 'nav') {
        if (d.to === 'next') {
            if (calStep === 2) calValidate();
            else calGo(calStep + 1);
        }
        else if (d.to === 'back') calGo(Math.max(0, calStep - 1));
        else if (d.to === 'start') startTest();
    }
    // Test messages
    if (d.type === 'input') handleInput(d.value);
}

// ═══ Skip phone ═══
window.skipPhone = function() {
    document.getElementById('gamma-local').style.display = 'block';
    document.getElementById('gamma-remote').style.display = 'none';
    showScreen('scr-cal');
    calGo(0);
};

initPeer();

// ═══ Calibration ═══
let calStep = 0;
const gs = document.getElementById('gs');
const ss = document.getElementById('ss');
const ic = document.getElementById('ic');
const csh = document.getElementById('card-shape');

function updateGamma() {
    const v = gs.value;
    ic.style.backgroundColor = `rgb(${v},${v},${v})`;
    document.getElementById('gv').textContent = v;
}
function updateCardSize() {
    const px = parseFloat(ss.value);
    csh.style.width = px + 'px';
    csh.style.height = (px / 1.585) + 'px';
    document.getElementById('sv').textContent = px.toFixed(0);
}
gs.oninput = updateGamma;
ss.oninput = updateCardSize;
updateGamma(); updateCardSize();

window.calGo = function(n) {
    calStep = n;
    for (let i = 0; i < 4; i++) {
        document.getElementById('cs' + i).classList.remove('active');
        const d = document.getElementById('d' + i);
        d.classList.remove('done', 'cur');
        if (i < n) d.classList.add('done');
        else if (i === n) d.classList.add('cur');
    }
    document.getElementById('cs' + n).classList.add('active');
    // Tell phone what step we're on + current values
    tx({
        type: 'calStep', step: n,
        gamma: parseInt(gs.value),
        cardPx: parseFloat(ss.value),
        pxPerMm: parseFloat(ss.value) / 85.6
    });
};

function distToMm() {
    const v = parseFloat(document.getElementById('dv').value);
    if (isNaN(v)) return NaN;
    const u = document.getElementById('du').value;
    return v * ({ ft: 304.8, m: 1000, cm: 10, 'in': 25.4 }[u] || NaN);
}

window.calValidate = function() {
    const de = document.getElementById('de');
    const dv = document.getElementById('dv');
    de.textContent = '';
    const raw = dv.value.trim();
    if (!raw) { de.textContent = 'Enter a distance.'; return; }
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) { de.textContent = 'Invalid number.'; return; }
    const mmVal = distToMm();
    if (mmVal < 200) { de.textContent = 'Too close.'; return; }
    if (mmVal > 20000) { de.textContent = 'Too far.'; return; }
    const ppm = parseFloat(ss.value) / 85.6;
    const ppd = mmVal * 0.017455 * ppm;
    document.getElementById('sg').textContent = gs.value;
    document.getElementById('sp2').textContent = ppm.toFixed(3);
    const u = document.getElementById('du').value;
    document.getElementById('sdi').textContent = `${val} ${u} (${(mmVal/1000).toFixed(2)} m)`;
    document.getElementById('smi').textContent = document.getElementById('mm').checked ? 'On' : 'Off';
    document.getElementById('spp').textContent = ppd.toFixed(1) + ' px/°';
    document.getElementById('spp').style.color = ppd < 10 ? 'var(--e)' : 'var(--a)';
    calGo(3);
};

// ═══ Test ═══
let mode = null, engine = null, currentStim = null;
let testComplete = false, testStarted = false, lastInputTime = 0;

window.startTest = function() {
    // Save calibration
    localStorage.setItem('user_gamma_grey', gs.value);
    localStorage.setItem('user_px_per_mm', parseFloat(ss.value) / 85.6);
    localStorage.setItem('user_distance_mm', distToMm());
    localStorage.setItem('mirror_mode', document.getElementById('mm').checked);
    localStorage.setItem('cal_timestamp', new Date().toISOString());

    const cal = {
        pxPerMm: parseFloat(ss.value) / 85.6,
        distMm: distToMm(),
        midPoint: parseInt(gs.value),
        isMirror: document.getElementById('mm').checked
    };

    if (cal.isMirror) document.getElementById('mirror-target').classList.add('mirror-flip');

    mode = createMode('gabor');
    mode.generate();
    engine = new QCSFEngine({ numAFC: mode.numAFC, psychometricSlope: mode.psychometricSlope });
    testComplete = false; testStarted = false; currentStim = null;
    updateProgress(0);

    showScreen('scr-test');

    // Tell phone to switch to test mode
    tx({
        type: 'testStart',
        labels: mode.labels, keys: mode.keys,
        responseType: mode.responseType,
        maxTrials: MAX_TRIALS
    });

    // Show waiting state
    const canvas = document.getElementById('stimCanvas');
    const ctx = canvas.getContext('2d');
    const mp = cal.midPoint;
    ctx.fillStyle = `rgb(${mp},${mp},${mp})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Store cal for rendering
    window._cal = cal;
};

function handleInput(value) {
    if (testComplete) return;
    if (!testStarted) { testStarted = true; nextTrial(); return; }
    if (!currentStim || !mode) return;
    const validKeys = new Set(mode.keys);
    if (!validKeys.has(value)) return;
    const now = performance.now();
    if (now - lastInputTime < DEBOUNCE_MS) return;
    lastInputTime = now;

    const correct = mode.checkAnswer(value);
    try { engine.update(currentStim.stimIndex, correct); }
    catch (e) { finish(); return; }

    updateProgress(engine.trialCount);
    tx({ type: 'progress', trial: engine.trialCount, maxTrials: MAX_TRIALS });

    if (engine.trialCount >= MAX_TRIALS) { finish(); return; }
    nextTrial();
}
window.handleInput = handleInput;

// Keyboard fallback
document.addEventListener('keydown', e => {
    if (testComplete) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') handleInput('up');
    else if (k === 'arrowright' || k === 'd') handleInput('right');
    else if (k === 'e') handleInput('upright');
    else if (k === 'q') handleInput('upleft');
    else if (k === 'n') handleInput('none');
    else if (k === ' ') { e.preventDefault(); handleInput('_start'); }
});

function nextTrial() {
    try { currentStim = engine.selectStimulus(); }
    catch (e) { finish(); return; }
    if (currentStim.contrast <= 0 || currentStim.contrast > 1 || isNaN(currentStim.contrast))
        currentStim.contrast = Math.max(0.001, Math.min(1.0, currentStim.contrast || 0.5));
    if (currentStim.frequency <= 0 || isNaN(currentStim.frequency))
        currentStim.frequency = 4;
    const canvas = document.getElementById('stimCanvas');
    try { mode.render(canvas, currentStim, window._cal); } catch (e) {}
}

function updateProgress(t) {
    const el = document.getElementById('live-progress');
    if (el) el.textContent = `${t} / ${MAX_TRIALS}`;
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${(t / MAX_TRIALS) * 100}%`;
}

function finish() {
    testComplete = true;
    let result;
    try { result = computeResult(engine); }
    catch (e) { result = { aulcsf: 0, rank: 'ERROR', detail: '', params: engine.getExpectedEstimate(), curve: [] }; }

    showScreen('scr-results');
    document.getElementById('final-auc').innerText = result.aulcsf.toFixed(2);
    document.getElementById('final-rank').innerText = result.rank;
    document.getElementById('final-detail').innerText = result.detail;

    let plotUrl = '';
    try {
        const pc = document.getElementById('csf-plot');
        plotUrl = drawCSFPlot(pc, engine, result.params);
    } catch (e) {}

    // Send results to phone
    tx({
        type: 'results',
        score: result.aulcsf.toFixed(2),
        rank: result.rank,
        detail: result.detail,
        plotDataUrl: plotUrl,
        curve: result.curve || [],
        history: engine.history.map(h => ({
            stimIndex: h.stimIndex, correct: h.correct,
            freq: engine.stimGrid[h.stimIndex].freq,
            logContrast: engine.stimGrid[h.stimIndex].logContrast
        }))
    });
}
