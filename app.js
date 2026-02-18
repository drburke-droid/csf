/**
  * Burke Vision Lab — Display Controller (v7)
 * Card -> Mirror -> Luminance -> Distance -> Confirm -> Tutorial -> Test -> Results
 */
import { MAX_HUMAN_CUTOFF_CPD, QCSFEngine } from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawGabor }     from './gabor.js';
import { drawCSFPlot }   from './csf-plot.js';
import { computeResult } from './results.js';
import { createHost, createTemporaryHost, createHandoffClient,
         shortCode, codeToId, idToCode, formatCode } from './peer-sync.js';

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
let tempHost = null; // temporary PeerJS host for phone-first flow

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
    if (d.type === 'preTestAnswer') {
        preTestData = { eye: d.eye, correction: d.correction };
        beginTestAfterPreTest();
    }
}

function onPhoneConnect() {
    phoneConnected = true;
    document.getElementById('card-local').style.display = 'none';
    document.getElementById('card-remote').style.display = 'block';
    document.getElementById('gamma-local').style.display = 'none';
    document.getElementById('gamma-remote').style.display = 'block';
    document.getElementById('cal-box').classList.add('phone-connected');
    showScreen('scr-cal'); calGo(0);
}

function onPhoneDisconnect() {
    phoneConnected = false;
    document.getElementById('card-local').style.display = 'block';
    document.getElementById('card-remote').style.display = 'none';
    document.getElementById('gamma-local').style.display = 'block';
    document.getElementById('gamma-remote').style.display = 'none';
    document.getElementById('cal-box').classList.remove('phone-connected');
}

window.skipPhone = function() {
    if (tempHost) { tempHost.destroy(); tempHost = null; }
    if (host) { host.destroy(); host = null; }
    document.getElementById('card-local').style.display = 'block';
    document.getElementById('card-remote').style.display = 'none';
    document.getElementById('gamma-local').style.display = 'block';
    document.getElementById('gamma-remote').style.display = 'none';
    showScreen('scr-cal'); calGo(0);
};

// ═══ Landing Flow ═══
function isMobileDevice() {
    return window.innerWidth < 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

function siteBaseUrl() {
    const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
    return `${location.host}${dir}/`;
}

window.goToWelcome = function() {
    if (tempHost) { tempHost.destroy(); tempHost = null; }
    if (host) { host.destroy(); host = null; }
    showScreen('scr-welcome');
};

window.goToRole = function() {
    if (tempHost) { tempHost.destroy(); tempHost = null; }
    if (host) { host.destroy(); host = null; }
    showScreen('scr-role');
};

window.selectRole = function(role) {
    if (role === 'remote') {
        showScreen('scr-pair-remote');
        startRemotePairing();
    } else if (role === 'display') {
        showScreen('scr-pair-display');
    }
};

// ── Remote Pairing (phone generates code, waits for Display to connect) ──
function startRemotePairing() {
    if (tempHost) { tempHost.destroy(); tempHost = null; }
    const code = shortCode();
    const peerId = codeToId(code);

    document.getElementById('my-code').textContent = formatCode(code);
    document.getElementById('pair-url').textContent = siteBaseUrl();
    setStatus('remote-status', 'sd-wait', 'Waiting for display\u2026');

    tempHost = createTemporaryHost(
        peerId,
        () => { console.log('[Landing] Remote listening as', peerId); },
        (displayId) => {
            // Handoff received — redirect to tablet.html
            setStatus('remote-status', 'sd-ok', 'Connected! Loading\u2026');
            setTimeout(() => {
                tempHost.destroy(); tempHost = null;
                const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
                location.href = `${location.origin}${dir}/tablet.html?id=${displayId}`;
            }, 400);
        },
        (err) => {
            if (err === 'unavailable-id') {
                setStatus('remote-status', 'sd-wait', 'Regenerating code\u2026');
                setTimeout(startRemotePairing, 300);
            }
        }
    );
}

// Secondary: Remote enters a code from Display
window.remoteEnterCode = function() {
    const input = document.getElementById('remote-code-input');
    const code = input.value.trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (code.length !== 4) { input.style.borderColor = 'var(--e)'; return; }
    input.style.borderColor = '';

    if (tempHost) { tempHost.destroy(); tempHost = null; }

    const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
    location.href = `${location.origin}${dir}/tablet.html?id=${codeToId(code)}`;
};

// ── Code box auto-advance logic ──
document.querySelectorAll('.code-box').forEach(box => {
    box.addEventListener('input', e => {
        const v = box.value.replace(/[^A-Za-z2-9]/g, '').toUpperCase();
        box.value = v.charAt(0) || '';
        box.classList.toggle('filled', !!box.value);
        box.classList.remove('err');
        if (box.value && box.dataset.idx < 3) {
            document.getElementById('cb' + (parseInt(box.dataset.idx) + 1)).focus();
        }
    });
    box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && box.dataset.idx > 0) {
            const prev = document.getElementById('cb' + (parseInt(box.dataset.idx) - 1));
            prev.value = ''; prev.classList.remove('filled');
            prev.focus();
            e.preventDefault();
        }
        if (e.key === 'Enter') displayEnterCode();
    });
    box.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').toUpperCase().replace(/[^A-Z2-9]/g, '');
        for (let i = 0; i < 4; i++) {
            const b = document.getElementById('cb' + i);
            b.value = text.charAt(i) || '';
            b.classList.toggle('filled', !!b.value);
        }
        if (text.length >= 4) document.getElementById('cb3').focus();
    });
});

