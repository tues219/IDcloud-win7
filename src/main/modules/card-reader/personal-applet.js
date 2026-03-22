const legacy = require('legacy-encoding');
const { getData, delay } = require('./reader');
const apduPerson = require('./apdu-person');

class PersonalApplet {
  constructor(card, req = [0x00, 0xc0, 0x00, 0x00], options = {}) {
    this.card = card;
    this.req = req;
    this.options = { delayMs: options.delayMs || 50, commandTimeout: options.commandTimeout || 5000 };
  }

  // Field-level retry: retry individual field reads up to 2 extra times
  async readField(command, fieldName, decode = null) {
    const maxFieldRetries = 3;
    for (let i = 0; i < maxFieldRetries; i++) {
      if (this._isCancelled()) throw new Error('CARD_REMOVED');
      try {
        const data = await getData(this.card, command, this.req, this.options);
        await delay(this.options.delayMs);
        if (decode === 'tis620') {
          return legacy.decode(data, 'tis620').slice(0, -2).toString().trim();
        }
        return data.slice(0, -2).toString().trim();
      } catch (err) {
        if (err.message === 'CARD_REMOVED') throw err;
        if (i < maxFieldRetries - 1) {
          await delay(this.options.delayMs * 2);
        } else {
          throw err;
        }
      }
    }
  }

  async readRawField(command) {
    if (this._isCancelled()) throw new Error('CARD_REMOVED');
    const data = await getData(this.card, command, this.req, this.options);
    await delay(this.options.delayMs);
    return data;
  }

