/**
 * BurkeCSF — PeerJS Sync
 * =======================
 * Host creates a peer, waits for connections.
 * Client connects to a host peer ID.
 * Both sides get send/receive through the same API.
 */

export function createHost(laneID, onConnect, onData, onDisconnect, onReady) {
    let conn = null;
    let activePeer = null;
    let retries = 0;

    function tryCreate(id) {
        const peer = new Peer(id, {
            debug: 1,
            config: { iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]}
        });
        activePeer = peer;
        peer.on('open', actualId => {
            console.log('[Host] Registered as:', actualId);
            if (onReady) onReady(actualId);
        });
        peer.on('connection', c => {
            c.on('open', () => { conn = c; if (onConnect) onConnect(); });
            c.on('data', d => { if (onData) onData(d); });
            c.on('close', () => { conn = null; if (onDisconnect) onDisconnect(); });
            c.on('error', e => console.warn('[Host] conn err:', e));
        });
        peer.on('error', e => {
            console.warn('[Host] peer err:', e.type);
            // If ID is taken, retry with a new random one
            if (e.type === 'unavailable-id' && retries < 3) {
                retries++;
                peer.destroy();
                const newId = 'CSF-' + Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b=>b.toString(16).padStart(2,'0')).join('');
                console.log('[Host] Retrying with:', newId);
                tryCreate(newId);
            }
        });
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    }

    tryCreate(laneID);

    return {
        get id() { return activePeer ? activePeer.id : null; },
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { if (conn) conn.close(); if (activePeer) activePeer.destroy(); },
        get peer() { return activePeer; }
    };
}

export function createClient(targetID, onOpen, onData, onClose, onError) {
    const peer = new Peer(undefined, {
        debug: 1,
        config: { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]}
    });
    let conn = null;
    peer.on('open', () => {
        conn = peer.connect(targetID, { reliable: true });
        conn.on('open', () => { if (onOpen) onOpen(); });
        conn.on('data', d => { if (onData) onData(d); });
        conn.on('close', () => { conn = null; if (onClose) onClose(); });
        conn.on('error', e => { if (onError) onError(e); });
    });
    peer.on('error', e => { if (onError) onError(e); });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { if (conn) conn.close(); peer.destroy(); },
        peer
    };
}
