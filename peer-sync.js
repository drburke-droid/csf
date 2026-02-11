/**
 * BurkeCSF — PeerJS Sync (Safari-hardened)
 * - Auto-assigned IDs (no collisions)
 * - Multiple STUN servers for iOS Safari compat
 * - Cache-bust: unique peer ID prefix to avoid Safari WebRTC cache
 */

const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
];

// Safari sometimes caches WebRTC peer IDs. Using a prefix with timestamp avoids stale broker entries.
function safariId() {
    return 'csf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function createHost(onReady, onConnect, onData, onDisconnect) {
    let conn = null;
    const id = safariId();
    const peer = new Peer(id, { debug: 0, config: { iceServers: ICE } });
    peer.on('open', actualId => { console.log('[Host]', actualId); if (onReady) onReady(actualId); });
    peer.on('connection', c => {
        c.on('open', () => { conn = c; if (onConnect) onConnect(); });
        c.on('data', d => { if (onData) onData(d); });
        c.on('close', () => { conn = null; if (onDisconnect) onDisconnect(); });
        c.on('error', e => console.warn('[Host] conn err:', e));
    });
    peer.on('error', e => {
        console.warn('[Host] peer err:', e.type);
        // If unavailable-id (very unlikely with timestamp), retry once
        if (e.type === 'unavailable-id') {
            peer.destroy();
            const retry = new Peer(safariId(), { debug: 0, config: { iceServers: ICE } });
            retry.on('open', id2 => { if (onReady) onReady(id2); });
            retry.on('connection', c => {
                c.on('open', () => { conn = c; if (onConnect) onConnect(); });
                c.on('data', d => { if (onData) onData(d); });
                c.on('close', () => { conn = null; if (onDisconnect) onDisconnect(); });
            });
        }
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
        get id() { return peer.id; },
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { try { if (conn) conn.close(); peer.destroy(); } catch(e) {} },
        peer
    };
}

export function createClient(targetID, onOpen, onData, onClose, onError) {
    let conn = null;
    const peer = new Peer(safariId(), { debug: 0, config: { iceServers: ICE } });
    peer.on('open', () => {
        console.log('[Client] open, connecting to', targetID);
        conn = peer.connect(targetID, { reliable: true, serialization: 'json' });
        conn.on('open', () => { console.log('[Client] connected'); if (onOpen) onOpen(); });
        conn.on('data', d => { if (onData) onData(d); });
        conn.on('close', () => { conn = null; if (onClose) onClose(); });
        conn.on('error', e => { console.warn('[Client] conn err:', e); if (onError) onError(e); });
    });
    peer.on('error', e => { console.warn('[Client] peer err:', e.type); if (onError) onError(e); });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { try { if (conn) conn.close(); peer.destroy(); } catch(e) {} },
        peer
    };
}
