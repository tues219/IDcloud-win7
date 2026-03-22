const EventEmitter = require('events');
const smartcard = require('smartcard');
const { getReaderConfig } = require('./atr-config');
const PersonalApplet = require('./personal-applet');
const NhsoApplet = require('./nhso-applet');
const { delay } = require('./reader');

class CardReaderModule extends EventEmitter {
  constructor(logger, config) {
    super();
    this.logger = logger;
    this.config = config || {};
    this.devices = null;
    this.currentCard = null;
    this.currentDevice = null;
    this.lastReadData = null;
    this.isReading = false;
    this.status = 'disconnected';
    this._destroyed = false;
    this._reconnectTimer = null;
    this._readGeneration = 0; // incremented on card removal to cancel stale reads
  }

  async init() {
    this._destroyed = false;
    // Clean up any existing monitor before creating a new one
    this._stopMonitor();
    this.status = 'disconnected';
    this.devices = new smartcard.Devices();

    this.devices.on('reader-attached', (reader) => {
      this.currentDevice = reader.name;
      this.status = 'connected';
      this.logger.info('Card reader connected', { device: reader.name });
      this.emit('status', { status: 'connected', device: reader.name });
    });

    this.devices.on('card-inserted', async (event) => {
      if (this._destroyed) return;
      await delay(300);
      if (this._destroyed) return;

      this.status = 'card-inserted';
      this.emit('status', { status: 'card-inserted' });

      const card = event.card;
      this.currentCard = card;
      const atr = Buffer.isBuffer(card.atr) ? card.atr.toString('hex') : String(card.atr || '');
      const readerConfig = getReaderConfig(atr);
      this.logger.info('Card inserted', { atr, readerType: readerConfig.readerType });

      try {
        await this._readCardData(card, readerConfig);
      } catch (err) {
        // Only update status if card is still present (not a stale read)
        if (this.currentCard === card) {
          this.logger.error('Card read failed', { error: err.message });
          this.status = 'error';
          this.emit('status', { status: 'error', error: err.message });
          this.currentCard = null;
          this.lastReadData = null;
          this.isReading = false;
        }
      }
    });

    this.devices.on('card-removed', () => {
      this.logger.info('Card removed');
      this._readGeneration++; // cancel any in-progress read
      this.currentCard = null;
      this.lastReadData = null;
      this.isReading = false;
      this.status = 'connected';
      this.emit('status', { status: 'connected' });
    });

    this.devices.on('reader-detached', () => {
      this.logger.warn('Card reader disconnected');
      this._readGeneration++;
      this.currentDevice = null;
      this.currentCard = null;
      this.lastReadData = null;
      this.isReading = false;
      this.status = 'disconnected';
      this.emit('status', { status: 'disconnected' });
      this._startReconnect();
    });

    this.devices.on('error', (error) => {
      const msg = error.message || String(error);
      // Only log once, then stop monitor and reconnect
      if (this.status !== 'error') {
        this.logger.error('Smart card system error', { error: msg });
        this.status = 'error';
        this._readGeneration++;
        this.currentDevice = null;
        this.currentCard = null;
        this.lastReadData = null;
        this.isReading = false;
        this.emit('status', { status: 'disconnected' });
        this._stopMonitor();
        this._startReconnect();
      }
    });

    this.devices.start();
    this.logger.info('Card reader module initialized');
  }

