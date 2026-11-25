// DOORS 2D — Yarış sunucusu. Hiçbir paket gerektirmez (sadece Node.js >= 18).
// Çalıştır:  node server.js   ->  http://localhost:3000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TARGET = 25;          // Kazanmak için açılması gereken kapı sayısı
const MIN_DOOR_MS = 3500;   // Hile önleme: iki kapı arası en az bu kadar ms
const COUNTDOWN = 3;        // Başlamadan önce geri sayım (sn)

// ---------- HTTP (sadece index.html sunar) ----------
const INDEX = path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html bulunamadi'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('404');
});

// ---------- Elle yazılmış minimal WebSocket ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  new Client(socket);
});

class Client {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.alive = true;
    this.room = null;
    clients.add(this);
    sock.setNoDelay(true);
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    sock.on('close', () => this.close());
    sock.on('error', () => this.close());
  }
  parse() {
    // Not: parçalı (fragmented) mesajlar desteklenmez; tarayıcılar küçük mesajları tek parça yollar.
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const op = b0 & 15, masked = !!(b1 & 128);
      let len = b1 & 127, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536) { this.sock.destroy(); return; }
      const mlen = masked ? 4 : 0;
      if (this.buf.length < off + mlen + len) return;
      let payload = Buffer.from(this.buf.subarray(off + mlen, off + mlen + len));
      if (masked) { const m = this.buf.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(off + mlen + len);
      if (op === 8) { try { this.sock.end(); } catch (e) {} this.close(); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 1) { try { this.onMsg(JSON.parse(payload.toString('utf8'))); } catch (e) {} }
    }
  }
  frame(op, payload) {
    if (!this.alive) return;
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    try { this.sock.write(Buffer.concat([header, payload])); } catch (e) {}
  }
  send(obj) { this.frame(1, Buffer.from(JSON.stringify(obj))); }
  close() {
    if (!this.alive) return;
    this.alive = false;
    clients.delete(this);
    leave(this);
  }
  onMsg(m) {
    switch (m.t) {
      case 'create': {
        leave(this);
        const r = newRoom(this);
        this.send({ t: 'created', code: r.code });
        break;
      }
      case 'join': {
        leave(this);
        const code = String(m.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r || r.players.length !== 1 || r.started) { this.send({ t: 'err', msg: 'Oda bulunamadı veya dolu.' }); break; }
        r.players.push(this); this.room = r;
        startMatch(r);
        break;
      }
      case 'queue': {
        leave(this);
        if (queue && queue.alive && queue !== this) {
          const r = newRoom(queue);
          queue = null;
          r.players.push(this); this.room = r;
          startMatch(r);
        } else { queue = this; this.send({ t: 'queued' }); }
        break;
      }
      case 'state': {
        const r = this.room;
        if (!r || !r.started || r.over || typeof m.s !== 'object' || m.s === null) break;
        const other = r.players[1 - r.players.indexOf(this)];
        if (other) other.send({ t: 'opp', s: m.s });
        break;
      }
      case 'door': {
        const r = this.room;
        if (!r || !r.started || r.over) break;
        const i = r.players.indexOf(this);
        const now = Date.now();
        if (m.room === r.progress[i] + 1 && now - r.last[i] >= MIN_DOOR_MS) {
          r.progress[i]++; r.last[i] = now;
          const other = r.players[1 - i];
          if (other) other.send({ t: 'oppDoor', room: r.progress[i] });
          if (r.progress[i] >= TARGET) finish(r, this, 'finish');
        }
        break;
      }
    }
  }
}

// ---------- Oda yönetimi ----------
const rooms = new Map();
let queue = null;

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += chars[crypto.randomInt(chars.length)]; } while (rooms.has(c));
  return c;
}
function newRoom(owner) {
  const r = { code: genCode(), players: [owner], started: false, over: false, progress: [0, 0], last: [0, 0] };
  rooms.set(r.code, r); owner.room = r;
  return r;
}
function startMatch(r) {
  r.started = true;
  const sa = crypto.randomInt(1, 2147483646), sb = crypto.randomInt(1, 2147483646);
  const t0 = Date.now() + COUNTDOWN * 1000;
  r.last = [t0, t0];
  r.players[0].send({ t: 'start', seed: sa, oppSeed: sb, target: TARGET, countdown: COUNTDOWN });
  r.players[1].send({ t: 'start', seed: sb, oppSeed: sa, target: TARGET, countdown: COUNTDOWN });
}
function finish(r, winner, reason) {
  if (r.over) return;
  r.over = true;
  for (const p of r.players) if (p.alive) p.send({ t: 'over', winner: p === winner ? 'you' : 'opp', reason });
  setTimeout(() => rooms.delete(r.code), 5000);
}
function leave(c) {
  if (queue === c) queue = null;
  const r = c.room;
  if (!r) return;
  c.room = null;
  if (r.started && !r.over) {
    const other = r.players.find(p => p !== c);
    if (other) finish(r, other, 'left');
  }
  if (!r.started) rooms.delete(r.code);
}

// Bağlantıları canlı tut (barındırma servisleri boşta kalan bağlantıyı kapatabilir)
setInterval(() => { for (const c of clients) c.frame(9, Buffer.alloc(0)); }, 20000);

server.listen(PORT, () => console.log('DOORS 2D sunucusu hazır: http://localhost:' + PORT));
