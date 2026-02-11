/**
 * BurkeCSF — Display Controller
 * Card → Mirror → Luminance → Distance → Confirm → Tutorial → Test → Results
 */
import { QCSFEngine }    from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawGabor }     from './gabor.js';
import { drawCSFPlot }   from './csf-plot.js';
import { computeResult } from './results.js';
import { createHost }    from './peer-sync.js';

const MAX_TRIALS = 50, DEBOUNCE_MS = 250, NUM_STEPS = 5;
const CARD_ASPECT = 85.6 / 53.98; // ISO credit card W/H = 1.585

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
window.showScreen = showScreen;

let host = null, phoneConnected = false, isMirror = false;

function initPeer() {
    if (typeof Peer === 'undefined') {
        document.getElementById('qr-debug').textContent = 'PeerJS unavailable';
        return;
    }
    host = createHost(
        (id) => {
            const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
            const url = `${location.origin}${dir}/tablet.html?id=${id}`;
            document.getElementById('qr-debug').textContent = id;
            const qrEl = document.getElementById('qrcode'); qrEl.innerHTML = '';
            if (typeof QRCode !== 'undefined') {
                new QRCode(qrEl, { text: url, width: 200, height: 200, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.L });
            } else {
                qrEl.innerHTML = `<p style="font-size:.5rem;word-break:break-all;max-width:260px">${url}</p>`;
            }
        },
        () => {
            phoneConnected = true;
            document.getElementById('card-local').style.display = 'none';
            document.getElementById('card-remote').style.display = 'block';
            document.getElementById('gamma-local').style.display = 'none';
            document.getElementById('gamma-remote').style.display = 'block';
            showScreen('scr-cal'); calGo(0);
        },
        (d) => handlePhoneMessage(d),
        () => {
            phoneConnected = false;
            document.getElementById('card-local').style.display = 'block';
            document.getElementById('card-remote').style.display = 'none';
            document.getElementById('gamma-local').style.display = 'block';
            document.getElementById('gamma-remote').style.display = 'none';
        }
    );
}
function tx(msg) { if (host && host.connected) host.send(msg); }

function handlePhoneMessage(d) {
    if (d.type === 'gamma')    { document.getElementById('gs').value = d.value; updateGamma(); }
    if (d.type === 'cardSize') { document.getElementById('ss').value = d.value; updateCardSize(); }
    if (d.type === 'distance') { document.getElementById('dv').value = d.value; document.getElementById('du').value = d.unit; }
    if (d.type === 'mirror')   setMirror(d.value);
    if (d.type === 'nav') {
        if (d.to === 'next') { if (calStep === 3) calValidate(); else calGo(calStep + 1); }
        else if (d.to === 'back') calGo(Math.max(0, calStep - 1));
        else if (d.to === 'start') startTest();
    }
    if (d.type === 'input') handleInput(d.value);
}

window.skipPhone = function() {
    document.getElementById('card-local').style.display = 'block';
    document.getElementById('card-remote').style.display = 'none';
    document.getElementById('gamma-local').style.display = 'block';
    document.getElementById('gamma-remote').style.display = 'none';
    showScreen('scr-cal'); calGo(0);
};
initPeer();

// ═══ Mirror ═══
window.setMirror = function(val) {
    isMirror = val;
    const box = document.getElementById('cal-box');
    if (isMirror) box.classList.add('mirrored'); else box.classList.remove('mirrored');
    tx({ type: 'mirrorSet', value: isMirror });
    calGo(2);
};

// ═══ Calibration ═══
let calStep = 0;
const gs = document.getElementById('gs'), ss = document.getElementById('ss');
const ic = document.getElementById('ic'), csh = document.getElementById('card-shape');

function updateGamma() {
    const v = gs.value;
    ic.style.backgroundColor = `rgb(${v},${v},${v})`;
    document.getElementById('gv').textContent = v;
}
function updateCardSize() {
    const px = parseFloat(ss.value);
    // Fix: update BOTH width and height maintaining credit card aspect ratio
    csh.style.width = px + 'px';
    csh.style.height = (px / CARD_ASPECT) + 'px';
    document.getElementById('sv').textContent = px.toFixed(0);
}
gs.oninput = updateGamma; ss.oninput = updateCardSize;
updateGamma(); updateCardSize();