// ── Display Pairing (PC enters phone's code → handoff) ──
window.displayEnterCode = function() {
    const code = [0,1,2,3].map(i => document.getElementById('cb'+i).value).join('').toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (code.length !== 4) {
        document.querySelectorAll('.code-box').forEach(b => { if (!b.value) b.classList.add('err'); });
        return;
    }
    document.querySelectorAll('.code-box').forEach(b => b.classList.remove('err'));

    if (typeof Peer === 'undefined') { setStatus('display-status', 'sd-er', 'PeerJS unavailable'); return; }

    setStatus('display-status', 'sd-wait', 'Connecting\u2026');

    const phoneId = codeToId(code);
    const myCode = shortCode();
    const myId = codeToId(myCode);

    host = createHandoffClient(
        phoneId, myId,
        () => onPhoneConnect(),         // permanent connection open
        (d) => handlePhoneMessage(d),
        () => onPhoneDisconnect(),
        (e) => {
            const msg = (e && e.type === 'peer-unavailable') ? 'Code not found — check the code on your phone' : 'Connection error';
            setStatus('display-status', 'sd-er', msg);
        }
    );
};

// Secondary: Display generates its own code (PC-first flow)
window.displayGenerateCode = function() {
    if (typeof Peer === 'undefined') { setStatus('display-wait-status', 'sd-er', 'PeerJS unavailable'); return; }

    const code = shortCode();
    const peerId = codeToId(code);

    document.getElementById('display-code-area').style.display = '';
    document.getElementById('display-code-area').style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px';
    document.getElementById('display-my-code').textContent = formatCode(code);
    document.getElementById('display-pair-url').textContent = siteBaseUrl();
    document.getElementById('gen-code-btn').style.display = 'none';

    // Generate QR code
    const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
    const url = `${location.origin}${dir}/tablet.html?id=${peerId}`;
    const qrEl = document.getElementById('display-qrcode');
    qrEl.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
        new QRCode(qrEl, { text: url, width: 180, height: 180, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.L });
    }

    setStatus('display-wait-status', 'sd-wait', 'Waiting for phone\u2026');

    host = createHost(
        (id) => { console.log('[Display] Listening as', id); },
        () => onPhoneConnect(),
        (d) => handlePhoneMessage(d),
        () => onPhoneDisconnect(),
        peerId
    );
};

function setStatus(elId, dotClass, text) {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = `<span class="sd ${dotClass}"></span> ${text}`;
}

// ── Init: check URL params or show welcome ──
(function initLanding() {
    const params = new URLSearchParams(location.search);
    const urlCode = params.get('code');
    if (urlCode && urlCode.length === 4) {
        showScreen('scr-pair-display');
        document.getElementById('display-code-input').value = urlCode.toUpperCase();
    }
    // Otherwise #scr-welcome is already active in HTML
})();

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

    const ppdWarn = effPpd < 50 || effPpd > 800;
    const warnEl = document.getElementById('ppd-warn');
    if (warnEl) { warnEl.style.display = ppdWarn ? 'block' : 'none'; }

    calGo(4);
    tx({ type: 'calSummary', mirror: isMirror, gamma: gs.value,
         ppm: ppm.toFixed(3), distance: `${val} ${u}`,
         distM: (effMm / 1000).toFixed(2), ppd: effPpd.toFixed(1),
         ppdWarning: ppdWarn });
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
        showPreTest();
    }
}

