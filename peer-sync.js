/**
 * BurkeCSF — PeerJS Sync
 * =======================
 * Host creates a peer, waits for connections.
 * Client connects to a host peer ID.
 * Both sides get send/receive through the same API.
 */

export function createHost(laneID, onConnect, onData, onDisconnect) {
    const peer = new Peer(laneID, {
        debug: 1,
        config: { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]}
    });
    let conn = null;
    peer.on('open', () => {});
    peer.on('connection', c => {
        c.on('open', () => { conn = c; if (onConnect) onConnect(); });
        c.on('data', d => { if (onData) onData(d); });
        c.on('close', () => { conn = null; if (onDisconnect) onDisconnect(); });
        c.on('error', e => console.warn('[Host] conn err:', e));
    });
    peer.on('error', e => console.warn('[Host] peer err:', e.type));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    return {
        get id() { return peer.id; },
        get connected() { return conn && conn.open; },
        send(msg) { if (conn && conn.open) conn.send(msg); },
        destroy() { if (conn) conn.close(); peer.destroy(); },
        peer
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