window.calGo = function(n) {
    calStep = n;
    for (let i = 0; i < NUM_STEPS; i++) {
        document.getElementById('cs' + i).classList.remove('active');
        const d = document.getElementById('d' + i);
        d.classList.remove('done', 'cur');
        if (i < n) d.classList.add('done'); else if (i === n) d.classList.add('cur');
    }
    document.getElementById('cs' + n).classList.add('active');
    tx({ type: 'calStep', step: n, gamma: parseInt(gs.value), cardPx: parseFloat(ss.value), isMirror });
};

function distToMm() {
    const v = parseFloat(document.getElementById('dv').value);
    if (isNaN(v)) return NaN;
    return v * ({ ft: 304.8, m: 1000, cm: 10, 'in': 25.4 }[document.getElementById('du').value] || NaN);
}

window.calValidate = function() {
    const de = document.getElementById('de'), raw = document.getElementById('dv').value.trim();
    de.textContent = '';
    if (!raw) { de.textContent = 'Enter a distance'; return; }
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) { de.textContent = 'Invalid'; return; }
    const mmVal = distToMm();
    if (mmVal < 200) { de.textContent = 'Too close'; return; }
    if (mmVal > 30000) { de.textContent = 'Too far'; return; }
    const ppm = parseFloat(ss.value) / 85.6, u = document.getElementById('du').value;
    const effMm = isMirror ? mmVal * 2 : mmVal;
    const effPpd = effMm * 0.017455 * ppm;
    document.getElementById('smi').textContent = isMirror ? 'On (2x)' : 'Off';
    document.getElementById('sg').textContent = gs.value;
    document.getElementById('sp2').textContent = ppm.toFixed(3) + ' px/mm';
    document.getElementById('sdi').textContent = `${val} ${u}${isMirror ? ' x2' : ''} = ${(effMm / 1000).toFixed(2)} m`;
    document.getElementById('spp').textContent = effPpd.toFixed(1) + ' px/deg';
    document.getElementById('spp').style.color = effPpd < 10 ? 'var(--e)' : 'var(--a)';
    calGo(4);
};

// ═══ Tutorial ═══
const TUT = [
    { angle: 0,   key: 'up',      arrow: '\u2191', name: 'Vertical' },
    { angle: 90,  key: 'right',   arrow: '\u2192', name: 'Horizontal' },
    { angle: 45,  key: 'upright', arrow: '\u2197', name: 'Right Tilt' },
    { angle: 135, key: 'upleft',  arrow: '\u2196', name: 'Left Tilt' },
    { angle: -1,  key: 'none',    arrow: '\u2715', name: 'No Target' }
];
let tutStep = 0;

function renderTutStep(idx) {
    tutStep = idx;
    const s = TUT[idx], tc = document.getElementById('tut-canvas');
    // Calibration for demo: make ~8 cycles visible across 400px canvas at 4cpd
    const demoCal = { pxPerMm: 14.3, distMm: 800, midPoint: 128 };
    if (s.angle >= 0) {
        drawGabor(tc, { cpd: 4, contrast: 0.95, angle: s.angle }, demoCal);
        document.getElementById('tut-sub').innerHTML = `<strong>${s.name}</strong> grating`;
    } else {
        const ctx = tc.getContext('2d');
        ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0, 0, tc.width, tc.height);
        document.getElementById('tut-sub').innerHTML = `Cannot see a grating? Press <strong>No Target</strong>`;
    }
    document.getElementById('tut-arrow').textContent = s.arrow;
    document.getElementById('tut-key-name').textContent = `Press ${s.name} on phone`;
    document.getElementById('tut-title').textContent = `Demo ${idx + 1} of ${TUT.length}`;
    document.getElementById('tut-dots').innerHTML = TUT.map((_, i) => `<div class="tut-dot${i === idx ? ' active' : ''}"></div>`).join('');
    document.getElementById('tut-hint').textContent = idx < TUT.length - 1 ? 'Press the highlighted button on your phone' : 'Press No Target to begin the test';
    tx({ type: 'tutStep', stepIdx: idx, key: s.key, arrow: s.arrow, name: s.name, total: TUT.length });
}

