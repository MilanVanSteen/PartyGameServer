const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createRoom, joinRoom, leaveRoom, setPlayerName, isValidName, getRoomPlayers, rooms } = require("./rooms/roommanager");

const hosts = {};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {cors: {origin: "*"}});

io.on("connection", (socket) => {
    console.log("Client joined with id:", socket.id);

    // UNITY token check
    if (socket.handshake.query.token === "UNITY") {
        console.log("🎮 Unity client connected:", socket.id);
    }

    // CREATE_ROOM
    socket.on("CREATE_ROOM", () => {
        const roomCode = createRoom(socket.id);
        socket.join(roomCode);

        hosts[roomCode] = socket.id;

        socket.roomCode = roomCode;
        
        socket.emit("ROOM_CREATED", { roomCode });
        console.log(`Room ${roomCode} created by ${socket.id}`);
    });

    // JOIN_ROOM
    socket.on("JOIN_ROOM", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit("ERROR", { message: "Room does not exist" });
            return;
        }

        if (room.started) {
            socket.emit("ERROR", { message: "Game has already started" });
            return;
        }
        
        const success = joinRoom(roomCode, socket.id);
        if (!success) {
            socket.emit("ERROR", { message: "Failed to join room" });
            return;
        }
        
        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("ROOM_JOINED", { roomCode, players: getRoomPlayers(roomCode)});
    });

    // SET_NAME
    socket.on("SET_NAME", ({ playerName }) => {
        const roomCode = socket.roomCode;
        if (!roomCode) {socket.emit("NAME_ERROR", { message: "Not in a room" }); return;}

        const error = isValidName(roomCode, playerName);
        if (error) {socket.emit("NAME_ERROR", { message: error }); return;}

        setPlayerName(roomCode, socket.id, playerName.trim());
        
        io.to(roomCode).emit("PLAYER_JOINED", {players: getRoomPlayers(roomCode)});
    });

    // HOST starts game
    socket.on("START_GAME", () => {
        console.log("START_GAME received from:", socket.id);

        const roomCode = socket.roomCode;
        console.log("Room code on server:", roomCode);

        if (!roomCode) 
        {
            socket.emit("ERROR", { message: "Not in a room" });
            return;
        }
        
        if (hosts[roomCode] !== socket.id) {
            socket.emit("ERROR", { message: "Only the host can start the game" });
            return;
        }

        rooms[roomCode].started = true;
        
        io.to(roomCode).emit("GAME_STARTED", { players: getRoomPlayers(roomCode) });

        console.log(`Game started in room ${roomCode} by host ${socket.id}`);
    });

    // HOST triggers dice roll for a player
    socket.on("ROLL_DICE", () => {
        const roomCode = socket.roomCode;
        console.log("ROLL_DICE triggered by", socket.id, "in room", roomCode);

        if (!roomCode) return;

        if (hosts[roomCode] !== socket.id) {
            socket.emit("ERROR", { message: "Only host can roll dice" });
            return;
        }

        const players = getRoomPlayers(roomCode);
        console.log("Players in room:", players.map(p => p.id));

        // Generate random rolls for each player
        players.forEach(player => {
            const roll = Math.floor(Math.random() * 6) + 1;
            console.log(`Rolling dice for player ${player.id}: ${roll}`);

            // Send each player only their roll
            io.to(player.id).emit("DICE_ROLL_START", { roll });

            // count host automatically
            if (player.id === socket.id) {
                if (!diceDone[roomCode]) diceDone[roomCode] = [];
                diceDone[roomCode].push({ playerId: player.id, roll });
                console.log(`Host auto-complete roll: ${roll}`);
            }
        });
    });

    const diceDone = {};
    socket.on("DICE_ROLL_FINISHED", ({ playerId, roll }) => {
        const roomCode = socket.roomCode;
        console.log("DICE_ROLL_FINISHED received from", playerId, "roll:", roll, "room:", roomCode);

        if (!roomCode) return;

        if (!diceDone[roomCode]) diceDone[roomCode] = [];
        diceDone[roomCode].push({ playerId, roll });

        const players = getRoomPlayers(roomCode);
        console.log(`Dice finished so far: ${diceDone[roomCode].length}/${players.length}`);

        if (diceDone[roomCode].length === players.length) {
            // All dice finished, send moves to host
            console.log("All dice finished, sending PLAYER_MOVE to host", hosts[roomCode]);
            const hostId = hosts[roomCode];
            if (hostId) {
                io.to(hostId).emit("PLAYER_MOVE", { moves: diceDone[roomCode] });
            }

            // Clear for next roll
            diceDone[roomCode] = [];
        }
    });

    // Disconnect (Clear rooms)
    socket.on("disconnecting", () => {
        const roomsJoined = Array.from(socket.rooms).filter(r => r !== socket.id);
        roomsJoined.forEach(roomCode => {
            leaveRoom(roomCode, socket.id);
            io.to(roomCode).emit("PLAYER_LEFT", { playerId: socket.id, players: getRoomPlayers(roomCode) });
            console.log(`${socket.id} left room ${roomCode}`);

            // If host leaves, assign new host
            if (hosts[roomCode] === socket.id && getRoomPlayers(roomCode).length > 0) {
                hosts[roomCode] = getRoomPlayers(roomCode)[0];
                io.to(roomCode).emit("NEW_HOST", { host: hosts[roomCode] });
                console.log(`New host in room ${roomCode}: ${hosts[roomCode]}`);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Party Game Server running on port ${PORT}`));

app.get("/", (req, res) => {
  res.send("PartyGameServer is running 🚀");
});


