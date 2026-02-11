const rooms = {};

function createRoom(socketId) {
  const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  rooms[roomCode] = {
    players: [{ id: socketId, name: null }]
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

function getRoomPlayers(roomCode) {
  return rooms[roomCode] ? rooms[roomCode].players : [];
}

module.exports = { createRoom, joinRoom, leaveRoom, setPlayerName, getRoomPlayers };