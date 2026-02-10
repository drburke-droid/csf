 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/app.js b/app.js
index a06408683bf5a898e15b9a684ed90380d0943cb6..a5bf2e896f01df0c707e4de4427af3387f7029ce 100644
--- a/app.js
+++ b/app.js
@@ -4,113 +4,129 @@
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
-    if (typeof Peer === 'undefined') return;
+    if (typeof Peer === 'undefined') return false;
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
+    return true;
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
 
-initPeer();
+if (!initPeer()) {
+    let attempts = 0;
+    const maxAttempts = 20;
+    const retryTimer = setInterval(() => {
+        attempts++;
+        if (initPeer()) {
+            clearInterval(retryTimer);
+            return;
+        }
+        if (attempts >= maxAttempts) {
+            clearInterval(retryTimer);
+            document.getElementById('qr-debug').textContent = 'PeerJS failed to load. Refresh to retry.';
+            console.warn('[App] PeerJS was not available after retries.');
+        }
+    }, 500);
+}
 
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
 
EOF
)