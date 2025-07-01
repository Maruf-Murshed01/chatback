const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: [
          "http://localhost:5173", 
          "http://127.0.0.1:5173",
          "https://chatappn.netlify.app"
        ],
        methods: ["GET", "POST"]
      }
});

// Middleware
app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173", "https://chatappn.netlify.app"]
}));
app.use(express.json());

// API health check
app.get('/api/health', (req, res) => {
  res.json({ message: 'Chat server is running!' });
});

// Store connected users
let connectedUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle user joining
    socket.on('user-joined', (username) => {
        connectedUsers.set(socket.id, username);
        socket.broadcast.emit('user-connected', username);
        
        // Send updated list of connected users to ALL users (including the new one)
        const usersList = Array.from(connectedUsers.values());
        io.emit('users-list', usersList);
        
        console.log(`${username} joined the chat`);
    });

    // Handle sending group messages
    socket.on('send-message', (data) => {
        const username = connectedUsers.get(socket.id);
        if (username) {
            // Broadcast message to all users including sender
            io.emit('receive-message', {
                username: username,
                message: data.message,
                timestamp: new Date().toLocaleTimeString()
            });
        }
    });

    // Handle sending private messages
    socket.on('send-private-message', (data) => {
        const senderUsername = connectedUsers.get(socket.id);
        if (senderUsername) {
            const targetSocketId = Array.from(connectedUsers.entries())
                .find(([id, username]) => username === data.targetUsername)?.[0];
            
            const messageData = {
                username: senderUsername,
                targetUsername: data.targetUsername,
                message: data.message,
                timestamp: new Date().toLocaleTimeString()
            };
            
            // Send to target user
            if (targetSocketId) {
                io.to(targetSocketId).emit('receive-private-message', messageData);
            }
            
            // Send back to sender for confirmation
            socket.emit('receive-private-message', messageData);
        }
    });

    // Handle group typing indicator
    socket.on('typing', () => {
        const username = connectedUsers.get(socket.id);
        if (username) {
            socket.broadcast.emit('user-typing', username);
        }
    });

    socket.on('stop-typing', () => {
        const username = connectedUsers.get(socket.id);
        if (username) {
            socket.broadcast.emit('user-stop-typing', username);
        }
    });

    // Handle private typing indicators
    socket.on('private-typing', (data) => {
        const senderUsername = connectedUsers.get(socket.id);
        if (senderUsername) {
            const targetSocketId = Array.from(connectedUsers.entries())
                .find(([id, username]) => username === data.targetUsername)?.[0];
            
            if (targetSocketId) {
                io.to(targetSocketId).emit('private-user-typing', {
                    username: senderUsername
                });
            }
        }
    });

    socket.on('private-stop-typing', (data) => {
        const senderUsername = connectedUsers.get(socket.id);
        if (senderUsername) {
            const targetSocketId = Array.from(connectedUsers.entries())
                .find(([id, username]) => username === data.targetUsername)?.[0];
            
            if (targetSocketId) {
                io.to(targetSocketId).emit('private-user-stop-typing', {
                    username: senderUsername
                });
            }
        }
    });

    // Group Voice Chat Events
    socket.on('request-voice-call', (data) => {
        const callerUsername = connectedUsers.get(socket.id);
        if (callerUsername) {
            const targetSocketId = Array.from(connectedUsers.entries())
                .find(([id, username]) => username === data.targetUsername)?.[0];
            
            if (targetSocketId) {
                io.to(targetSocketId).emit('incoming-voice-call', {
                    callerUsername,
                    callerId: socket.id
                });
            }
        }
    });

    // Add group call support
    socket.on('request-group-voice-call', () => {
        const initiatorUsername = connectedUsers.get(socket.id);
        console.log('📡 Received request-group-voice-call from:', initiatorUsername);
        console.log('📡 Connected users:', Array.from(connectedUsers.values()));
        
        if (initiatorUsername) {
            // Get all other users
            const otherUsers = Array.from(connectedUsers.entries())
                .filter(([id, username]) => id !== socket.id);
            
            console.log('📢 Broadcasting group-call-available to:', otherUsers.map(([id, username]) => username));
            
            // Notify all other users that a group call is available
            socket.broadcast.emit('group-call-available', {
                initiatorUsername,
                initiatorId: socket.id
            });
            
            console.log(`${initiatorUsername} started a group call`);
        }
    });

    socket.on('join-group-voice-call', (data) => {
        const joinerUsername = connectedUsers.get(socket.id);
        console.log('📡 Received join-group-voice-call from:', joinerUsername);
        
        if (joinerUsername) {
            // Notify the initiator and other participants
            console.log('📢 Broadcasting user-joined-group-call to all users');
            io.emit('user-joined-group-call', {
                username: joinerUsername,
                userId: socket.id,
                initiatorId: data.initiatorId
            });
            
            console.log(`${joinerUsername} joined the group call`);
        }
    });

    // Private Voice Chat Events
    socket.on('request-private-voice-call', (data) => {
        const callerUsername = connectedUsers.get(socket.id);
        if (callerUsername) {
            const targetSocketId = Array.from(connectedUsers.entries())
                .find(([id, username]) => username === data.targetUsername)?.[0];
            
            if (targetSocketId) {
                io.to(targetSocketId).emit('incoming-voice-call', {
                    callerUsername,
                    callerId: socket.id,
                    isPrivate: true
                });
            }
        }
    });

    socket.on('accept-voice-call', (data) => {
        io.to(data.callerId).emit('voice-call-accepted', {
            accepterId: socket.id
        });
    });

    socket.on('reject-voice-call', (data) => {
        io.to(data.callerId).emit('voice-call-rejected');
    });

    socket.on('end-voice-call', (data) => {
        if (data.targetId) {
            io.to(data.targetId).emit('voice-call-ended');
        }
    });

    // WebRTC signaling events
    socket.on('webrtc-offer', (data) => {
        io.to(data.targetId).emit('webrtc-offer', {
            offer: data.offer,
            senderId: socket.id
        });
    });

    socket.on('webrtc-answer', (data) => {
        io.to(data.targetId).emit('webrtc-answer', {
            answer: data.answer,
            senderId: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        io.to(data.targetId).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            senderId: socket.id
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const username = connectedUsers.get(socket.id);
        if (username) {
            connectedUsers.delete(socket.id);
            socket.broadcast.emit('user-disconnected', username);
            
            // Send updated list to all remaining users
            const usersList = Array.from(connectedUsers.values());
            io.emit('users-list', usersList);
            
            console.log(`${username} left the chat`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Backend server ready for frontend connections');
}); 