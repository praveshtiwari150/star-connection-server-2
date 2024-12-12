import express, {Request, Response} from "express";
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
let count = 0;
const emailToSessionId: Map<string, Session> = new Map();
const sessionHosts = new Map<string, WebSocket>();
let peers: Map<string, Peer[]> = new Map();

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
        })
    })
});

function handleCreateMeeting(ws: WebSocket, message: any) {
    const { email } = message;
    const sessionId = uuid();
    emailToSessionId.set(email, { sessionId, meetingStarted: true });
    sessionHosts.set(sessionId, ws);
    console.log("Meeting created, Session ID: ", sessionId);
    ws.send(JSON.stringify({ type: 'meeting-created', email, sessionId }));
}


function handleJoinMeeting(ws: WebSocket, message: any) {
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
    const peerId = uuid();
    console.log("peerId created ", peerId);
    peersList.push({ peerId, peerName, ws, status: 'pending' });
    peers.set(sessionId, peersList);
    console.log(peers);
    sessionHosts.get(sessionId)?.send(JSON.stringify({ type: 'join-request',peerId, peerName }));
}

function notifyParticipantandUpdateStatus(ws: WebSocket, message: any) {
    const { peerId, sessionId, sdp } = message;
    console.log("------------------------------------------participant-added---------------------")
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
    
    console.log("--------------------------------------------participant-added-ends-----------------")
}

function notifyParticipantandRemovePeer(ws: WebSocket, message: any) {
    const { peerId, sessionId } = message;
    
    const peerList = peers.get(sessionId);
        if (peerList) {
            const peer = peerList?.find(p => p.peerId === peerId);
            const updatedPeersList = peerList?.filter(p => p.peerId !== peerId);
            peers.set(sessionId, updatedPeersList);
            console.log(`Host has not allowed ${peer?.peerName} to ${sessionId}: `)
            peer?.ws.send(JSON.stringify({ type: 'participant-rejected' }));
        }
    
}

function sendOfferToParticipant(ws: WebSocket, message: any) {
    const {type, sessionId, peerId, sdp } = message;
    const peerList = peers.get(sessionId);

    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId);
        peer?.ws.send(JSON.stringify({ type, peerId, sdp }));
    }
}

function shareIceCandidate(ws: WebSocket, message: any) {
    const { type, candidate, sessionId, peerId } = message;

    console.log("-----------------------------sharing-icecandidate--------------------------")
    if (ws === sessionHosts.get(sessionId)) {
        const peerList = peers.get(sessionId);
        if (peerList) {
            console.log("Host sent the ice-candidate to the peer")
            const peer = peerList.find(p => p.peerId === peerId);
            peer?.ws.send(JSON.stringify({ type, candidate, peerId }));
        }
    }

    else {
        console.log("Peer sent ice-candidate to the host");
        const host = sessionHosts.get(sessionId);
        host?.send(JSON.stringify({type:'ice-candidate', candidate, peerId}))
    }

    console.log("------------------------ice-candidate-------------------------")

}

function sendAnswer(ws: WebSocket, message: any) {
    const { type, peerId, sessionId, sdp } = message;
    const peerList = peers.get(sessionId);

    if (peerList) {
        const peer = peerList.find(p => p.peerId === peerId);

        if (ws === peer?.ws) {
            console.log(`${peer.peerName} is sending answer to host`)
            const host = sessionHosts.get(sessionId);
            host?.send(JSON.stringify({ type, peerId, sessionId, sdp }));
        }
    }
}