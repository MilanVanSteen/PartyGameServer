const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createRoom, joinRoom, leaveRoom, setPlayerName, isValidName, getRoomPlayers, rooms } = require("./rooms/roommanager");

const hosts = {};
const diceState = {};
const extraRollState = {};
const powerupDone = {};

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
        console.log(`[ROLL_DICE] Triggered by ${socket.id} in room ${roomCode}`);

        if (!roomCode) {
            console.warn("[ROLL_DICE] No roomCode found");
            return;
        }
        if (hosts[roomCode] !== socket.id) {
            console.warn(`[ROLL_DICE] Socket ${socket.id} is not host for room ${roomCode}`);
            return;
        }

        const players = getRoomPlayers(roomCode);
        if (!players || players.length === 0) {
            console.warn(`[ROLL_DICE] No players in room ${roomCode}`);
            return;
        }

        diceState[roomCode] = { expected: players.length, results: [] };
        console.log(`[ROLL_DICE] Expected rolls: ${players.length}`, players.map(p => p.id));

        // Generate random rolls for each player
        players.forEach(player => {
            const roll = Math.floor(Math.random() * 6) + 1;
            console.log(`[ROLL_DICE] Rolling for ${player.id}: ${roll}`);

            // Send each player only their roll
            io.to(player.id).emit("DICE_ROLL_START", { roll });
        });
    });

    // Dice roll finishes
    socket.on("DICE_ROLL_FINISHED", ({ playerId, roll }) => {
        const roomCode = socket.roomCode;
        console.log(`[DICE_ROLL_FINISHED] Received from ${playerId} in room ${roomCode} roll: ${roll}`);

        if (!roomCode) {
            console.warn(`[DICE_ROLL_FINISHED] No roomCode for ${playerId}`);
            return;
        }

        const state = diceState[roomCode];
        if (!state) {
            console.warn(`[DICE_ROLL_FINISHED] Dice state not found for room: ${roomCode}`);
            console.log(`[DICE_ROLL_FINISHED] Current diceState:`, diceState);
            return;
        }

        // Avoid double-counting
        if (state.results.find(r => r.playerId === playerId)) {
            console.warn(`[DICE_ROLL_FINISHED] Duplicate roll received for ${playerId}, ignoring`);
            return;
        }

        state.results.push({ playerId, roll });
        console.log(`[DICE_ROLL_FINISHED] Progress for room ${roomCode}: ${state.results.length}/${state.expected}`);

        if (state.results.length === state.expected) {
            const hostId = hosts[roomCode];
            console.log(`[DICE_ROLL_FINISHED] All rolls done for room ${roomCode}, sending to host ${hostId}`, state.results);
            if (hostId) {
                io.to(hostId).emit("PLAYER_MOVE", { moves: state.results });
            }
            delete diceState[roomCode]; // reset for next roll
        }
    });

    // UNITY tells server to start powerup phase
    socket.on("POWERUP_PHASE_START", ({ playerId, inventory, duration }) => {

        console.log("Forwarding powerup inventory to", playerId);

        // Send inventory to specific website player
        io.to(playerId).emit("POWERUP_PHASE_START", { inventory, duration });
    });

    // Website selects powerup
    socket.on("POWERUP_SELECTED", ({ playerId, inventoryIndex }) => {

        console.log("Player selected powerup:", playerId);

        // Forward to Unity host
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const hostId = hosts[roomCode];

        io.to(hostId).emit("POWERUP_SELECTED", {
            playerId,
            inventoryIndex
        });
    });

    // UNITY asks server to roll extra dice for a player
    socket.on("REQUEST_EXTRA_ROLL", ({ playerId }) => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;
        
        const hostId = hosts[roomCode];
        if (!hostId) return;

        console.log(`[EXTRA_ROLL] Requested by ${playerId} in room ${roomCode}`);

        // Roll a die
        const roll = Math.floor(Math.random() * 6) + 1;

        console.log(`[EXTRA_ROLL] Result: ${roll}`);

        // Send to WEBSITE (so dice animates)
        io.to(playerId).emit("EXTRA_ROLL_RESULT", {playerId, roll});

        // Send to UNITY HOST (so player moves)
        io.to(hostId).emit("EXTRA_ROLL_RESULT", {playerId, roll});
    });

    // Website skips
    socket.on("POWERUP_SKIPPED", ({ playerId }) => {

        console.log("Player skipped:", playerId);

        const roomCode = socket.roomCode;
        if (!roomCode) return;
    });

    // Powerup phase ends
    socket.on("POWERUP_PHASE_END", () => {

        const roomCode = socket.roomCode;
        if (!roomCode) return;

        io.to(roomCode).emit("POWERUP_PHASE_END");
    });

    socket.on("POWERUP_TIMER_FINISHED", ({ playerId }) => {
        console.log("Backup timer finished from", playerId);

        // Forward to Unity host
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const hostId = hosts[roomCode];

        if (hostId && io.sockets.sockets.get(hostId)) {
            io.to(hostId).emit("POWERUP_PHASE_FORCE_END");
        } else {
            console.warn("Cannot send POWERUP_PHASE_FORCE_END, host disconnected");
        }
    });

    // Disconnect (Clear rooms)
    socket.on("disconnecting", () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        // Only handle Unity host leaving
        if (hosts[roomCode] === socket.id) 
        {
            console.log(`[DISCONNECTING] Socket ${socket.id} leaving room ${socket.roomCode}`);
            io.to(roomCode).emit("HOST_DISCONNECTED");

            // Optionally clear the room entirely
            leaveRoom(roomCode, socket.id);
            delete hosts[roomCode];
            delete rooms[roomCode];
        } 
        else 
        {
            // Normal player leaving
            leaveRoom(roomCode, socket.id);
            io.to(roomCode).emit("PLAYER_LEFT", { playerId: socket.id, players: getRoomPlayers(roomCode) });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Party Game Server running on port ${PORT}`));

app.get("/", (req, res) => {
  res.send("PartyGameServer is running 🚀");
});


