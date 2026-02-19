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
const CSF_EXPLORER_URL = 'https://drburke-droid.github.io/csf/csf-explorer.html';
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

// Clean up peer connections on page hide/unload to avoid stale broker entries
window.addEventListener('pagehide', () => {
    if (host) { try { host.destroy(); } catch(e) {} }
    if (tempHost) { try { tempHost.destroy(); } catch(e) {} }
});

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
        if (isMobileDevice()) {
            const warn = document.getElementById('display-disabled');
            if (warn) warn.style.display = 'block';
            return;
        }
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
    // Destroy any prior host to avoid stale broker entries
    if (host) { try { host.destroy(); } catch(e) {} host = null; }

    const code = shortCode();
    const peerId = codeToId(code);

    document.getElementById('display-code-area').style.display = '';
    document.getElementById('display-code-area').style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px';
    document.getElementById('display-my-code').textContent = formatCode(code);
    document.getElementById('display-pair-url').textContent = siteBaseUrl();
    document.getElementById('gen-code-btn').style.display = 'none';

    // Generate QR code
    const dir = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
    const url = `${location.origin}${dir}/tablet.html?id=${peerId}`;
    const qrEl = document.getElementById('display-qrcode');
    qrEl.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
        new QRCode(qrEl, { text: url, width: 140, height: 140, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.L });
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
    { angle: 0,   key: '12oclock', arrow: '12', name: '12 o\'clock' },
    { angle: 30,  key: '1oclock',  arrow: '1',  name: '1 o\'clock' },
    { angle: 60,  key: '2oclock',  arrow: '2',  name: '2 o\'clock' },
    { angle: 90,  key: '3oclock',  arrow: '3',  name: '3 o\'clock' },
    { angle: 120, key: '4oclock',  arrow: '4',  name: '4 o\'clock' },
    { angle: 150, key: '5oclock',  arrow: '5',  name: '5 o\'clock' },
    { angle: -1,  key: 'none',     arrow: '\u00D8', name: 'No Target' }
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

    if (phoneConnected) {
        // Hide questionnaire on display, show simple phone prompt
        ptEl.querySelectorAll('.pretest-group').forEach(g => g.style.display = 'none');
        document.getElementById('pt-go').style.display = 'none';
        document.getElementById('pretest-label').textContent = 'Almost ready';
        let prompt = document.getElementById('pretest-phone-prompt');
        if (!prompt) {
            prompt = document.createElement('div');
            prompt.id = 'pretest-phone-prompt';
            prompt.className = 'pretest-phone-prompt';
            prompt.textContent = 'Answer a few questions on your phone to begin';
            ptEl.appendChild(prompt);
        }
        prompt.style.display = '';
    } else {
        // Keyboard mode: show full questionnaire
        ptEl.querySelectorAll('.pretest-group').forEach(g => g.style.display = '');
        document.getElementById('pt-go').style.display = '';
        document.getElementById('pretest-label').textContent = 'Before we begin';
        const prompt = document.getElementById('pretest-phone-prompt');
        if (prompt) prompt.style.display = 'none';
        ptEl.querySelectorAll('.pretest-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById('pt-go').disabled = true;
    }

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

// ═══ Copy CSF Data (debug) ═══
window.copyCsfData = function() {
    if (!engine || !lastResultParams) { alert('No results yet.'); return; }
    const cpds = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 36];
    const lines = ['CPD\tLog Sensitivity\tSensitivity'];
    for (const f of cpds) {
        const logS = engine.evaluateCSF(f, lastResultParams);
        lines.push(`${f}\t${logS.toFixed(4)}\t${Math.pow(10, logS).toFixed(2)}`);
    }
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copy-csf-btn');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = orig, 2000);
    }).catch(() => {
        // Fallback: prompt with text
        prompt('Copy this data:', text);
    });
    console.log(text);
};

// ═══ Test ═══
let mode = null, engine = null, currentStim = null;
let testComplete = false, testStarted = false, inTutorial = false, inPreTest = false, lastInputTime = 0;
let lastResultParams = null;
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

    const angularDistance = mode.checkAnswer(value);
    try { engine.update(currentStim.stimIndex, angularDistance); } catch (e) { finish(); return; }
    updateProgress(engine.trialCount);
    tx({ type: 'progress', trial: engine.trialCount, maxTrials: MAX_TRIALS });
    if (engine.trialCount >= MAX_TRIALS) { finish(); return; }
    nextTrial();
}
window.handleInput = handleInput;

document.addEventListener('keydown', e => {
    if (testComplete) return;
    const k = e.key;
    if (k === '1') handleInput('12oclock');
    else if (k === '2') handleInput('1oclock');
    else if (k === '3') handleInput('2oclock');
    else if (k === '4') handleInput('3oclock');
    else if (k === '5') handleInput('4oclock');
    else if (k === '6') handleInput('5oclock');
    else if (k === '0' || k === ' ') handleInput('none');
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
    lastResultParams = result.params;

    showScreen('scr-results');
    const resultScreen = document.getElementById('scr-results');
    const resultContent = document.getElementById('result-content');
    resultScreen.classList.add('results-boost');
    if (isMirror) resultContent.classList.add('mirrored');
    else resultContent.classList.remove('mirrored');

    document.getElementById('final-auc').innerText = result.aulcsf.toFixed(1);
    document.getElementById('final-rank').innerText = result.rank;
    document.getElementById('final-detail').innerText = result.detail;

    let plotUrl = '';
    try { plotUrl = drawCSFPlot(document.getElementById('csf-plot'), engine, result.params); } catch (e) { console.error('Plot error:', e); }

    // Populate CSF formula card + Explorer CTA
    if (result.params) {
        const g = result.params.peakGain, fp = result.params.peakFreq;
        const b = result.params.bandwidth, d = result.params.truncation;
        const card = document.getElementById('csf-formula-card');
        card.style.display = '';
        document.getElementById('csf-formula-math').innerHTML =
            `log\u2081\u2080(S) = ${g.toFixed(2)} \u2212 ${b.toFixed(2)}\u00B7\u0394\u00B2 \u2212 ${d.toFixed(2)}\u00B7\u0394\u2074 &nbsp;<span style="color:var(--t3);font-size:.85em">[high-freq only]</span>`;
        document.getElementById('csf-formula-peak').textContent =
            `Peak: ${fp.toFixed(1)} cpd \u00A0\u00A0 \u0394 = log\u2081\u2080(f / ${fp.toFixed(1)})`;
        const explorerUrl = `${CSF_EXPLORER_URL}?g=${g.toFixed(2)}&f=${fp.toFixed(1)}&b=${b.toFixed(2)}&d=${d.toFixed(2)}`;
        document.getElementById('csf-formula-explore').href = explorerUrl;
        const copyBtn = document.getElementById('csf-formula-copy-btn');
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(explorerUrl).then(() => {
                const orig = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                copyBtn.style.borderColor = 'var(--a)';
                copyBtn.style.color = 'var(--a)';
                setTimeout(() => { copyBtn.textContent = orig; copyBtn.style.borderColor = ''; copyBtn.style.color = ''; }, 2000);
            }).catch(() => { prompt('Copy this link:', explorerUrl); });
        };
    }

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
        score: result.aulcsf.toFixed(1),
        rank: result.rank,
        detail: result.detail,
        snellen: snellenStr,
        peakSens: Math.round(Math.pow(10, result.params.peakGain)),
        peakFreq: result.params.peakFreq.toFixed(1),
        csfParams: result.params ? { g: result.params.peakGain, f: result.params.peakFreq, b: result.params.bandwidth, d: result.params.truncation } : null,
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
