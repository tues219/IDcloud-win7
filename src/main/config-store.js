const Store = require('electron-store');

const schema = {
  edc: {
    type: 'object',
    properties: {
      comPort: { type: 'string', default: '' },
      baudRate: { type: 'number', default: 9600 },
      dataBits: { type: 'number', default: 8 },
      stopBits: { type: 'number', default: 1 },
      parity: { type: 'string', default: 'none' },
      retryCount: { type: 'number', default: 3 },
      ackTimeout: { type: 'number', default: 5000 },
      responseTimeout: { type: 'number', default: 60000 }
    },
    default: {}
  },
  ws: {
    type: 'object',
    properties: {
      port: { type: 'number', default: 9900 },
      legacyCardPort: { type: 'number', default: 8088 },
      legacyEdcPort: { type: 'number', default: 5000 }
    },
    default: {}
  },
  app: {
    type: 'object',
    properties: {
      minimizeToTray: { type: 'boolean', default: true },
      autoStart: { type: 'boolean', default: false }
    },
    default: {}
  }
};

let store = null;

function getStore() {
  if (!store) {
    store = new Store({ schema });
  }
  return store;
}

function getConfig(section) {
  const s = getStore();
  if (section) return s.get(section);
  return s.store;
}

function setConfig(section, value) {
  const s = getStore();
  s.set(section, value);
}

module.exports = { getConfig, setConfig, getStore };