  async _readCardData(card, readerConfig) {
    // Mutex lock — reject if already reading
    if (this.isReading) {
      this.logger.warn('Read already in progress, skipping');
      return;
    }
    this.isReading = true;
    const gen = this._readGeneration;

    try {
      // 10 second timeout for entire read operation
      const readPromise = this._performRead(card, readerConfig, gen);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('READ_TIMEOUT')), 10000)
      );

      const data = await Promise.race([readPromise, timeoutPromise]);

      // Check if card was removed during read
      if (gen !== this._readGeneration) return;

      this.lastReadData = data;
      this.status = 'read-complete';
      this.emit('card-data', data);
      this.emit('status', { status: 'read-complete' });
      this.logger.info('Card read complete');
    } finally {
      if (gen === this._readGeneration) {
        this.isReading = false;
      }
    }
  }

  async _performRead(card, readerConfig, gen) {
    const req = readerConfig.req;
    const options = { delayMs: readerConfig.delayMs, commandTimeout: 5000 };

    const personalApplet = new PersonalApplet(card, req, options);
    const personal = await personalApplet.getInfo(this.logger, () => gen !== this._readGeneration);

    if (gen !== this._readGeneration) throw new Error('CARD_REMOVED');

    const nhsoApplet = new NhsoApplet(card, req, options);
    const nhso = await nhsoApplet.getInfo(this.logger, () => gen !== this._readGeneration);

    if (gen !== this._readGeneration) throw new Error('CARD_REMOVED');

    return { ...personal, nhso };
  }

  // Called by WS handler when frontend requests a read
  async readCard() {
    if (this.lastReadData) {
      return { success: true, personal: this._formatForFrontend(this.lastReadData) };
    }
    return { success: false, personal: null, msgDetail: 'กรุณาเสียบบัตรประชาชน' };
  }

  _formatForFrontend(data) {
    const { cid, name, nameEN, dob, gender, address, photo, issuer, issueDate, expireDate } = data;
    const personal = {
      Citizenid: cid || null,
      Th_Prefix: name ? name.prefix : null,
      Th_Firstname: name ? name.firstname : null,
      Th_Middlename: name ? name.middlename : null,
      Th_Lastname: name ? name.lastname : null,
      En_Prefix: nameEN ? nameEN.prefix : null,
      En_Firstname: nameEN ? nameEN.firstname : null,
      En_Middlename: nameEN ? nameEN.middlename : null,
      En_Lastname: nameEN ? nameEN.lastname : null,
      Birthday: dob || null,
      gender: gender === '1' ? 'ชาย' : gender === '2' ? 'หญิง' : gender ? 'อื่นๆ' : null,
      addrProvince: address ? address.province : null,
      addrAmphur: address ? address.district : null,
      addrTambol: address ? address.subdistrict : null,
      addrHouseNo: address
        ? [address.houseNo, address.soi, address.street, address.moo].filter(Boolean).join(' ')
        : null,
      PhotoRaw: photo || null,
      Issuer: issuer || null,
      IssueDate: issueDate || null,
      ExpireDate: expireDate || null,
    };
    return personal;
  }

  _stopMonitor() {
    if (this.devices) {
      try { this.devices.stop(); } catch (_) {}
      this.devices.removeAllListeners();
      this.devices = null;
    }
  }

  _startReconnect() {
    if (this._reconnectTimer || this._destroyed) return;
    this.logger.info('Will attempt to reconnect card reader...');
    this._reconnectTimer = setInterval(async () => {
      if (this._destroyed) {
        clearInterval(this._reconnectTimer);
        this._reconnectTimer = null;
        return;
      }
      this.logger.debug('Attempting card reader reconnection...');
      try {
        await this.init();
        // If init() succeeded without throwing, stop reconnect timer
        clearInterval(this._reconnectTimer);
        this._reconnectTimer = null;
      } catch (_) {
        // init failed, will retry on next interval
        this._stopMonitor();
      }
    }, 5000);
  }

  getStatus() {
    return {
      status: this.status,
      hasCard: !!this.currentCard,
      hasData: !!this.lastReadData,
      isReading: this.isReading,
    };
  }

  async destroy() {
    this._destroyed = true;
    this._readGeneration++;
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._stopMonitor();
    this.currentCard = null;
    this.currentDevice = null;
    this.lastReadData = null;
    this.isReading = false;
    this.removeAllListeners();
    this.logger.info('Card reader module destroyed');
  }
}

module.exports = CardReaderModule;