function showPreTest() {
    inPreTest = true;
    preTestData = { eye: null, correction: null };
    const ptEl = document.getElementById('pretest');
    ptEl.style.display = 'flex';
    if (isMirror) ptEl.classList.add('mirror-flip'); else ptEl.classList.remove('mirror-flip');
    // Reset button states
    ptEl.querySelectorAll('.pretest-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('pt-go').disabled = true;
    tx({ type: 'preTest' });
}

function beginTestAfterPreTest() {
    const ptEl = document.getElementById('pretest');
    ptEl.classList.add('hiding');
    setTimeout(() => { ptEl.style.display = 'none'; ptEl.classList.remove('hiding'); }, 350);
    if (window._cal) {
        window._cal.eye = preTestData.eye;
        window._cal.correction = preTestData.correction;
    }
    inPreTest = false;
    testStarted = true;
    inTutorial = false;
    nextTrial();
    tx({ type: 'testStart', maxTrials: MAX_TRIALS });
}

window.pickEye = function(btn, val) {
    preTestData.eye = val;
    document.getElementById('pt-eye').querySelectorAll('.pretest-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('pt-go').disabled = !(preTestData.eye && preTestData.correction);
};

window.pickCorr = function(btn, val) {
    preTestData.correction = val;
    document.getElementById('pt-corr').querySelectorAll('.pretest-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('pt-go').disabled = !(preTestData.eye && preTestData.correction);
};

window.submitPreTest = function() {
    if (!preTestData.eye || !preTestData.correction) return;
    beginTestAfterPreTest();
};

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
let testComplete = false, testStarted = false, inTutorial = false, inPreTest = false, lastInputTime = 0;
let preTestData = { eye: null, correction: null };

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
    if (inTutorial) { advanceTut(value); if (testStarted || inPreTest) inTutorial = false; return; }
    if (inPreTest) return;
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
        { name: 'Car (clear)', freq: 2, sens: 2,
          context: 'Detecting a vehicle at 400 m on a clear day',
          what: 'Spotting another vehicle on the highway about a quarter mile ahead on a clear day.',
          science: 'A car body is roughly 1.8 meters wide. At 400 meters it subtends 0.26 degrees of visual angle, corresponding to about 2 cycles per degree — a very coarse visual detail.',
          perception: 'This is a low-frequency detection task. Your visual system uses its coarse-detail channels, which are tuned for large shapes. Even moderate contrast between the car and road is enough for detection.' },
        { name: 'Car (fog)', freq: 2, sens: 20,
          context: 'Detecting a vehicle at 400 m in fog',
          what: 'Spotting a vehicle a quarter mile ahead in moderate fog with roughly 500 m visibility.',
          science: 'Fog scatters light and reduces contrast exponentially with distance (Koschmieder\'s law). At 400 m in moderate fog, the original ~50% contrast drops to approximately 5%.',
          perception: 'The car is the same size, but fog washes out the contrast. Your visual system now needs much higher sensitivity at the same spatial frequency. This is purely a contrast problem, not a size problem.' },
        { name: 'Pedestrian (day)', freq: 6, sens: 2,
          context: 'Seeing a person at 100 m in daylight',
          what: 'Detecting a person standing by the roadside at 100 meters (about 330 feet) in daylight.',
          science: 'The critical feature for detecting a pedestrian is the limb-width detail, roughly 15 cm. At 100 meters this subtends 0.086 degrees, corresponding to about 6 cycles per degree.',
          perception: 'At 6 cpd your visual system is near its peak sensitivity. Dark clothing against light pavement creates strong contrast (~45%), making this a comfortable detection task for normal vision.' },
        { name: 'Pedestrian (dusk)', freq: 6, sens: 33,
          context: 'Detecting a person at dusk on a dark road',
          what: 'Spotting a dark-clothed person on a dark road at dusk or in rain, at 100 meters.',
          science: 'At dusk both the person and road surface are dark, reducing contrast to approximately 3%. This is the well-documented "pedestrian conspicuity crisis" in traffic safety research.',
          perception: 'The person is the same size but your visual system needs roughly 16 times more contrast sensitivity to see them. This is why retroreflective clothing saves lives — it restores the contrast your eyes need.' },
        { name: 'Exit sign (day)', freq: 10, sens: 2,
          context: 'Reading highway signs at 250 ft',
          what: 'Reading the text on a highway exit sign at 250 feet (76 meters) during the day.',
          science: 'Standard FHWA freeway signs use 16-inch Series E(Modified) letters. At 250 feet each letter subtends 0.31 degrees. Letter identification requires about 3 spatial frequency cycles per letter (Solomon & Pelli, 1994), giving 10 cycles per degree.',
          perception: 'This is a letter identification task — your visual system must resolve the shape of each letter, not just detect the sign. White letters on green retroreflective sheeting provide excellent daytime contrast (~85%).' },
        { name: 'Exit sign (night)', freq: 10, sens: 33,
          context: 'Reading worn road signs at night in rain',
          what: 'Reading a worn highway exit sign at night in the rain.',
          science: 'Retroreflective sheeting degrades over time, losing 70-80% of reflectivity after 10+ years. Rain creates a water film that further reduces contrast to approximately 3%.',
          perception: 'The letters are the same size, but your visual system needs far more sensitivity. Many drivers report difficulty with road signs at night — this is a contrast sensitivity issue, not an acuity issue. Traditional eye charts miss this entirely.' },
        { name: 'Golf ball on grass', freq: 8, sens: 2,
          context: 'Spotting ball on fairway at 150 yd',
          what: 'Spotting a white golf ball on a green fairway at 150 yards.',
          science: 'The ball (42.67 mm, USGA standard) subtends just 1.07 arcminutes at 150 yards — near the resolution limit of 20/20 vision. However, detection of a bright isolated object is fundamentally different from resolving a pattern. The ball\'s Fourier energy is broadband, and the visual system detects it through its peak-sensitivity channels around 8 cpd, not at the grating-equivalent frequency of 28 cpd.',
          perception: 'You don\'t need to see the dimples — you just need to spot a bright dot against the green. Your visual system uses its most sensitive channels near the peak of your contrast sensitivity curve. This is why detection acuity far exceeds resolution acuity: bright, isolated objects are visible at distances well beyond what a standard eye chart would predict.' },
        { name: 'Golf ball, cloudy sky', freq: 8, sens: 10,
          context: 'Spotting ball against overcast sky at 150 yd',
          what: 'Tracking a golf ball in the air against an overcast sky at 150 yards.',
          science: 'Against clouds, the white ball and bright sky are similar in luminance, dropping Michelson contrast to approximately 10%. The ball is still detected through mid-frequency channels, but 5 times more sensitivity is now required.',
          perception: 'This is why golfers lose sight of the ball against cloudy skies but not against blue sky or green grass. The issue is not the ball\'s size — it\'s the contrast. Colored golf balls (yellow, orange) help because they create more contrast against gray clouds.' },
        { name: 'Plate (day)', freq: 26, sens: 2,
          context: 'Reading a license plate at 35 m in daylight',
          what: 'Reading a license plate about 7 car lengths ahead (35 meters / 115 feet) in daylight.',
          science: 'Standard US plate characters are 70 mm tall (AASHTO specification). At 35 meters each character subtends 0.115 degrees. With 3 cycles per letter for identification, this gives 26 cycles per degree — fine spatial detail near the upper limit of comfortable vision.',
          perception: 'This is a high-frequency identification task. Your visual system must resolve individual characters — the strokes and curves that distinguish a "B" from an "8". Dark characters on a white retroreflective plate provide excellent daytime contrast (~88%).' },
        { name: 'Plate (night)', freq: 26, sens: 25,
          context: 'Reading a license plate at 35 m in rain at night',
          what: 'Reading a license plate 7 car lengths ahead at night in rain.',
          science: 'At night, plates are illuminated by headlights. At 35 meters, reduced headlight intensity, rain, dirt, and atmospheric scatter reduce effective contrast to approximately 4%.',
          perception: 'This pushes both the spatial frequency and contrast demands of your vision. Many people find they can read plates easily in daylight but struggle at night — this is a classic contrast sensitivity deficit that a standard eye chart completely misses.' },
    ];
    landmarks.forEach(lm => {
        const yourSens = Math.pow(10, engine.evaluateCSF(lm.freq, result.params));
        const pass = yourSens >= lm.sens;
        const margin = yourSens / lm.sens;
        lmResults.push({
            name: lm.name, context: lm.context, freq: lm.freq,
            needed: lm.sens, yours: Math.round(yourSens),
            pass, margin: margin.toFixed(1),
            what: lm.what, science: lm.science, perception: lm.perception
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
