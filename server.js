// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

// --- Налаштування Бази Даних ---
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the SQLite database.');
});
db.run('CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT)');

// --- Налаштування Express ---
app.use(express.static('public'));
app.use(express.json());

// --- API ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function (err) {
            if (err) return res.status(400).json({ error: 'Username already exists' });
            res.status(201).json({ message: 'User registered' });
        });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Invalid credentials' });
        if (await bcrypt.compare(password, user.password)) {
            res.status(200).json({ message: 'Login successful' });
        } else { res.status(400).json({ error: 'Invalid credentials' }); }
    });
});

// --- Логіка Гри (Socket.io) ---
const rooms = {
    'room1': { players: {}, spectators: {}, state: 'waiting', turn: null, turnTimer: null, scores: {}, grids: {} },
    'room2': { players: {}, spectators: {}, state: 'waiting', turn: null, turnTimer: null, scores: {}, grids: {} },
    'room3': { players: {}, spectators: {}, state: 'waiting', turn: null, turnTimer: null, scores: {}, grids: {} },
};
const activeSockets = new Map();
const SHIP_CONFIG = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

// Функція для оновлення онлайну
function broadcastOnlineCount() {
    io.emit('onlineCountUpdate', activeSockets.size);
}

// Функція для оновлення кількості спостерігачів
function broadcastSpectatorCount(roomId) {
    if (!rooms[roomId]) return;
    const count = Object.keys(rooms[roomId].spectators).length;
    io.to(roomId).emit('spectatorCountUpdate', count);
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    let currentRoom = null;

    socket.on('register_user', (username) => {
        if (!username) { 
            socket.emit('login_error', 'Invalid username provided.');
            socket.disconnect(); return;
        }
        
        // === ФІКС ФАНТОМНОГО ПІДКЛЮЧЕННЯ НА RENDER ===
        if (activeSockets.has(username)) {
            const oldSocketId = activeSockets.get(username);
            const oldSocket = io.sockets.sockets.get(oldSocketId);
            // Якщо старий сокет дійсно існує і це не поточний клієнт, відключаємо його примусово
            if (oldSocket && oldSocket.id !== socket.id) {
                console.log(`Killing phantom socket for ${username}`);
                oldSocket.disconnect(true);
            }
        }
        
        socket.username = username;
        activeSockets.set(username, socket.id);
        console.log(`User ${username} connected. Active users:`, [...activeSockets.keys()]);
        socket.emit('register_success');
        broadcastOnlineCount();
    });

    socket.on('getRooms', () => socket.emit('roomList', getRoomStatus()));

    socket.on('joinRoom', (roomId) => {
        const username = socket.username;
        if (!username) return socket.emit('error', 'Socket not registered.');
        if (!rooms[roomId]) return socket.emit('error', 'Room does not exist');

        const room = rooms[roomId];
        if (room.state !== 'waiting' || Object.keys(room.players).length >= 2) {
            return socket.emit('error', 'Room is not available');
        }

        const color = Object.keys(room.players).length === 0 ? 'blue' : 'red';
        room.players[socket.id] = { username, color, ready: false, board: null, ships: [] };
        currentRoom = roomId;
        socket.join(roomId);
        console.log(`${username} (${color}) joined ${roomId}`);

        socket.emit('joined', { roomId, color });
        io.to(roomId).emit('playerUpdate', room.players); 

        broadcastSpectatorCount(roomId); 

        if (Object.keys(room.players).length === 2) {
            room.scores = {};
            for (const socketId in room.players) { room.scores[socketId] = 0; }
            startGame(roomId); 
        }

        io.emit('roomList', getRoomStatus()); 
    });

    socket.on('joinSpectator', (roomId) => {
        const username = socket.username;
        if (!username) return socket.emit('error', 'Socket not registered.');
        if (!rooms[roomId]) return socket.emit('error', 'Room does not exist');

        const room = rooms[roomId];
        if (room.state !== 'playing' && room.state !== 'post-game') {
            return socket.emit('error', 'Game is not active for spectating');
        }

        room.spectators[socket.id] = { username };
        currentRoom = roomId;
        socket.join(roomId);
        console.log(`${username} started spectating ${roomId}`);

        const playersInfo = {};
        let playerBlue = null, playerRed = null;
        for(const [id, player] of Object.entries(room.players)) {
            const info = { id, username: player.username, color: player.color };
            playersInfo[id] = info;
            if(player.color === 'blue') playerBlue = info;
            if(player.color === 'red') playerRed = info;
        }

        const turnUsername = room.turn ? room.players[room.turn]?.username : 'N/A';

        socket.emit('spectatorState', {
            playerBlue: playerBlue,
            playerRed: playerRed,
            turn: turnUsername,
            grids: room.grids
        });

        broadcastSpectatorCount(roomId);
    });

    socket.on('sendEmoji', ({ targetPlayerId, emoji }) => {
        if (!currentRoom || !rooms[currentRoom] || !socket.username) return;
        if (rooms[currentRoom].players[targetPlayerId]) {
            io.to(targetPlayerId).emit('emojiReceived', {
                from: socket.username,
                emoji: emoji
            });
        }
    });

    socket.on('playerReady', () => {
        if (!currentRoom || !rooms[currentRoom] || !rooms[currentRoom].players[socket.id]) return;
        const room = rooms[currentRoom];
        room.players[socket.id].ready = true;

        const allReady = Object.values(room.players).every(p => p.ready);
        if (allReady) {
            room.state = 'playing';
            io.emit('roomList', getRoomStatus());
            const firstPlayerSocketId = Object.keys(room.players).find(id => room.players[id].color === 'blue');
            room.turn = firstPlayerSocketId;
            io.to(currentRoom).emit('allReady', room.players[firstPlayerSocketId].username);
            io.to(currentRoom).emit('nextTurn', room.players[firstPlayerSocketId].username);
            startTurnTimer(currentRoom);
        }
    });

    socket.on('makeMove', (coords) => {
        const room = rooms[currentRoom];
        if (!room || room.turn !== socket.id) return;
        if (room.turnTimer) clearTimeout(room.turnTimer);

        const opponentId = Object.keys(room.players).find(id => id !== socket.id);
        if (!opponentId) return; 
        const opponent = room.players[opponentId];
        const { x, y } = coords;
        let result = 'miss';
        let shipSunk = null;

        const opponentGridKey = opponent.color; 
        if (!room.grids[opponentGridKey]) room.grids[opponentGridKey] = createEmptyGrid();

        const hitShip = opponent.ships.find(ship => ship.positions.some(p => p.x === x && p.y === y && !p.hit));
        if (hitShip) {
            const pos = hitShip.positions.find(p => p.x === x && p.y === y);
            pos.hit = true;
            result = 'hit';
            if (hitShip.positions.every(p => p.hit)) {
                result = 'sunk';
                shipSunk = hitShip.positions;
            }
            room.grids[opponentGridKey][y][x] = 2; 
        } else {
            room.grids[opponentGridKey][y][x] = 1; 
        }

        io.to(currentRoom).emit('moveResult', { attackerId: socket.id, coords, result, shipSunk });

        if (opponent.ships.every(ship => ship.positions.every(p => p.hit))) {
            const winnerId = socket.id;
            room.scores[winnerId]++;
            io.to(currentRoom).emit('gameOver', { winner: room.players[winnerId].username, scores: room.scores, players: room.players });
            room.state = 'post-game';
            Object.values(room.players).forEach(p => p.ready = false);
            room.spectators = {}; 
            io.emit('roomList', getRoomStatus());
            return;
        }

        if (result === 'miss') {
            room.turn = opponentId;
            io.to(currentRoom).emit('nextTurn', room.players[opponentId].username);
            startTurnTimer(currentRoom);
        } else {
            io.to(currentRoom).emit('nextTurn', room.players[socket.id].username);
            startTurnTimer(currentRoom);
        }
    });

    socket.on('surrender', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        if (room.state !== 'playing') return;
        const opponentId = Object.keys(room.players).find(id => id !== socket.id);
        if (!opponentId) return;
        if (room.turnTimer) clearTimeout(room.turnTimer);
        room.scores[opponentId]++;
        io.to(currentRoom).emit('gameOver', { winner: room.players[opponentId].username, surrendered: true, scores: room.scores, players: room.players });
        room.state = 'post-game';
        Object.values(room.players).forEach(p => p.ready = false);
        room.spectators = {}; 
        io.emit('roomList', getRoomStatus());
    });

    socket.on('playAgain', () => {
        if (!currentRoom || !rooms[currentRoom] || !rooms[currentRoom].players[socket.id]) return;
        const room = rooms[currentRoom];
        if (room.state !== 'post-game') return;
        room.players[socket.id].ready = true;
        const opponentId = Object.keys(room.players).find(id => id !== socket.id);
        if (opponentId) io.to(opponentId).emit('opponentReady');
        const playersArray = Object.values(room.players);
        if (playersArray.length === 2 && playersArray.every(p => p.ready)) {
            startGame(currentRoom);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        let userWasActive = false;
        
        // Видаляємо юзера з активних сокетів ТІЛЬКИ якщо це його поточний сокет
        if (socket.username && activeSockets.get(socket.username) === socket.id) {
            activeSockets.delete(socket.username);
            userWasActive = true;
            console.log(`User ${socket.username} removed. Active users:`, [...activeSockets.keys()]);
        }

        if (currentRoom && rooms[currentRoom] && rooms[currentRoom].spectators[socket.id]) {
            delete rooms[currentRoom].spectators[socket.id];
            broadcastSpectatorCount(currentRoom);
        } 
        else if (currentRoom && rooms[currentRoom] && rooms[currentRoom].players[socket.id]) {
            const room = rooms[currentRoom];
            const oldState = room.state;
            const playerInfo = room.players[socket.id]; 
            delete room.players[socket.id]; 

            const remainingPlayers = Object.keys(room.players);

            if (oldState === 'playing' && remainingPlayers.length === 1) {
                 const winnerId = remainingPlayers[0];
                 if (!room.scores) room.scores = {};
                 if (!room.scores[winnerId]) room.scores[winnerId] = 0;
                 room.scores[winnerId]++;
                 const finalPlayersInfo = {...room.players};
                 if(playerInfo) finalPlayersInfo[socket.id] = playerInfo; 

                 io.to(currentRoom).emit('gameOver', {
                     winner: room.players[winnerId].username,
                     disconnected: true,
                     scores: room.scores,
                     players: finalPlayersInfo 
                 });
                 room.state = 'post-game';
                 room.players[winnerId].ready = false;
                 room.spectators = {};
            }
            else if (oldState === 'waiting' && remainingPlayers.length === 1) {
                 io.to(remainingPlayers[0]).emit('playerLeft');
                 room.state = 'waiting'; 
            }
            else if (remainingPlayers.length < 1) {
                resetRoom(currentRoom);
            }
            else if (oldState === 'post-game' && remainingPlayers.length === 1){
                 io.to(remainingPlayers[0]).emit('playerLeft');
            }

            io.emit('roomList', getRoomStatus()); 
        }

        if (userWasActive) {
            broadcastOnlineCount(); 
        }
    });
});