  async getInfo(logger, isCancelled = () => false) {
    this._isCancelled = isCancelled;
    this.options.isCancelled = isCancelled;
    const info = { _errors: [] };

    // Select Thai ID applet
    await this.card.transmit(Buffer.from([
      0x00, 0xa4, 0x04, 0x00, 0x08,
      0xa0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01,
    ]));
    await delay(this.options.delayMs);
    logger.info('Reading card...');

    if (isCancelled()) throw new Error('CARD_REMOVED');

    // CID
    try {
      info.cid = await this.readField(apduPerson.CMD_CID, 'cid');
    } catch (err) {
      info.cid = null;
      info._errors.push({ field: 'cid', error: err.message });
      logger.error('Failed to read CID', { error: err.message });
    }
    if (isCancelled()) throw new Error('CARD_REMOVED');

    // Thai fullname
    try {
      const raw = await this.readField(apduPerson.CMD_THFULLNAME, 'name', 'tis620');
      const parts = raw.split('#');
      info.name = {
        prefix: parts[0] || '',
        firstname: parts[1] || '',
        middlename: parts[2] || '',
        lastname: parts[3] || '',
      };
    } catch (err) {
      info.name = null;
      info._errors.push({ field: 'name', error: err.message });
      logger.error('Failed to read Thai name', { error: err.message });
    }
    if (isCancelled()) throw new Error('CARD_REMOVED');

    // English fullname
    try {
      const raw = await this.readField(apduPerson.CMD_ENFULLNAME, 'nameEn', 'tis620');
      const parts = raw.split('#');
      info.nameEN = {
        prefix: parts[0] || '',
        firstname: parts[1] || '',
        middlename: parts[2] || '',
        lastname: parts[3] || '',
      };
    } catch (err) {
      info.nameEN = null;
      info._errors.push({ field: 'nameEn', error: err.message });
      logger.error('Failed to read English name', { error: err.message });
    }
    if (isCancelled()) throw new Error('CARD_REMOVED');

    // Date of birth
    try {
      const raw = await this.readField(apduPerson.CMD_BIRTH, 'dob');
      info.dob = `${+raw.slice(0, 4) - 543}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    } catch (err) {
      info.dob = null;
      info._errors.push({ field: 'dob', error: err.message });
    }
    if (isCancelled()) throw new Error('CARD_REMOVED');

    // Gender
    try {
      info.gender = await this.readField(apduPerson.CMD_GENDER, 'gender');
    } catch (err) {
      info.gender = null;
      info._errors.push({ field: 'gender', error: err.message });
    }
    if (isCancelled()) throw new Error('CARD_REMOVED');

    // Issuer
    try {
      info.issuer = await this.readField(apduPerson.CMD_ISSUER, 'issuer', 'tis620');
    } catch (err) {
      info.issuer = null;
      info._errors.push({ field: 'issuer', error: err.message });
    }

    // Issue date
    try {
      const raw = await this.readField(apduPerson.CMD_ISSUE, 'issueDate');
      info.issueDate = `${+raw.slice(0, 4) - 543}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    } catch (err) {
      info.issueDate = null;
      info._errors.push({ field: 'issueDate', error: err.message });
    }

    // Expire date
    try {
      const raw = await this.readField(apduPerson.CMD_EXPIRE, 'expireDate');
      info.expireDate = `${+raw.slice(0, 4) - 543}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    } catch (err) {
      info.expireDate = null;
      info._errors.push({ field: 'expireDate', error: err.message });
    }
    if (isCancelled()) throw new Error('CARD_REMOVED');

    // Address
    try {
      const raw = await this.readField(apduPerson.CMD_ADDRESS, 'address', 'tis620');
      const parts = raw.split('#');
      info.address = {
        houseNo: parts[0] || '',
        moo: (parts[1] && parts[1].startsWith('หมู่ที่') ? parts[1].substring(7) : '').trim(),
        soi: (parts[1] && parts[1].startsWith('ซอย') ? parts[1].substring(3) : '').trim(),
        street: parts.slice(2, -3).join(' ').trim(),
        subdistrict: parts[parts.length - 3] ? parts[parts.length - 3].substring(4).trim() : '',
        district: parts[parts.length - 2]
          ? (parts[parts.length - 2].substring(0, 3) === 'เขต'
            ? parts[parts.length - 2].substring(3).trim()
            : parts[parts.length - 2].substring(5).trim())
          : '',
        province: parts[parts.length - 1] ? parts[parts.length - 1].trim() : '',
      };
    } catch (err) {
      info.address = null;
      info._errors.push({ field: 'address', error: err.message });
    }
    if (isCancelled()) throw new Error('CARD_REMOVED');

    // Photo (20 chunks) - retry per chunk, don't break on single chunk failure
    try {
      const photoCommands = [
        apduPerson.CMD_PHOTO1, apduPerson.CMD_PHOTO2, apduPerson.CMD_PHOTO3,
        apduPerson.CMD_PHOTO4, apduPerson.CMD_PHOTO5, apduPerson.CMD_PHOTO6,
        apduPerson.CMD_PHOTO7, apduPerson.CMD_PHOTO8, apduPerson.CMD_PHOTO9,
        apduPerson.CMD_PHOTO10, apduPerson.CMD_PHOTO11, apduPerson.CMD_PHOTO12,
        apduPerson.CMD_PHOTO13, apduPerson.CMD_PHOTO14, apduPerson.CMD_PHOTO15,
        apduPerson.CMD_PHOTO16, apduPerson.CMD_PHOTO17, apduPerson.CMD_PHOTO18,
        apduPerson.CMD_PHOTO19, apduPerson.CMD_PHOTO20,
      ];
      let photo = '';
      for (let i = 0; i < photoCommands.length; i++) {
        if (isCancelled()) throw new Error('CARD_REMOVED');
        const data = await this.readRawField(photoCommands[i]);
        photo += data.toString('hex').slice(0, -4);
      }
      info.photo = photo.length > 0 ? Buffer.from(photo, 'hex').toString('base64') : null;
    } catch (err) {
      if (err.message === 'CARD_REMOVED') throw err;
      info.photo = null;
      info._errors.push({ field: 'photo', error: err.message });
    }

    if (info._errors.length > 0) {
      logger.warn('Some fields had errors', { errors: info._errors });
    }

    return info;
  }
}

module.exports = PersonalApplet;
