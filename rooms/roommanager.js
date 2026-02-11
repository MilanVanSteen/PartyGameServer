const fs = require("fs");
const path = require("path");

const badWordsPath = path.join(__dirname, "bannedwords.txt");

const BAD_WORDS = fs
  .readFileSync(badWordsPath, "utf8")
  .split(/\r?\n/)
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

const rooms = {};

function createRoom(socketId) {
  const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  rooms[roomCode] = {
    players: [{ id: socketId, name: null }],
    started: false
  };
  return roomCode;
}

function joinRoom(roomCode, socketId) {
  if (!rooms[roomCode]) return false;

  rooms[roomCode].players.push({
    id: socketId,
    name: null
  });

  return true;
}

function leaveRoom(roomCode, socketId) {
  if (!rooms[roomCode]) return;

  rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socketId);

  if (rooms[roomCode].players.length === 0) delete rooms[roomCode];
}

function setPlayerName(roomCode, socketId, name) {
  const room = rooms[roomCode];
  if (!room) return;

  const player = room.players.find(p => p.id === socketId);
  if (player) player.name = name;
}

function isValidName(roomCode, name) {
  if (!name) return "Name is required";

  const trimmed = name.trim();

  if (trimmed.length < 2 || trimmed.length > 12) {
    return "Name must be 2–12 characters long";
  }

  if (!/^[a-zA-Z0-9 ]+$/.test(trimmed)) {
    return "Name can only contain letters and numbers";
  }

  const lower = trimmed.toLowerCase();

  if (BAD_WORDS.some(word => new RegExp(`\\b${word}\\b`, "i").test(trimmed))) {
    return "Inappropriate name";
  }

  const room = rooms[roomCode];
  if (!room) return "Room not found";

  const duplicate = room.players.some(
    p => p.name && p.name.toLowerCase() === lower
  );

  if (duplicate) {
    return "Name already taken";
  }

  return null; // Name is valid
}

function getRoomPlayers(roomCode) {
  return rooms[roomCode] ? rooms[roomCode].players : [];
}

module.exports = { createRoom, joinRoom, leaveRoom, setPlayerName, isValidName, getRoomPlayers };