const { SerialPort } = require('serialport');
const EventEmitter = require('events');

const STX = 0x02;
const ETX = 0x03;
const ACK_BYTE = 0x06;

class SerialManager extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.port = null;
    this.buffer = '';
    this.isOpen = false;
    this._onData = this._handleData.bind(this); // Single handler, bound once
  }

  async init() {
    const portConfig = {
      path: this.config.comPort || 'COM1',
      baudRate: this.config.baudRate || 9600,
      dataBits: this.config.dataBits || 8,
      stopBits: this.config.stopBits || 1,
      parity: this.config.parity || 'none',
      rtscts: true,
    };

    return new Promise((resolve, reject) => {
      this.port = new SerialPort(portConfig, (err) => {
        if (err) {
          this.logger.error('Serial port open failed', { error: err.message, port: portConfig.path });
          reject(err);
          return;
        }
        this.isOpen = true;

        // Subscribe data event ONCE in constructor
        this.port.on('data', this._onData);

        this.port.on('error', (err) => {
          this.logger.error('Serial port error', { error: err.message });
          this.emit('error', err);
        });

        this.port.on('close', () => {
          this.isOpen = false;
          this.logger.warn('Serial port closed');
          this.emit('disconnected');
        });

        this.logger.info('Serial port opened', { port: portConfig.path, baudRate: portConfig.baudRate });

        // Set RTS and DTR
        this.port.set({ rts: true, dtr: true }, () => {});
        resolve();
      });
    });
  }

  _handleData(chunk) {
    // Accumulate incoming data
    this.buffer += chunk.toString('binary');

    // Check for ACK byte
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer.charCodeAt(i) === ACK_BYTE) {
        this.emit('ack');
        // Remove ACK from buffer
        this.buffer = this.buffer.substring(0, i) + this.buffer.substring(i + 1);
        break;
      }
    }

    // Check for complete message: STX...ETX+LRC
    const stxIdx = this._findChar(this.buffer, STX);
    const etxIdx = this._findChar(this.buffer, ETX);

    if (stxIdx >= 0 && etxIdx > stxIdx && this.buffer.length > etxIdx + 1) {
      // Complete message: STX to ETX + 1 byte LRC
      const message = this.buffer.substring(stxIdx, etxIdx + 2);
      this.buffer = this.buffer.substring(etxIdx + 2);
      this.emit('response', message);
    }
  }

  _findChar(str, charCode) {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) === charCode) return i;
    }
    return -1;
  }

  async send(data) {
    if (!this.isOpen || !this.port) {
      throw new Error('Serial port not open');
    }
    return new Promise((resolve, reject) => {
      this.port.write(data, 'binary', (err) => {
        if (err) reject(err);
        else {
          this.port.drain((err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      });
    });
  }

  async sendAck() {
    return this.send(String.fromCharCode(ACK_BYTE));
  }

  async destroy() {
    if (this.port) {
      this.port.removeListener('data', this._onData);
      this.port.removeAllListeners('error');
      this.port.removeAllListeners('close');
      if (this.isOpen) {
        await new Promise((resolve) => {
          this.port.close(() => {
            this.isOpen = false;
            resolve();
          });
        });
      }
      this.port = null;
    }
    this.buffer = '';
  }

  getStatus() {
    return { isOpen: this.isOpen, port: this.config.comPort };
  }
}

module.exports = SerialManager;
