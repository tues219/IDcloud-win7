const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;

function createTray(mainWindow, logger) {
  // Use a simple 16x16 icon or template
  let iconPath;
  try {
    iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  } catch {
    iconPath = null;
  }

  let icon;
  if (iconPath && require('fs').existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // Create a minimal icon
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('DentCloud Hardware Bridge');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('bridge-event', { type: 'show-settings' });
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

function showNotification(title, body) {
  if (process.platform === 'win32' && tray) {
    tray.displayBalloon({ iconType: 'info', title, content: body });
  } else {
    const { Notification } = require('electron');
    new Notification({ title, body }).show();
  }
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, showNotification, destroyTray };
