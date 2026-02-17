/**
  * Burke Vision Lab — Display Controller (v7)
 * Card -> Mirror -> Luminance -> Distance -> Confirm -> Tutorial -> Test -> Results
 */
import { MAX_HUMAN_CUTOFF_CPD, QCSFEngine } from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawGabor }     from './gabor.js';
import { drawCSFPlot }   from './csf-plot.js';
import { computeResult } from './results.js';
import { createHost }    from './peer-sync.js';

const MAX_TRIALS = 50, DEBOUNCE_MS = 250, NUM_STEPS = 5;
const CARD_W_MM = 85.6, CARD_H_MM = 53.98, CARD_ASPECT = CARD_W_MM / CARD_H_MM;

function showScreen(id) {
    const target = document.getElementById(id);
    const current = document.querySelector('.screen.active');
    if (current && current.id !== id) {
        current.classList.remove('active');
    }
    // Small delay so the outgoing fade starts before incoming
    requestAnimationFrame(() => target.classList.add('active'));
}
window.showScreen = showScreen;

let host = null, phoneConnected = false, isMirror = false;

// Auto-advance: two-phase intro — text cross-fade, then dot morphs to QR
setTimeout(() => {
    document.getElementById('scr-qr').classList.add('phase-ready');
    setTimeout(() => document.getElementById('scr-qr').classList.add('phase-qr'), 5000);
}, 5000);

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
            const qrEl = document.getElementById('qrcode');
            qrEl.innerHTML = '';
            if (typeof QRCode !== 'undefined') {
                new QRCode(qrEl, { text: url, width: 200, height: 200, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.L });
            } else {
                qrEl.innerHTML = `<a href="${url}" style="font-size:.5rem;word-break:break-all;max-width:260px;color:#00ffcc">${url}</a>`;
            }
        },
        () => {
            phoneConnected = true;
            document.getElementById('card-local').style.display = 'none';
            document.getElementById('card-remote').style.display = 'block';
            document.getElementById('gamma-local').style.display = 'none';
            document.getElementById('gamma-remote').style.display = 'block';
            document.getElementById('cal-box').classList.add('phone-connected');
            showScreen('scr-cal'); calGo(0);
        },
        (d) => handlePhoneMessage(d),
        () => {
            phoneConnected = false;
            document.getElementById('card-local').style.display = 'block';
            document.getElementById('card-remote').style.display = 'none';
            document.getElementById('gamma-local').style.display = 'block';
            document.getElementById('gamma-remote').style.display = 'none';
            document.getElementById('cal-box').classList.remove('phone-connected');
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
    const h = px / CARD_ASPECT;
    csh.style.width  = px + 'px';
    csh.style.height = h + 'px';
    document.getElementById('sv').textContent = px.toFixed(0);
}
gs.oninput = updateGamma;
ss.oninput = updateCardSize;
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
    if (mmVal < 4572) { de.textContent = 'Minimum 15 ft'; return; }
    if (mmVal > 30000) { de.textContent = 'Too far'; return; }

    const ppm = parseFloat(ss.value) / CARD_W_MM;
    const u = document.getElementById('du').value;
    const effMm = mmVal;
    const effPpd = effMm * 0.017455 * ppm;

    document.getElementById('smi').textContent = isMirror ? 'On' : 'Off';
    document.getElementById('sg').textContent = gs.value;
    document.getElementById('sp2').textContent = ppm.toFixed(3) + ' px/mm';
   document.getElementById('sdi').textContent = `${val} ${u} = ${(effMm / 1000).toFixed(2)} m`;
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
    { angle: -1,  key: 'none',    arrow: 'Ø',       name: 'No Target' } 
];
let tutStep = 0;