// --- ПОВНІ ФУНКЦІЇ ---

function getRoomStatus() {
    return Object.fromEntries(
        Object.entries(rooms).map(([id, room]) => [id, {
            playerCount: Object.keys(room.players).length,
            state: room.state
        }])
    );
}

function createEmptyGrid() {
    return Array(10).fill(null).map(() => Array(10).fill(0));
}

function startGame(roomId) {
    const room = rooms[roomId];
    if (!room || Object.keys(room.players).length < 2) return; 

    room.grids = {
        'blue': createEmptyGrid(),
        'red': createEmptyGrid()
    };

    for (const socketId in room.players) {
        const { board, ships } = generateRandomBoard();
        room.players[socketId].board = board;
        room.players[socketId].ships = ships;
        room.players[socketId].ready = false;
        io.to(socketId).emit('gameStart', { myBoard: board, color: room.players[socketId].color });
    }
}

function startTurnTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.turnTimer) clearTimeout(room.turnTimer);

    room.turnTimer = setTimeout(() => {
        if (room.state !== 'playing') return;
        const currentPlayerId = room.turn;
        if (!room.players[currentPlayerId]) return;

        const opponentId = Object.keys(room.players).find(id => id !== currentPlayerId);
        if (!opponentId) return; 

        io.to(roomId).emit('turnSkipped', { skippedPlayer: room.players[currentPlayerId].username });
        room.turn = opponentId;

        setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].state === 'playing') {
                io.to(roomId).emit('nextTurn', room.players[opponentId].username);
                startTurnTimer(roomId); 
            }
        }, 2000); 

    }, 30000); 
}

