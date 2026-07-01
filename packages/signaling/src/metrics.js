export const metrics = {
  totalRoomsCreated: 0,
  totalPeersJoined: 0,
  activeRooms: 0,
  activePeers: 0,
};

export function recordRoomCreated() {
  metrics.totalRoomsCreated++;
  metrics.activeRooms++;
}

export function recordRoomExpiredOrClosed() {
  metrics.activeRooms = Math.max(0, metrics.activeRooms - 1);
}

export function recordPeerJoined() {
  metrics.totalPeersJoined++;
  metrics.activePeers++;
}

export function recordPeerLeft() {
  metrics.activePeers = Math.max(0, metrics.activePeers - 1);
}