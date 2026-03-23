const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Settings
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (section, value) => ipcRenderer.invoke('save-config', section, value),

  // Card Reader
  readCard: () => ipcRenderer.invoke('read-card'),

  // EDC
  listSerialPorts: () => ipcRenderer.invoke('list-serial-ports'),
  edcTransaction: (txCode, data) => ipcRenderer.invoke('edc-transaction', txCode, data),

  // Logs
  getLogs: () => ipcRenderer.invoke('get-logs'),

  // App
  getVersion: () => ipcRenderer.invoke('app-version'),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

  // Events
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_, data) => cb(data)),
  onEvent: (cb) => ipcRenderer.on('bridge-event', (_, data) => cb(data)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
