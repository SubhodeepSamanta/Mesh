const VALID_ICE_URL = /^(stun|turns?):[^\s:][^\s]*$/i;
console.log("turn:127.0.0.1:3478:", VALID_ICE_URL.test("turn:127.0.0.1:3478"));
console.log("turn:your-turn-server.com:3478?transport=udp:", VALID_ICE_URL.test("turn:your-turn-server.com:3478?transport=udp"));
console.log("turn::3478:", VALID_ICE_URL.test("turn::3478"));