function renderTutStep(idx) {
    tutStep = idx;
    const s = TUT[idx], tc = document.getElementById('tut-canvas');
    const demoCal = { pxPerMm: 14.3, distMm: 800, midPoint: 128 };

    // Labels ABOVE the plate
    document.getElementById('tut-step-label').textContent = `Demo ${idx + 1} of ${TUT.length}`;
    const orientEl = document.getElementById('tut-orient-name');
    orientEl.style.animation = 'none'; orientEl.offsetHeight;
    orientEl.textContent = s.name;
    orientEl.style.animation = '';

    if (s.angle >= 0) {
        drawGabor(tc, { cpd: 4, contrast: 0.95, angle: s.angle }, demoCal);
    } else {
        const ctx2 = tc.getContext('2d');
        ctx2.fillStyle = 'rgb(128,128,128)';
        ctx2.fillRect(0, 0, tc.width, tc.height);
    }

    document.getElementById('tut-arrow').textContent = s.arrow;
    document.getElementById('tut-key-name').textContent = `Press ${s.name}`;
    document.getElementById('tut-dots').innerHTML = TUT.map((_, i) => `<div class="tut-dot${i === idx ? ' active' : ''}"></div>`).join('');
    document.getElementById('tut-hint').textContent =
        idx < TUT.length - 1 ? 'Press the highlighted button on your phone' : 'Complete this step to begin';
    tx({ type: 'tutStep', stepIdx: idx, key: s.key, arrow: s.arrow, name: s.name, total: TUT.length });
}

function advanceTut(key) {
    if (key !== TUT[tutStep].key) return;
    if (tutStep < TUT.length - 1) renderTutStep(tutStep + 1);
    else {
        const tutEl = document.getElementById('tutorial');
        tutEl.classList.add('hiding');
        setTimeout(() => { tutEl.style.display = 'none'; tutEl.classList.remove('hiding'); }, 350);
        testStarted = true;
        nextTrial();
        tx({ type: 'testStart', maxTrials: MAX_TRIALS });
    }
}

// ═══ Share/Save Plot ═══
window.sharePlot = async function() {
    const canvas = document.getElementById('csf-plot');
    try {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const file = new File([blob], 'Burke Vision Lab-Results.png', { type: 'image/png' });

        // Try native share first (iOS/Android)
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title: 'Burke Vision Lab Results', files: [file] });
            return;
        }
    } catch (e) { /* fall through to download */ }

    // Fallback: download the image
    try {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'Burke Vision Lab-Results.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (e) { console.error('Share failed:', e); }
};

// ═══ Test ═══
let mode = null, engine = null, currentStim = null;
let testComplete = false, testStarted = false, inTutorial = false, lastInputTime = 0;

