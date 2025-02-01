import express, { Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { v4 as uuid } from 'uuid';
import { WebSocket, WebSocketServer } from "ws";
dotenv.config()
const PORT = process.env.PORT

interface Peer {
    peerId: string;
    peerName: string;
    ws: WebSocket
    status: 'accepted' | 'rejected' | 'pending';
}

interface Session {
    sessionId: string;
    meetingStarted: boolean;
}

const app = express();


app.use(express.json());
app.use(cors({
    origin: process.env.CLIENT_URL
}));

app.get('/', (req: Request, res: Response) => {
    res.send('Hello from the server');
})

const server = app.listen(PORT, () => {
    console.log(`App is listening on port ${PORT}`);
});

const wss = new WebSocketServer({ server });
const emailToSessionId: Map<string, Session> = new Map();
const sessionHosts = new Map<string, WebSocket>();
let peers: Map<string, Peer[]> = new Map();

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
        })
    })
});

function handleCreateMeeting(ws: WebSocket, message: any) {
    const { email } = message;
    const sessionId = uuid();
    emailToSessionId.set(email, { sessionId, meetingStarted: true });
    sessionHosts.set(sessionId, ws);
    ws.send(JSON.stringify({ type: 'meeting-created', email, sessionId }));
}


function handleJoinMeeting(ws: WebSocket, message: any) {
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
    const peerId = uuid();
    peersList.push({ peerId, peerName, ws, status: 'pending' });
    peers.set(sessionId, peersList);
    sessionHosts.get(sessionId)?.send(JSON.stringify({ type: 'join-request', peerId, peerName }));
}

function notifyParticipantandUpdateStatus(ws: WebSocket, message: any) {
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

function notifyParticipantandRemovePeer(ws: WebSocket, message: any) {
    const { peerId, sessionId } = message;

    const peerList = peers.get(sessionId);
    if (peerList) {
        const peer = peerList?.find(p => p.peerId === peerId);
        const updatedPeersList = peerList?.filter(p => p.peerId !== peerId);
        peers.set(sessionId, updatedPeersList);
        peer?.ws.send(JSON.stringify({ type: 'participant-rejected' }));
    }

}

function shareIceCandidate(ws: WebSocket, message: any) {
    const { type, candidate, sessionId, peerId } = message;

    if (ws === sessionHosts.get(sessionId)) {
        const peerList = peers.get(sessionId);
        if (peerList) {
            const peer = peerList.find(p => p.peerId === peerId);
            peer?.ws.send(JSON.stringify({ type, candidate, peerId }));
        }
    }

    else {
        const host = sessionHosts.get(sessionId);
        host?.send(JSON.stringify({ type: 'ice-candidate', candidate, peerId }))
    }
}

function sendOffer(ws: WebSocket, message: any) {
    const { type, peerId, sessionId, sdp } = message
    const peerList = peers.get(sessionId);

    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId)
        if (peer) {
            peer.ws.send(JSON.stringify({
                type: type,
                peerId: peerId,
                sdp: sdp,
            }));
        }
    }
}

function sendAnswer(ws: WebSocket, message: any) {
    const { type, peerId, sessionId, sdp } = message;
    const peerList = peers.get(sessionId);

    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId);
        if (ws === peer?.ws) {
            const host = sessionHosts.get(sessionId);
            host?.send(JSON.stringify({ type, peerId, sessionId, sdp }));
            if (!host) {
                console.log('Host socket not found');
            }
        }
    }
}


function handleChat(ws: WebSocket, message: any) {
    const { type, text, sessionId, name, peerId, timestamp } = message;
    console.log(message);

    const host = sessionHosts.get(sessionId);
    host?.send(JSON.stringify({
        type,
        text,
        name,
        timestamp,
        peerId,
        sessionId
    }));

    const peerList = peers.get(sessionId);
    peerList?.forEach(peer => {
        peer.ws.send(JSON.stringify({
            type,
            text,
            name,
            peerId,
            sessionId,
            timestamp
        }))
    })
}

function stopScreenShare(ws: WebSocket, message: any) {
    const { type, trackId, sessionId } = message;
    const peerList = peers.get(sessionId);

    if (!peerList) return;

    peerList.forEach(peer => {
        peer.ws.send(JSON.stringify({
            type,
            trackId,
            sessionId
        }))
    })
}

function handleSocketConnection(ws: WebSocket, message: any) {
    if (message.from === 'peer') {
        const { type, peerId, sessionId } = message;
        let peerList = peers.get(sessionId);

        if (!peerList) return;
        const peer = peerList?.find(p => p.peerId === peerId);
        peer?.ws.close();
        peerList = peerList.filter(peer => peer.peerId !== peerId);
        if (peerList.length > 0) {
            peers.set(sessionId, peerList);
        }
        else {
            peers.delete(sessionId);
        }
        const host = sessionHosts.get(sessionId);
        host?.send(JSON.stringify({
            type,
            peerId,
            sessionId
        }));
    }

    if (message.from === 'host') {
        const { sessionId } = message;
        const peerList = peers.get(sessionId);

        peerList?.forEach(peer => {
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
        host?.close();
        sessionHosts.delete(sessionId);
    }
}