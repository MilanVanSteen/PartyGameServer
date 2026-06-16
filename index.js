const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createRoom, joinRoom, leaveRoom, setPlayerName, isValidName, getRoomPlayers, rooms } = require("./rooms/roommanager");

const hosts = {};
const diceState = {};
const minigameState = {};

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
        const existingRoom = socket.roomCode;

        if (socket.roomCode && rooms[existingRoom]) {
            socket.emit("ROOM_CREATED", { roomCode: existingRoom });
            return;
        }

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
        
        socket.emit("NAME_CONFIRMED");
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
    socket.on("DICE_ROLL_FINISHED", ({ roll }) => {
        const roomCode = socket.roomCode;
        const playerId = socket.id;

        console.log(`[DICE_ROLL_FINISHED] Received from ${playerId} in room ${roomCode} roll: ${roll}`);

        if (!roomCode) {
            console.warn(`[DICE_ROLL_FINISHED] No roomCode for ${playerId}`);
            return;
        }

        const state = diceState[roomCode];
        if (!state) {
            console.warn(`[DICE_ROLL_FINISHED] Dice state not found for room: ${roomCode}`);
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

    // UNITY tells server to show player stuck
    socket.on("SHOW_PLAYER_STUCK", ({ playerId, isStuck }) => {
        console.log("Showing player stuck status to", playerId);

        io.to(playerId).emit("SHOW_PLAYER_STUCK", { isStuck });
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

        io.to(hostId).emit("POWERUP_SELECTED", { playerId, inventoryIndex });
    });

    // UNITY asks server to roll extra dice for a player
    socket.on("REQUEST_EXTRA_ROLL", ({ playerId }) => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        console.log(`[EXTRA_ROLL] Requested by ${playerId} in room ${roomCode}`);

        diceState[roomCode] = {
            expected: 1,
            results: []
        };

        // Roll a die
        const roll = Math.floor(Math.random() * 6) + 1;

        console.log(`[EXTRA_ROLL] Result: ${roll}`);

        // Send to WEBSITE (so dice animates)
        io.to(playerId).emit("DICE_ROLL_START", { roll });
    });

    // UNITY tells server shield has expired
    socket.on("SHIELD_EXPIRED", ({ playerId }) => {
        io.to(playerId).emit("SHIELD_EXPIRED");
    });

    // Website skips
    socket.on("POWERUP_SKIPPED", ({ playerId }) => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        console.log(`[POWERUP_SKIPPED] Player ${playerId} skipped powerup.`);

        // Forward to Unity host
        const hostId = hosts[roomCode];
        if (hostId) {
            io.to(hostId).emit("POWERUP_SKIPPED", { playerId });
        }
    });

    // Powerup phase ends
    socket.on("POWERUP_PHASE_END", () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        if (hosts[roomCode] !== socket.id) {
            console.warn("Non-host attempted to end powerup phase");
            return;
        }

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

    // UNITY triggers minigame
    socket.on("MINIGAME_START", ({ minigame, duration }) => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const players = getRoomPlayers(roomCode);

        const state = {
            type: minigame,
            scores: {},
            startTime: Date.now(),
            duration
        };

        minigameState[roomCode] = state;

        console.log(`[MINIGAME_START] ${minigame} in room ${roomCode} for ${duration}s`);

        // Broadcast to all players in room
        io.to(roomCode).emit("MINIGAME_START", { minigame, duration });
    });

    socket.on("MINIGAME_ANSWER", ({ playerId, correct }) => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const state = minigameState[roomCode];
        if (!state) return;

        if (!state.scores[playerId]) {
            state.scores[playerId] = 0;
        }

        if (correct) {
            state.scores[playerId]++;
        }
        else if(!correct) {
            state.scores[playerId] = Math.max(0, state.scores[playerId] - 1);
        }

        console.log(`${playerId} score:`, state.scores[playerId]);
    });

    function finishMinigame(roomCode) {
        const state = minigameState[roomCode];
        if (!state) return;

        const scores = state.scores;
        const values = Object.values(scores);

        let winners = [];

        if (values.length > 0) {
            const maxScore = Math.max(...values);

            winners = Object.entries(scores)
                .filter(([_, score]) => score === maxScore)
                .map(([playerId]) => playerId);
        }

        console.log(`[MINIGAME_RESULTS] Winners for room ${roomCode}:`, winners, "Scores:", scores);
        io.to(roomCode).emit("MINIGAME_RESULTS", { winners, scores });
        io.to(roomCode).emit("MINIGAME_ENDED");

        delete minigameState[roomCode];
    }

    socket.on("MINIGAME_PHASE_END", () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        if (hosts[roomCode] !== socket.id) {
            console.warn("Non-host attempted to end minigame");
            return;
        }

        console.log(`[MINIGAME_PHASE_END] Closing minigame in room ${roomCode}`);

        finishMinigame(roomCode);
    });

    socket.on("MINIGAME_TIMER_FINISHED", ({ playerId }) => {

        console.log("Minigame timer finished from", playerId);

        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const hostId = hosts[roomCode];

        if (hostId && io.sockets.sockets.get(hostId)) {

            io.to(hostId).emit("MINIGAME_PHASE_FORCE_END");

        } else {

            console.warn("Cannot send MINIGAME_PHASE_FORCE_END, host disconnected");
        }
    });

    // HOST starts game
    socket.on("END_GAME", ({ playerName }) => {
        console.log("END_GAME received from:", socket.id);

        const roomCode = socket.roomCode;

        if (!roomCode) 
        {
            socket.emit("ERROR", { message: "Not in a room" });
            return;
        }
        
        if (hosts[roomCode] !== socket.id) 
        {
            socket.emit("ERROR", { message: "Only the host can end the game" });
            return;
        }
        
        console.log(`Game ended in room ${roomCode} by host ${socket.id}`);
        console.log(`Winner: ${playerName}`);

        io.to(roomCode).emit("GAME_ENDED", {
            winnerName: playerName
        });
    });

    socket.on("HOST_STOP_GAME", () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        // only allow host
        if (hosts[roomCode] !== socket.id) return;

        console.log(`Host stopped game in room ${roomCode} by host ${socket.id}`);

        io.to(roomCode).emit("GAME_STOPPED");

        // full cleanup
        leaveRoom(roomCode, socket.id);

        delete hosts[roomCode];
        delete rooms[roomCode];
    });

    // Disconnect
    socket.on("disconnect", () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const isHost = hosts[roomCode] === socket.id;

        if (isHost) {
            console.log(`HOST disconnected in room ${roomCode}`);
            
            io.to(roomCode).emit("HOST_DISCONNECTED");

            leaveRoom(roomCode, socket.id);
            delete rooms[roomCode];
            return;
        }

        // PLAYER LEFT
        console.log(`Player ${socket.id} left room ${roomCode}`);

        leaveRoom(roomCode, socket.id);

        const updatedPlayers = getRoomPlayers(roomCode);

        io.to(roomCode).emit("PLAYER_LEFT", {
            playerId: socket.id,
            players: updatedPlayers
        });

        if (updatedPlayers.length === 0) {
            console.log(`Room ${roomCode} empty → deleting`);
            delete rooms[roomCode];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Party Game Server running on port ${PORT}`));

app.get("/", (req, res) => {
  res.send("PartyGameServer is running 🚀");
});