function resetRoom(roomId) {
    if (rooms[roomId]) {
        if (rooms[roomId].turnTimer) clearTimeout(rooms[roomId].turnTimer);
        rooms[roomId] = { players: {}, spectators: {}, state: 'waiting', turn: null, turnTimer: null, scores: {}, grids: {} };
        console.log(`Room ${roomId} has been reset.`);
        io.emit('roomList', getRoomStatus());
    }
}

function generateRandomBoard() {
    let board = Array(10).fill(null).map(() => Array(10).fill(0));
    let ships = [];
    let attempts = 0; 
    for (const size of SHIP_CONFIG) {
        let placed = false;
        let currentAttempts = 0;
        while (!placed && currentAttempts < 100) { 
            const o = Math.random() < 0.5;
            const x = Math.floor(Math.random() * 10);
            const y = Math.floor(Math.random() * 10);
            if (canPlaceShip(board, x, y, size, o)) {
                let shipPos = [];
                for (let i = 0; i < size; i++) {
                    const cX = o ? x + i : x;
                    const cY = o ? y : y + i;
                    board[cY][cX] = 1; 
                    shipPos.push({ x: cX, y: cY, hit: false });
                }
                ships.push({ size, positions: shipPos });
                markSurroundings(board, shipPos); 
                placed = true;
            }
            currentAttempts++;
            attempts++;
        }
         if (currentAttempts >= 100) {
            console.error("Failed to place a ship after 100 attempts. Board generation might fail.");
         }
    }
     if (attempts >= 1000) { 
        console.error("Failed to generate board after 1000 total attempts.");
     }
    return { board: board.map(r => r.map(c => (c === 1 ? 1 : 0))), ships };
}

function canPlaceShip(board, x, y, size, isHorizontal) {
    for (let i = 0; i < size; i++) {
        const cX = isHorizontal ? x + i : x;
        const cY = isHorizontal ? y : y + i;
        if (cX >= 10 || cY >= 10 || board[cY][cX] !== 0) return false;
    }
    return true; 
}

function markSurroundings(board, positions) {
    const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    positions.forEach(({x, y}) => {
        DIRS.forEach(([dx, dy]) => {
            const nX = x + dx, nY = y + dy;
            if (nX >= 0 && nX < 10 && nY >= 0 && nY < 10 && board[nY][nX] === 0) {
                board[nY][nX] = 2; 
            }
        });
    });
}

server.listen(PORT, () => console.log(`Server listening on *:${PORT}`));