window.startTest = function() {
    const ppm = parseFloat(ss.value) / CARD_W_MM;
    const effDist = distToMm();
    window._cal = { pxPerMm: ppm, distMm: effDist, midPoint: parseInt(gs.value), isMirror };
    const mirrorTarget = document.getElementById('mirror-target');
    if (isMirror) mirrorTarget.classList.add('mirror-flip');
    else mirrorTarget.classList.remove('mirror-flip');

    mode = createMode('gabor'); mode.generate();
    engine = new QCSFEngine({ numAFC: mode.numAFC, psychometricSlope: mode.psychometricSlope });
    testComplete = false; testStarted = false; inTutorial = true; currentStim = null;
    updateProgress(0);

    const canvas = document.getElementById('stimCanvas'), ctx = canvas.getContext('2d');
    const mp = window._cal.midPoint;
    ctx.fillStyle = `rgb(${mp},${mp},${mp})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    showScreen('scr-test');
    const tutEl = document.getElementById('tutorial');
    tutEl.style.display = 'flex';
    if (isMirror) tutEl.classList.add('mirror-flip'); else tutEl.classList.remove('mirror-flip');
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
    else if (k === 'x' || k === 'n' || k === ' ') handleInput('none');
});

function nextTrial() {
    try { currentStim = engine.selectStimulus(); } catch (e) { finish(); return; }
    if (currentStim.contrast <= 0 || currentStim.contrast > 1 || isNaN(currentStim.contrast))
        currentStim.contrast = Math.max(0.001, Math.min(1.0, currentStim.contrast || 0.5));
    if (currentStim.frequency <= 0 || isNaN(currentStim.frequency)) currentStim.frequency = 4;
    try { mode.render(document.getElementById('stimCanvas'), currentStim, window._cal); } catch (e) {}
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
    catch (e) { result = { aulcsf: 0, rank: 'ERROR', detail: '', params: null, curve: [] }; }

    showScreen('scr-results');
    const resultScreen = document.getElementById('scr-results');
    const resultContent = document.getElementById('result-content');
    resultScreen.classList.add('results-boost');
    if (isMirror) resultContent.classList.add('mirrored');
    else resultContent.classList.remove('mirrored');

    document.getElementById('final-auc').innerText = result.aulcsf.toFixed(2);
    document.getElementById('final-rank').innerText = result.rank;
    document.getElementById('final-detail').innerText = result.detail;

    let plotUrl = '';
    try { plotUrl = drawCSFPlot(document.getElementById('csf-plot'), engine, result.params); } catch (e) { console.error('Plot error:', e); }

    // Build rich results with per-landmark assessments
    const lmResults = [];
    const landmarks = [
        { name: 'Car (clear)',           freq: 2,  sens: 2,   context: 'Detecting a vehicle at 400 m on a clear day' },
        { name: 'Car (fog)',             freq: 2,  sens: 20,  context: 'Detecting a vehicle at 400 m in fog' },
        { name: 'Pedestrian (day)',      freq: 6,  sens: 2,   context: 'Seeing a person at 100 m in daylight' },
        { name: 'Pedestrian (dusk)',     freq: 6,  sens: 33,  context: 'Detecting a person at dusk on a dark road' },
        { name: 'Exit sign (day)',       freq: 10, sens: 2,   context: 'Reading highway signs at 250 ft' },
        { name: 'Exit sign (night)',     freq: 10, sens: 33,  context: 'Reading worn road signs at night in rain' },
        { name: 'Golf ball on grass',    freq: 18, sens: 2,   context: 'Tracking ball on fairway at 100 yd' },
        { name: 'Golf ball, cloudy sky', freq: 18, sens: 10,  context: 'Spotting ball against overcast sky at 100 yd' },
        { name: 'Plate (day)',           freq: 26, sens: 2,   context: 'Reading a license plate at 35 m in daylight' },
        { name: 'Plate (night)',         freq: 26, sens: 25,  context: 'Reading a license plate at 35 m in rain at night' },
    ];
    landmarks.forEach(lm => {
        const yourSens = Math.pow(10, engine.evaluateCSF(lm.freq, result.params));
        const pass = yourSens >= lm.sens;
        const margin = yourSens / lm.sens;
        lmResults.push({
            name: lm.name, context: lm.context, freq: lm.freq,
            needed: lm.sens, yours: Math.round(yourSens),
            pass, margin: margin.toFixed(1)
        });
    });

    // Snellen prediction
    let snellenStr = '--';
    const curveData = result.curve || [];
    for (let i = 1; i < curveData.length; i++) {
        if (curveData[i - 1].logS >= 0 && curveData[i].logS < 0) {
            const f1 = Math.log10(curveData[i - 1].freq), f2 = Math.log10(curveData[i].freq);
            const s1 = curveData[i - 1].logS, s2 = curveData[i].logS;
            const cutoff = Math.min(MAX_HUMAN_CUTOFF_CPD, Math.pow(10, f1 + (0 - s1) / (s2 - s1) * (f2 - f1)));
            snellenStr = '20/' + Math.round(20 * 30 / cutoff);
            break;
        }
    }

    // Send results WITHOUT the large plot image first (ensures phone gets data)
    tx({
        type: 'results',
        score: result.aulcsf.toFixed(2),
        rank: result.rank,
        detail: result.detail,
        snellen: snellenStr,
        peakSens: Math.round(Math.pow(10, result.params.peakGain)),
        peakFreq: result.params.peakFreq.toFixed(1),
        landmarks: lmResults,
        passCount: lmResults.filter(l => l.pass).length,
        totalLandmarks: lmResults.length,
    });

    // Send downscaled plot image to phone (full PNG can be 2-4MB)
    if (plotUrl) {
        try {
            const srcCanvas = document.getElementById('csf-plot');
            const phoneCanvas = document.createElement('canvas');
            phoneCanvas.width = 760; phoneCanvas.height = 528;
            phoneCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, 760, 528);
            tx({ type: 'plotImage', url: phoneCanvas.toDataURL('image/jpeg', 0.80) });
        } catch (e) { console.warn('Plot send failed:', e); }
    }
}
