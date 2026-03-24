const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

function initAutoUpdater(mainWindow, logger, showNotification) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  function sendStatus(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', payload);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for update');
  });

  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version });
    sendStatus({ status: 'available', version: info.version });
    showNotification('Update Available', `Version ${info.version} is ready to download`);
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('No update available');
    sendStatus({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ status: 'downloading', percent: progress.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded', { version: info.version });
    sendStatus({ status: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    logger.error('Auto-update error', { error: err.message });
    sendStatus({ status: 'error', message: err.message });
  });

  // IPC handlers
  ipcMain.handle('update-check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('update-download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update-install', () => autoUpdater.quitAndInstall());

  // Check 10s after launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates(), 10_000);
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}

module.exports = { initAutoUpdater };
