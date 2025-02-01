"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const uuid_1 = require("uuid");
const ws_1 = require("ws");
dotenv_1.default.config();
const PORT = process.env.PORT;
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: process.env.CLIENT_URL
}));
app.get('/', (req, res) => {
    res.send('Hello from the server');
});
const server = app.listen(PORT, () => {
    console.log(`App is listening on port ${PORT}`);
});
const wss = new ws_1.WebSocketServer({ server });
const emailToSessionId = new Map();
const sessionHosts = new Map();
let peers = new Map();
wss.on('connection', (ws) => {
    ws.on('error', (err) => console.log(err));
    ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        switch (message.type) {
            case 'create-meeting':
                handleCreateMeeting(ws, message);
                break;
            case 'join-meeting':
                handleJoinMeeting(ws, message);
                break;
            case 'participant-added':
                notifyParticipantandUpdateStatus(ws, message);
                break;
            case 'participant-rejected':
                notifyParticipantandRemovePeer(ws, message);
                break;
            case 'ice-candidate':
                shareIceCandidate(ws, message);
                break;
            case 'offer':
                sendOffer(ws, message);
                break;
            case 'answer':
                sendAnswer(ws, message);
                break;
            case 'live-chat':
                handleChat(ws, message);
                break;
            case 'stop-screen-stream':
                stopScreenShare(ws, message);
                break;
            case 'close-connection':
                handleSocketConnection(ws, message);
        }
    });
    ws.on('close', () => {
        peers.forEach((peerList, sessionId) => {
            const updatedPeers = peerList.filter(p => p.ws !== ws);
            if (updatedPeers.length) {
                peers.set(sessionId, updatedPeers);
            }
            else {
                peers.delete(sessionId);
            }
        });
    });
});
function handleCreateMeeting(ws, message) {
    const { email } = message;
    const sessionId = (0, uuid_1.v4)();
    emailToSessionId.set(email, { sessionId, meetingStarted: true });
    sessionHosts.set(sessionId, ws);
    ws.send(JSON.stringify({ type: 'meeting-created', email, sessionId }));
}
function handleJoinMeeting(ws, message) {
    var _a;
    const { peerName, sessionId } = message;
    const session = Array.from(emailToSessionId.values())
        .find(s => s.sessionId === sessionId);
    if (!session) {
        console.log("Invalid session ID");
        ws.send(JSON.stringify({ type: 'invalid-sessionid' }));
        return;
    }
    if (!session.meetingStarted) {
        ws.send(JSON.stringify({ type: 'meeting-not-started' }));
        return;
    }
    let peersList = peers.get(sessionId) || [];
    const peerId = (0, uuid_1.v4)();
    peersList.push({ peerId, peerName, ws, status: 'pending' });
    peers.set(sessionId, peersList);
    (_a = sessionHosts.get(sessionId)) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify({ type: 'join-request', peerId, peerName }));
}
function notifyParticipantandUpdateStatus(ws, message) {
    const { peerId, sessionId, sdp } = message;
    const peersList = peers.get(sessionId);
    if (peersList) {
        const peer = peersList.find(p => p.peerId === peerId);
        if (peer) {
            peer.status = 'accepted';
            peer.ws.send(JSON.stringify({ type: 'participant-added', peerId, sdp }));
        }
    }
}
function notifyParticipantandRemovePeer(ws, message) {
    const { peerId, sessionId } = message;
    const peerList = peers.get(sessionId);
    if (peerList) {
        const peer = peerList === null || peerList === void 0 ? void 0 : peerList.find(p => p.peerId === peerId);
        const updatedPeersList = peerList === null || peerList === void 0 ? void 0 : peerList.filter(p => p.peerId !== peerId);
        peers.set(sessionId, updatedPeersList);
        peer === null || peer === void 0 ? void 0 : peer.ws.send(JSON.stringify({ type: 'participant-rejected' }));
    }
}
function shareIceCandidate(ws, message) {
    const { type, candidate, sessionId, peerId } = message;
    if (ws === sessionHosts.get(sessionId)) {
        const peerList = peers.get(sessionId);
        if (peerList) {
            const peer = peerList.find(p => p.peerId === peerId);
            peer === null || peer === void 0 ? void 0 : peer.ws.send(JSON.stringify({ type, candidate, peerId }));
        }
    }
    else {
        const host = sessionHosts.get(sessionId);
        host === null || host === void 0 ? void 0 : host.send(JSON.stringify({ type: 'ice-candidate', candidate, peerId }));
    }
}
function sendOffer(ws, message) {
    const { type, peerId, sessionId, sdp } = message;
    const peerList = peers.get(sessionId);
    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId);
        if (peer) {
            peer.ws.send(JSON.stringify({
                type: type,
                peerId: peerId,
                sdp: sdp,
            }));
        }
    }
}
function sendAnswer(ws, message) {
    const { type, peerId, sessionId, sdp } = message;
    const peerList = peers.get(sessionId);
    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId);
        if (ws === (peer === null || peer === void 0 ? void 0 : peer.ws)) {
            const host = sessionHosts.get(sessionId);
            host === null || host === void 0 ? void 0 : host.send(JSON.stringify({ type, peerId, sessionId, sdp }));
            if (!host) {
                console.log('Host socket not found');
            }
        }
    }
}
function handleChat(ws, message) {
    const { type, text, sessionId, name, peerId, timestamp } = message;
    console.log(message);
    const host = sessionHosts.get(sessionId);
    host === null || host === void 0 ? void 0 : host.send(JSON.stringify({
        type,
        text,
        name,
        timestamp,
        peerId,
        sessionId
    }));
    const peerList = peers.get(sessionId);
    peerList === null || peerList === void 0 ? void 0 : peerList.forEach(peer => {
        peer.ws.send(JSON.stringify({
            type,
            text,
            name,
            peerId,
            sessionId,
            timestamp
        }));
    });
}
function stopScreenShare(ws, message) {
    const { type, trackId, sessionId } = message;
    const peerList = peers.get(sessionId);
    if (!peerList)
        return;
    peerList.forEach(peer => {
        peer.ws.send(JSON.stringify({
            type,
            trackId,
            sessionId
        }));
    });
}
function handleSocketConnection(ws, message) {
    if (message.from === 'peer') {
        const { type, peerId, sessionId } = message;
        let peerList = peers.get(sessionId);
        if (!peerList)
            return;
        const peer = peerList === null || peerList === void 0 ? void 0 : peerList.find(p => p.peerId === peerId);
        peer === null || peer === void 0 ? void 0 : peer.ws.close();
        peerList = peerList.filter(peer => peer.peerId !== peerId);
        if (peerList.length > 0) {
            peers.set(sessionId, peerList);
        }
        else {
            peers.delete(sessionId);
        }
        const host = sessionHosts.get(sessionId);
        host === null || host === void 0 ? void 0 : host.send(JSON.stringify({
            type,
            peerId,
            sessionId
        }));
    }
    if (message.from === 'host') {
        const { sessionId } = message;
        const peerList = peers.get(sessionId);
        peerList === null || peerList === void 0 ? void 0 : peerList.forEach(peer => {
            const { type, peerId, sessionId } = message;
            peer.ws.send(JSON.stringify({
                type,
                peerId,
                sessionId
            }));
            peer.ws.close();
        });
        peers.delete(sessionId);
        const host = sessionHosts.get(sessionId);
        host === null || host === void 0 ? void 0 : host.close();
        sessionHosts.delete(sessionId);
    }
}
//# sourceMappingURL=index.js.map