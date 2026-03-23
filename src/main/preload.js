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

  // Xray
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startWatching: (folder) => ipcRenderer.invoke('start-watching', folder),
  stopWatching: () => ipcRenderer.invoke('stop-watching'),
  getUploadQueue: () => ipcRenderer.invoke('get-upload-queue'),
  dropFiles: (files) => ipcRenderer.invoke('drop-files', files),
  lookupPatient: (dn) => ipcRenderer.invoke('lookup-patient', dn),
  assignPatient: (queueItemId, patientInfo) => ipcRenderer.invoke('assign-patient', queueItemId, patientInfo),

  // Auth
  login: (credentials) => ipcRenderer.invoke('auth-login', credentials),
  logout: () => ipcRenderer.invoke('auth-logout'),
  getAuthStatus: () => ipcRenderer.invoke('auth-status'),
  getClinicList: () => ipcRenderer.invoke('get-clinic-list'),
  selectBranch: (clinicBranchURL) => ipcRenderer.invoke('select-branch', clinicBranchURL),

  // Logs
  getLogs: () => ipcRenderer.invoke('get-logs'),

  // App
  getVersion: () => ipcRenderer.invoke('app-version'),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // Events
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_, data) => cb(data)),
  onEvent: (cb) => ipcRenderer.on('bridge-event', (_, data) => cb(data)),
  onQueueUpdate: (cb) => ipcRenderer.on('queue-updated', (_, data) => cb(data)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
