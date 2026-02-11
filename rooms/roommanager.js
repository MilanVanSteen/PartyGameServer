const rooms = {};

function createRoom(socketId) {
  const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  rooms[roomCode] = { players: [socketId] };
  return roomCode;
}

function joinRoom(roomCode, socketId) {
  if (!rooms[roomCode]) return false;
  rooms[roomCode].players.push(socketId);
  return true;
}

function leaveRoom(roomCode, socketId) {
  if (!rooms[roomCode]) return;
  rooms[roomCode].players = rooms[roomCode].players.filter(id => id !== socketId);
  if (rooms[roomCode].players.length === 0) delete rooms[roomCode];
}

function getRoomPlayers(roomCode) {
  return rooms[roomCode] ? rooms[roomCode].players : [];
}

module.exports = { createRoom, joinRoom, leaveRoom, getRoomPlayers };