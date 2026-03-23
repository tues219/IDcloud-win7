const { app, BrowserWindow, ipcMain, dialog, powerMonitor, Menu } = require('electron');
const path = require('path');
const net = require('net');
const { createLogger } = require('./logger');
const { getConfig, setConfig, saveCredential, loadCredential } = require('./config-store');
const { createTray, showNotification, destroyTray } = require('./tray');
const CardReaderModule = require('./modules/card-reader');
const EdcInterface = require('./modules/edc');
const FileWatcher = require('./modules/xray/file-watcher');
const DicomProcessor = require('./modules/xray/dicom-processor');
const ImageProcessor = require('./modules/xray/image-processor');
const UploadQueue = require('./modules/xray/upload-queue');
const AuthManager = require('./modules/xray/auth-manager');
const WsServer = require('../ws-server');

const logger = createLogger('main');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.warn('Another instance is running, quitting');
  app.quit();
}

let mainWindow = null;

// Modules
const cardLogger = createLogger('card-reader');
const edcLogger = createLogger('edc');
const xrayLogger = createLogger('xray');

const cardReader = new CardReaderModule(cardLogger, getConfig('cardReader'));
const edc = new EdcInterface(getConfig('edc'), edcLogger);
const fileWatcher = new FileWatcher(xrayLogger);
const dicomProcessor = new DicomProcessor(xrayLogger);
const imageProcessor = new ImageProcessor(xrayLogger);
const uploadQueue = new UploadQueue(xrayLogger);
const authManager = new AuthManager(xrayLogger, { getConfig, saveCredential, loadCredential });
const wsServer = new WsServer({ cardReader, edc });

uploadQueue.setAuthManager(authManager);

// File detection handler
fileWatcher.setFileDetectedHandler(async (fileInfo) => {
  let result;
  if (fileInfo.fileType === 'dicom') {
    result = await dicomProcessor.processDicomFile(fileInfo.path);
  } else {
    result = await imageProcessor.processImageFile(fileInfo.path);
  }

  if (result.success) {
    uploadQueue.addToQueue(fileInfo, result.metadata);
    if (mainWindow) {
      mainWindow.webContents.send('bridge-event', { type: 'file-detected', fileInfo, metadata: result.metadata });
    }
  }
});

// Queue events
uploadQueue.on('queue-updated', (status) => {
  if (mainWindow) mainWindow.webContents.send('queue-updated', status);
});

// Card reader events
cardReader.on('status', (data) => {
  if (mainWindow) mainWindow.webContents.send('status-update', { module: 'cardReader', ...data });
  if (data.status === 'disconnected') showNotification('Card Reader', 'Reader disconnected');
});
cardReader.on('card-data', (data) => {
  if (mainWindow) mainWindow.webContents.send('bridge-event', { type: 'card-data', data });
});

// EDC events
edc.on('status', (data) => {
  if (mainWindow) mainWindow.webContents.send('status-update', { module: 'edc', ...data });
  if (data.status === 'disconnected') showNotification('EDC', 'EDC disconnected');
});

// Port conflict check
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Minimize to tray on close
  mainWindow.on('close', (e) => {
    if (!app.isQuitting && getConfig('app').minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// IPC Handlers
ipcMain.handle('get-status', () => ({
  cardReader: cardReader.getStatus(),
  edc: edc.getStatus(),
  xray: { fileWatcher: fileWatcher.getStatus(), queue: uploadQueue.getQueueStatus() },
  ws: { port: getConfig('ws').port || 9900 },
}));

ipcMain.handle('get-config', () => getConfig());
ipcMain.handle('save-config', (_, section, value) => {
  setConfig(section, value);
  return { success: true };
});

ipcMain.handle('read-card', () => cardReader.readCard());

ipcMain.handle('edc-transaction', async (_, txCode, data) => {
  return edc.processTransaction(txCode, data);
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Watch Folder',
  });
  if (result.canceled) return { success: false, canceled: true };
  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle('start-watching', (_, folder) => fileWatcher.startWatching(folder));
ipcMain.handle('stop-watching', () => fileWatcher.stopWatching());
ipcMain.handle('get-upload-queue', () => uploadQueue.getQueueStatus());

ipcMain.handle('drop-files', async (_, filePaths) => {
  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    const isDicom = ['.dcm', '.dicom'].includes(ext);
    const fileInfo = {
      path: filePath,
      name: path.basename(filePath),
      extension: ext,
      fileType: isDicom ? 'dicom' : 'image',
      detectedAt: new Date().toISOString(),
    };
    let result;
    if (isDicom) {
      result = await dicomProcessor.processDicomFile(filePath);
    } else {
      result = await imageProcessor.processImageFile(filePath);
    }
    if (result.success) uploadQueue.addToQueue(fileInfo, result.metadata);
  }
  return { success: true };
});

ipcMain.handle('lookup-patient', (_, dn) => authManager.searchPatientByDN(dn));
ipcMain.handle('assign-patient', (_, queueItemId, patientInfo) => uploadQueue.assignPatientDN(queueItemId, patientInfo));

ipcMain.handle('auth-login', async (_, creds) => {
  const result = await authManager.login(creds);
  if (result.success) {
    const clinics = await authManager.getClinicList();
    result.clinics = clinics.clinics || [];
  }
  return result;
});
ipcMain.handle('auth-logout', () => { authManager.logout(); return { success: true }; });
ipcMain.handle('auth-status', () => ({
  authenticated: authManager.isAuthenticated(),
  user: authManager.userInfo,
  hasBranch: !!(authManager.clinicInfo && authManager.branchInfo),
}));
ipcMain.handle('get-clinic-list', () => authManager.getClinicList());
ipcMain.handle('select-branch', async (_, clinicBranchURL) => {
  const result = await authManager.validateConfiguration(clinicBranchURL);
  if (result.success) {
    const xrayConfig = getConfig('xray');
    setConfig('xray', { ...xrayConfig, clinicBranchURL });
  }
  return result;
});
ipcMain.handle('get-logs', async () => {
  const fs = require('fs');
  const logsDir = path.join(app.getPath('userData'), 'logs');
  try {
    if (!fs.existsSync(logsDir)) return [];
    const files = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.log') && !f.includes('edc-transactions'))
      .sort()
      .reverse()
      .slice(0, 7); // read last 7 days of log files
    const entries = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line));
        } catch { /* skip malformed lines */ }
      }
    }
    // Sort newest first, cap at 200
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return entries.slice(0, 200);
  } catch (err) {
    logger.error('Failed to read logs', { error: err.message });
    return [];
  }
});
ipcMain.handle('list-serial-ports', async () => {
  const { SerialPort } = require('serialport');
  return SerialPort.list();
});

