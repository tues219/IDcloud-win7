const { contextBridge, ipcRenderer, webUtils } = require('electron');

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

  // Xray
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startWatching: (folder) => ipcRenderer.invoke('start-watching', folder),
  stopWatching: () => ipcRenderer.invoke('stop-watching'),
  getUploadQueue: () => ipcRenderer.invoke('get-upload-queue'),
  dropFiles: (files) => ipcRenderer.invoke('drop-files', files),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  lookupPatient: (dn) => ipcRenderer.invoke('lookup-patient', dn),
  assignPatient: (queueItemId, patientInfo) => ipcRenderer.invoke('assign-patient', queueItemId, patientInfo),
  retryUpload: (queueItemId) => ipcRenderer.invoke('retry-upload', queueItemId),
  getFilePreview: (filePath) => ipcRenderer.invoke('get-file-preview', filePath),

  // Auth (Device API Key)
  saveApiKey: (params) => ipcRenderer.invoke('save-api-key', params),
  disconnectDevice: () => ipcRenderer.invoke('disconnect-device'),
  getAuthStatus: () => ipcRenderer.invoke('auth-status'),

  // Logs
  getLogs: () => ipcRenderer.invoke('get-logs'),

  // App
  getVersion: () => ipcRenderer.invoke('app-version'),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // Auto-Update
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),

  // Events
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_, data) => cb(data)),
  onEvent: (cb) => ipcRenderer.on('bridge-event', (_, data) => cb(data)),
  onQueueUpdate: (cb) => ipcRenderer.on('queue-updated', (_, data) => cb(data)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
