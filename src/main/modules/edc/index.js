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
    this.status = 'ready';
    this.emit('status', { status: 'ready' });
    this.logger.info('EDC interface ready', { port: this.config.comPort });
  }

  async _connect() {
    this.serial = new SerialManager(this.config, this.logger);
    await this.serial.init();
  }

  async _disconnect() {
    if (this.serial) {
      await this.serial.destroy();
      this.serial = null;
    }
  }

  async processTransaction(txCode, data) {
    if (this.status === 'processing') {
      throw new Error('EDC busy');
    }
    if (!this.config.comPort) {
      throw new Error('EDC not configured');
    }

    this.status = 'processing';
    this.emit('status', { status: 'processing' });
    this.logger.info('Starting transaction', { txCode, data });

    try {
      // 0. Connect
      await this._connect();

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

      // 2. Send + wait ACK (single attempt, 5s timeout)
      const ackTimeout = this.config.ackTimeout || 5000;
      this.serial.expectAck();
      await this.serial.send(msg);
      this.logger.info('Message sent, waiting for ACK');

      await Promise.race([
        this._waitForAck(),
        this._timeout(ackTimeout, 'EDC_NO_ACK')
      ]);
      this.logger.info('ACK received');

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

      return parsed;
    } catch (err) {
      this.logger.error('Transaction failed', { txCode, error: err.message });
      throw err;
    } finally {
      await this._disconnect();
      this.status = 'ready';
      this.emit('status', { status: 'ready' });
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

  async destroy() {
    this._destroyed = true;
    await this._disconnect();
    this.status = 'disconnected';
    this.removeAllListeners();
    this.logger.info('EDC interface destroyed');
  }
}

module.exports = EdcInterface;