ipcMain.handle('app-version', () => app.getVersion());

ipcMain.handle('get-auto-start', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('set-auto-start', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  setConfig('app', { ...getConfig('app'), autoStart: enabled });
  return { success: true };
});

// App lifecycle
async function initModules() {
  try {
    await cardReader.init();
  } catch (err) {
    logger.error('Card reader init failed (non-fatal)', { error: err.message });
  }

  try {
    let edcConfig = getConfig('edc');
    if (!edcConfig.comPort) {
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      const quectelPorts = ports.filter(p => p.friendlyName && p.friendlyName.includes('Quectel USB AT Port'));
      const quectel = quectelPorts.length ? quectelPorts[quectelPorts.length - 1] : null;
      if (quectel) {
        setConfig('edc', { ...edcConfig, comPort: quectel.path });
        edcConfig = getConfig('edc');
        edc.config = edcConfig;
        logger.info('Auto-detected Quectel USB AT Port', { port: quectel.path });
      }
    }
    if (edcConfig.comPort) await edc.init();
  } catch (err) {
    logger.error('EDC init failed (non-fatal)', { error: err.message });
  }

  const wsPort = getConfig('ws').port || 9900;
  const portAvailable = await checkPort(wsPort);
  if (portAvailable) {
    wsServer.start(wsPort);
  } else {
    logger.error(`Port ${wsPort} is in use`);
  }

  // Auto-login if saved credentials exist
  const xrayConfig = getConfig('xray');
  if (xrayConfig.email) {
    try {
      const password = loadCredential('xray-password');
      if (password) {
        await authManager.login({ email: xrayConfig.email, password });
        if (xrayConfig.clinicBranchURL) {
          await authManager.validateConfiguration(xrayConfig.clinicBranchURL);
        }
        logger.info('Auto-login successful', { email: xrayConfig.email });
      }
    } catch (err) {
      logger.error('Auto-login failed (non-fatal)', { error: err.message });
    }
  }

  // Auto-start watching if configured
  if (xrayConfig.watchFolder) {
    try {
      await fileWatcher.startWatching(xrayConfig.watchFolder);
    } catch (err) {
      logger.error('Auto-watch failed', { error: err.message });
    }
  }
}

app.whenReady().then(async () => {
  createWindow();
  createTray(mainWindow, logger);

  // Apply auto-start setting
  const appConfig = getConfig('app');
  app.setLoginItemSettings({ openAtLogin: !!appConfig.autoStart });

  await initModules();

  // Lifecycle: suspend/resume
  powerMonitor.on('suspend', async () => {
    logger.info('System suspending, cleaning up');
    await cardReader.destroy();
    await edc.destroy();
  });

  powerMonitor.on('resume', async () => {
    logger.info('System resuming, reinitializing');
    try { await cardReader.init(); } catch (err) { logger.error('Card reader reinit failed', { error: err.message }); }
    try {
      edc.config = getConfig('edc');
      if (edc.config.comPort) await edc.init();
    } catch (err) { logger.error('EDC reinit failed', { error: err.message }); }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  wsServer.stop();
  await cardReader.destroy();
  await edc.destroy();
  await fileWatcher.stopWatching();
  destroyTray();
  logger.info('Application shutting down');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
