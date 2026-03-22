const EventEmitter = require('events');
const SerialManager = require('./serial');
const messageBuilder = require('./message-builder');
const responseParser = require('./response-parser');
const protocol = require('./protocol');

class EdcInterface extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config || {};
    this.logger = logger;
    this.serial = null;
    this.status = 'disconnected';
    this._destroyed = false;
  }

  async init() {
    this._destroyed = false;
    this.serial = new SerialManager(this.config, this.logger);

    this.serial.on('error', (err) => {
      this.status = 'error';
      this.emit('status', { status: 'error', error: err.message });
    });

    this.serial.on('disconnected', () => {
      this.status = 'disconnected';
      this.emit('status', { status: 'disconnected' });
      this._startReconnect();
    });

    try {
      await this.serial.init();
      this.status = 'connected';
      this.emit('status', { status: 'connected' });
      this.logger.info('EDC interface initialized');
    } catch (err) {
      this.status = 'error';
      this.logger.error('EDC init failed', { error: err.message });
      throw err;
    }
  }

  async processTransaction(txCode, data) {
    if (this.status !== 'connected') {
      throw new Error('EDC not connected');
    }

    this.logger.info('Starting transaction', { txCode, data });
    this.emit('status', { status: 'processing' });

    try {
      // 1. Build message
      let msg;
      switch (txCode) {
        case '20':
        case 'QR':
          msg = messageBuilder.buildPaymentMessage(
            txCode,
            parseFloat(data.amount) || 0,
            parseFloat(data.vatRefund) || 0,
            data.ref1 || '',
            data.ref2 || ''
          );
          break;
        case '26':
          msg = messageBuilder.buildCancelMessage(
            data.cardType || 'ONUS',
            data.invoiceNo || '',
            data.approvalCode || ''
          );
          break;
        case '92':
          msg = messageBuilder.buildReprintMessage(
            data.cardType || 'ONUS',
            data.invoiceNo || '',
            data.approvalCode || ''
          );
          break;
        default:
          throw new Error(`Unknown transaction code: ${txCode}`);
      }

      // 2. Send + wait ACK (with retry)
      const ackTimeout = this.config.ackTimeout || 5000;
      const maxRetries = this.config.retryCount || 3;

      for (let retry = 0; retry < maxRetries; retry++) {
        await this.serial.send(msg);
        this.logger.info(`Message sent, waiting for ACK (attempt ${retry + 1}/${maxRetries})`);

        try {
          await Promise.race([
            this._waitForAck(),
            this._timeout(ackTimeout, 'EDC_ACK_TIMEOUT')
          ]);
          this.logger.info('ACK received');
          break;
        } catch (err) {
          if (retry === maxRetries - 1) {
            throw new Error('EDC_NO_ACK');
          }
          this.logger.warn(`ACK timeout, retry ${retry + 1}/${maxRetries}`);
        }
      }

      // 3. Wait response (with timeout)
      const responseTimeout = this.config.responseTimeout || 60000;
      const rawResponse = await Promise.race([
        this._waitForResponse(),
        this._timeout(responseTimeout, 'EDC_RESPONSE_TIMEOUT')
      ]);
      this.logger.info('Response received');

      // 4. Validate LRC checksum
      if (!protocol.validateLrc(rawResponse)) {
        this.logger.error('LRC checksum validation failed');
        throw new Error('EDC_CHECKSUM_ERROR');
      }

      // 5. Parse + send ACK back
      const parsed = responseParser.parseResponse(rawResponse);
      await this.serial.sendAck();
      this.logger.info('ACK sent back to EDC');

      // 6. Log transaction
      this.logger.transaction({
        txCode,
        responseCode: parsed.ResponseCode,
        responseDetail: parsed.ResponseCodeDetail,
        fields: parsed.FieldDatas,
      });

      this.status = 'connected';
      this.emit('status', { status: 'connected' });

      return parsed;
    } catch (err) {
      this.status = 'connected';
      this.emit('status', { status: 'connected' });
      this.logger.error('Transaction failed', { txCode, error: err.message });
      throw err;
    }
  }

  _waitForAck() {
    return new Promise((resolve) => {
      this.serial.once('ack', resolve);
    });
  }

  _waitForResponse() {
    return new Promise((resolve) => {
      this.serial.once('response', resolve);
    });
  }

  _timeout(ms, errorMsg) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(errorMsg)), ms);
    });
  }

  getStatus() {
    return {
      status: this.status,
      serial: this.serial ? this.serial.getStatus() : null,
    };
  }

  _startReconnect() {
    if (this._reconnectTimer || this._destroyed) return;
    this.logger.info('Will attempt to reconnect EDC...');
    this._reconnectTimer = setInterval(async () => {
      if (this._destroyed) {
        clearInterval(this._reconnectTimer);
        this._reconnectTimer = null;
        return;
      }
      this.logger.debug('Attempting EDC reconnection...');
      try {
        if (this.serial) {
          await this.serial.destroy();
          this.serial = null;
        }
        await this.init();
        clearInterval(this._reconnectTimer);
        this._reconnectTimer = null;
      } catch (_) {
        // init failed, will retry on next interval
      }
    }, 5000);
  }

  _stopReconnect() {
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  async destroy() {
    this._destroyed = true;
    this._stopReconnect();
    if (this.serial) {
      await this.serial.destroy();
      this.serial = null;
    }
    this.status = 'disconnected';
    this.removeAllListeners();
    this.logger.info('EDC interface destroyed');
  }
}

module.exports = EdcInterface;
