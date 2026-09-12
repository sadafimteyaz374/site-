// Signaling server for SitePulse AI's "Meet" feature.
// It never sees or touches audio itself — it only relays WebRTC
// offers/answers/ICE candidates so participants' browsers can connect
// directly to each other (mesh topology), and relays the final
// meeting summary once one participant ends the meeting.

import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// roomId -> Set<socket.id>
const rooms = new Map();

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ roomId, displayName }) => {
    currentRoom = roomId;
    socket.data.displayName = displayName || 'Guest';
    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const peers = rooms.get(roomId);

    // Tell the newcomer who is already in the room, so THEY initiate
    // the WebRTC offer to each existing peer.
    const existingUsers = Array.from(peers).map((id) => ({
      id,
      displayName: io.sockets.sockets.get(id)?.data.displayName || 'Guest',
    }));
    socket.emit('existing-users', existingUsers);

    peers.add(socket.id);

    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      displayName: socket.data.displayName,
    });
  });

  // Relay WebRTC signaling data (offer / answer / ICE candidate) to a
  // specific peer by socket id.
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Broadcast the final transcript + AI summary to everyone in the room
  // once one participant ends the meeting.
  socket.on('meeting-ended', ({ roomId, summary }) => {
    io.to(roomId).emit('meeting-ended', { summary });
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(socket.id);
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
      socket.to(currentRoom).emit('user-left', { id: socket.id });
    }
  });
});

const PORT = process.env.SIGNALING_PORT || 4000;
server.listen(PORT, () => {
  console.log(`SitePulse Meet signaling server running on http://localhost:${PORT}`);
});
