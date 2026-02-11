const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createRoom, joinRoom, leaveRoom, setPlayerName, isValidName, getRoomPlayers } = require("./rooms/roommanager");

const hosts = {};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {cors: {origin: "*"}});

io.on("connection", (socket) => {
    console.log("Client joined with id:", socket.id);

    // CREATE_ROOM
    socket.on("CREATE_ROOM", () => {
        const roomCode = createRoom(socket.id);
        socket.join(roomCode);
        hosts[roomCode] = socket.id;
        socket.emit("ROOM_CREATED", { roomCode });
        console.log(`Room ${roomCode} created by ${socket.id}`);
    });

    // JOIN_ROOM
    socket.on("JOIN_ROOM", ({ roomCode }) => {
        const success = joinRoom(roomCode, socket.id);

        if (!success) {
            socket.emit("ERROR", { message: "Room does not exist" });
            return;
        }
        
        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("ROOM_JOINED", { roomCode, players: getRoomPlayers(roomCode)});
        
        io.to(roomCode).emit("PLAYER_JOINED", {players: getRoomPlayers(roomCode)});
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
    socket.on("START_GAME", ({ roomCode }) => {
        if (hosts[roomCode] !== socket.id) {
            socket.emit("ERROR", { message: "Only the host can start the game" });
            return;
        }
        io.to(roomCode).emit("GAME_STARTED", { players: getRoomPlayers(roomCode) });
        console.log(`Game started in room ${roomCode} by host ${socket.id}`);
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

