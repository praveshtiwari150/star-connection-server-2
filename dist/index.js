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
let count = 0;
const emailToSessionId = new Map();
const sessionHosts = new Map();
let peers = new Map();
wss.on('connection', (ws) => {
    ws.on('error', console.error);
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
            case 'answer':
                sendAnswer(ws, message);
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
    console.log("Meeting created, Session ID: ", sessionId);
    ws.send(JSON.stringify({ type: 'meeting-created', email, sessionId }));
}
function handleJoinMeeting(ws, message) {
    var _a;
    const { peerName, sessionId } = message;
    console.log(`Peer ${peerName} made request to join session ${sessionId}`);
    const session = Array.from(emailToSessionId.values())
        .find(s => s.sessionId === sessionId);
    console.log(session);
    if (!session) {
        console.log("Invalid session ID");
        ws.send(JSON.stringify({ type: 'invalid-sessionid' }));
        return;
    }
    if (!session.meetingStarted) {
        console.log("Meeting has not started yet");
        ws.send(JSON.stringify({ type: 'meeting-not-started' }));
        return;
    }
    let peersList = peers.get(sessionId) || [];
    const peerId = (0, uuid_1.v4)();
    console.log("peerId created ", peerId);
    peersList.push({ peerId, peerName, ws, status: 'pending' });
    peers.set(sessionId, peersList);
    console.log(peers);
    (_a = sessionHosts.get(sessionId)) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify({ type: 'join-request', peerId, peerName }));
}
function notifyParticipantandUpdateStatus(ws, message) {
    const { peerId, sessionId, sdp } = message;
    console.log("------------------------------------------participant-added---------------------");
    const peersList = peers.get(sessionId);
    if (peersList) {
        const peer = peersList.find(p => p.peerId === peerId);
        if (peer) {
            peer.status = 'accepted';
            console.log(`Peer ${peer.peerName} has been accepted into session ${sessionId}`);
            // console.log(peers); //only for debugging
            peer.ws.send(JSON.stringify({ type: 'participant-added', peerId, sdp }));
            console.log("Informed participant that the request has been accepted");
        }
    }
    console.log("--------------------------------------------participant-added-ends-----------------");
}
function notifyParticipantandRemovePeer(ws, message) {
    const { peerId, sessionId } = message;
    const peerList = peers.get(sessionId);
    if (peerList) {
        const peer = peerList === null || peerList === void 0 ? void 0 : peerList.find(p => p.peerId === peerId);
        const updatedPeersList = peerList === null || peerList === void 0 ? void 0 : peerList.filter(p => p.peerId !== peerId);
        peers.set(sessionId, updatedPeersList);
        console.log(`Host has not allowed ${peer === null || peer === void 0 ? void 0 : peer.peerName} to ${sessionId}: `);
        peer === null || peer === void 0 ? void 0 : peer.ws.send(JSON.stringify({ type: 'participant-rejected' }));
    }
}
function sendOfferToParticipant(ws, message) {
    const { type, sessionId, peerId, sdp } = message;
    const peerList = peers.get(sessionId);
    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId);
        peer === null || peer === void 0 ? void 0 : peer.ws.send(JSON.stringify({ type, peerId, sdp }));
    }
}
function shareIceCandidate(ws, message) {
    const { type, candidate, sessionId, peerId } = message;
    console.log("-----------------------------sharing-icecandidate--------------------------");
    if (ws === sessionHosts.get(sessionId)) {
        const peerList = peers.get(sessionId);
        if (peerList) {
            console.log("Host sent the ice-candidate to the peer");
            const peer = peerList.find(p => p.peerId === peerId);
            peer === null || peer === void 0 ? void 0 : peer.ws.send(JSON.stringify({ type, candidate, peerId }));
        }
    }
    else {
        console.log("Peer sent ice-candidate to the host");
        const host = sessionHosts.get(sessionId);
        host === null || host === void 0 ? void 0 : host.send(JSON.stringify({ type: 'ice-candidate', candidate, peerId }));
    }
    console.log("------------------------ice-candidate-------------------------");
}
function sendAnswer(ws, message) {
    const { type, peerId, sessionId, sdp } = message;
    const peerList = peers.get(sessionId);
    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId);
        if (ws === (peer === null || peer === void 0 ? void 0 : peer.ws)) {
            console.log(`${peer.peerName} is sending answer to host`);
            const host = sessionHosts.get(sessionId);
            host === null || host === void 0 ? void 0 : host.send(JSON.stringify({ type, peerId, sessionId, sdp }));
        }
    }
}
//# sourceMappingURL=index.js.map