function advanceTut(key) {
    if (key !== TUT[tutStep].key) return;
    if (tutStep < TUT.length - 1) renderTutStep(tutStep + 1);
    else { document.getElementById('tutorial').style.display = 'none'; testStarted = true; nextTrial(); tx({ type: 'testStart', maxTrials: MAX_TRIALS }); }
}

// ═══ Test ═══
let mode = null, engine = null, currentStim = null;
let testComplete = false, testStarted = false, inTutorial = false, lastInputTime = 0;

window.startTest = function() {
    localStorage.setItem('user_gamma_grey', gs.value);
    const ppm = parseFloat(ss.value) / 85.6;
    const effDist = isMirror ? distToMm() * 2 : distToMm();
    window._cal = { pxPerMm: ppm, distMm: effDist, midPoint: parseInt(gs.value), isMirror };
    if (isMirror) document.getElementById('mirror-target').classList.add('mirror-flip');

    mode = createMode('gabor'); mode.generate();
    engine = new QCSFEngine({ numAFC: mode.numAFC, psychometricSlope: mode.psychometricSlope });
    testComplete = false; testStarted = false; inTutorial = true; currentStim = null;
    updateProgress(0);

    const canvas = document.getElementById('stimCanvas'), ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${window._cal.midPoint},${window._cal.midPoint},${window._cal.midPoint})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    showScreen('scr-test');
    document.getElementById('tutorial').style.display = 'flex';
    renderTutStep(0);
};

function handleInput(value) {
    if (testComplete) return;
    if (inTutorial) { advanceTut(value); if (testStarted) inTutorial = false; return; }
    if (!testStarted || !currentStim || !mode) return;
    if (!new Set(mode.keys).has(value)) return;
    const now = performance.now();
    if (now - lastInputTime < DEBOUNCE_MS) return;
    lastInputTime = now;
    const correct = mode.checkAnswer(value);
    try { engine.update(currentStim.stimIndex, correct); } catch (e) { finish(); return; }
    updateProgress(engine.trialCount);
    tx({ type: 'progress', trial: engine.trialCount, maxTrials: MAX_TRIALS });
    if (engine.trialCount >= MAX_TRIALS) { finish(); return; }
    nextTrial();
}
window.handleInput = handleInput;

document.addEventListener('keydown', e => {
    if (testComplete) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') handleInput('up');
    else if (k === 'arrowright' || k === 'd') handleInput('right');
    else if (k === 'e') handleInput('upright');
    else if (k === 'q') handleInput('upleft');
    else if (k === 'n') handleInput('none');
});

function nextTrial() {
    try { currentStim = engine.selectStimulus(); } catch (e) { finish(); return; }
    if (currentStim.contrast <= 0 || currentStim.contrast > 1 || isNaN(currentStim.contrast))
        currentStim.contrast = Math.max(0.001, Math.min(1.0, currentStim.contrast || 0.5));
    if (currentStim.frequency <= 0 || isNaN(currentStim.frequency)) currentStim.frequency = 4;
    try { mode.render(document.getElementById('stimCanvas'), currentStim, window._cal); } catch (e) {}
}

function updateProgress(t) {
    const el = document.getElementById('live-progress'); if (el) el.textContent = `${t} / ${MAX_TRIALS}`;
    const fill = document.getElementById('progress-fill'); if (fill) fill.style.width = `${(t / MAX_TRIALS) * 100}%`;
}

function finish() {
    testComplete = true;
    let result;
    try { result = computeResult(engine); }
    catch (e) { result = { aulcsf: 0, rank: 'ERROR', detail: '', params: null, curve: [] }; }
    showScreen('scr-results');
    document.getElementById('final-auc').innerText = result.aulcsf.toFixed(2);
    document.getElementById('final-rank').innerText = result.rank;
    document.getElementById('final-detail').innerText = result.detail;
    let plotUrl = '';
    try { plotUrl = drawCSFPlot(document.getElementById('csf-plot'), engine, result.params); } catch (e) {}
    tx({
        type: 'results', score: result.aulcsf.toFixed(2), rank: result.rank,
        detail: result.detail, plotDataUrl: plotUrl,
        curve: result.curve || [],
        history: engine.history.map(h => ({
            stimIndex: h.stimIndex, correct: h.correct,
            freq: engine.stimGrid[h.stimIndex].freq,
            logContrast: engine.stimGrid[h.stimIndex].logContrast
        }))
    });
}
