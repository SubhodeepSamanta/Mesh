import { EventEmitter } from 'events';

export const FRAME_TYPE = { DATA: 0, ACK: 1, CLOSE: 2 };
export const DEFAULT_MTU = 1100;
export const DEFAULT_WINDOW = 16;
export const DEFAULT_RTO_MS = 300;
// Retransmit delay doubles per consecutive timeout up to this cap: mobile
// hotspots stall for whole seconds (tower handoff, uplink bufferbloat), and a
// fixed 300ms timer burned all retries in ~6s — killing transfers a patient
// sender would have completed.
export const DEFAULT_MAX_RTO_MS = 4000;
export const DEFAULT_MAX_RETRIES = 20;
export const DEFAULT_HIGH_WATER_MARK = 1024 * 1024;

function encodeData(seq, payload) {
  const header = Buffer.alloc(5);
  header.writeUInt8(FRAME_TYPE.DATA, 0);
  header.writeUInt32BE(seq, 1);
  return Buffer.concat([header, payload]);
}

function encodeAck(nextExpected) {
  const buf = Buffer.alloc(5);
  buf.writeUInt8(FRAME_TYPE.ACK, 0);
  buf.writeUInt32BE(nextExpected, 1);
  return buf;
}

function encodeClose() {
  return Buffer.from([FRAME_TYPE.CLOSE]);
}

export class ReliableDatagramChannel extends EventEmitter {
  constructor(channel, opts = {}) {
    super();
    this.channel = channel;
    this.mtu = opts.mtu ?? DEFAULT_MTU;
    this.windowSize = opts.windowSize ?? DEFAULT_WINDOW;
    this.rtoMs = opts.rtoMs ?? DEFAULT_RTO_MS;
    this.maxRtoMs = opts.maxRtoMs ?? DEFAULT_MAX_RTO_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.highWaterMark = opts.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;

    this.nextSeqToSend = 0;
    this.pendingBytes = Buffer.alloc(0);
    this.unacked = new Map();
    this.retryCount = 0;
    this.retransmitTimer = null;
    this.destroyed = false;
    this.corked = false;

    this.expectedSeq = 0;
    this.reorderBuffer = new Map();

    this._onMessage = (msg) => this._handleMessage(msg);
    this.channel.on('message', this._onMessage);
  }

  _queuedBytes() {
    return this.pendingBytes.length + this.unacked.size * this.mtu;
  }

  _safeSend(buffer) {
    if (this.destroyed) return false;
    try {
      this.channel.send(buffer);
      return true;
    } catch (err) {
      this._fail(err);
      return false;
    }
  }

  write(buffer) {
    if (this.destroyed) throw new Error('Reliable datagram channel is closed');
    this.pendingBytes = Buffer.concat([this.pendingBytes, buffer]);
    this._pump();
    if (this._queuedBytes() > this.highWaterMark) {
      this.corked = true;
      return false;
    }
    return true;
  }

  _pump() {
    while (this.pendingBytes.length > 0 && this.unacked.size < this.windowSize) {
      const chunkSize = Math.min(this.mtu, this.pendingBytes.length);
      const chunk = this.pendingBytes.subarray(0, chunkSize);
      this.pendingBytes = this.pendingBytes.subarray(chunkSize);

      const seq = this.nextSeqToSend++;
      this.unacked.set(seq, chunk);
      if (!this._safeSend(encodeData(seq, chunk))) return;
    }
    if (this.unacked.size > 0 && !this.retransmitTimer) {
      this._armRetransmitTimer();
    }
  }

  _armRetransmitTimer() {
    // Exponential backoff: retryCount resets whenever an ACK makes progress,
    // so healthy paths stay at the base RTO while stalls back off gracefully.
    const delay = Math.min(this.rtoMs * 2 ** this.retryCount, this.maxRtoMs);
    this.retransmitTimer = setTimeout(() => this._onRetransmitTimeout(), delay);
  }

  _onRetransmitTimeout() {
    this.retransmitTimer = null;
    if (this.destroyed || this.unacked.size === 0) return;

    this.retryCount++;
    if (this.retryCount > this.maxRetries) {
      this._fail(new Error('Reliable datagram channel exceeded max retransmit attempts'));
      return;
    }

    for (const [seq, chunk] of [...this.unacked.entries()].sort((a, b) => a[0] - b[0])) {
      if (!this._safeSend(encodeData(seq, chunk))) return;
    }
    this._armRetransmitTimer();
  }

  _handleMessage(msg) {
    if (this.destroyed || msg.length < 1) return;
    const type = msg.readUInt8(0);

    if (type === FRAME_TYPE.CLOSE) {
      this.destroyed = true;
      if (this.retransmitTimer) clearTimeout(this.retransmitTimer);
      this.channel.removeListener?.('message', this._onMessage);
      this.emit('close');
      return;
    }

    if (msg.length < 5) return;

    if (type === FRAME_TYPE.ACK) {
      const ackSeq = msg.readUInt32BE(1);
      let advanced = false;
      for (const seq of [...this.unacked.keys()]) {
        if (seq < ackSeq) {
          this.unacked.delete(seq);
          advanced = true;
        }
      }
      if (!advanced) return;

      this.retryCount = 0;
      if (this.unacked.size === 0 && this.retransmitTimer) {
        clearTimeout(this.retransmitTimer);
        this.retransmitTimer = null;
      }

      const wasCorked = this.corked;
      this._pump();
      if (wasCorked && this._queuedBytes() <= this.highWaterMark) {
        this.corked = false;
        this.emit('drain');
      }
      return;
    }

    if (type === FRAME_TYPE.DATA) {
      const seq = msg.readUInt32BE(1);
      const payload = Buffer.from(msg.subarray(5));

      if (seq === this.expectedSeq) {
        this.expectedSeq++;
        this.emit('data', payload);
        while (this.reorderBuffer.has(this.expectedSeq)) {
          const buffered = this.reorderBuffer.get(this.expectedSeq);
          this.reorderBuffer.delete(this.expectedSeq);
          this.expectedSeq++;
          this.emit('data', buffered);
        }
      } else if (seq > this.expectedSeq && seq - this.expectedSeq < this.windowSize * 4) {
        if (!this.reorderBuffer.has(seq)) this.reorderBuffer.set(seq, payload);
      }

      this._safeSend(encodeAck(this.expectedSeq));
    }
  }

  _fail(err) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.retransmitTimer) clearTimeout(this.retransmitTimer);
    this.channel.removeListener?.('message', this._onMessage);
    this.emit('error', err);
    this.emit('close');
  }

  setNoDelay() {}

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.retransmitTimer) clearTimeout(this.retransmitTimer);
    try {
      this.channel.send(encodeClose());
    } catch {}
    this.channel.removeListener?.('message', this._onMessage);
    setImmediate(() => {
      if (this.channel.close) this.channel.close();
    });
    this.emit('close');
  }

  close() {
    this.destroy();
  }
}
