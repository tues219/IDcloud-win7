const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;

const DICOM_EXTENSIONS = ['.dcm', '.DCM', '.dicom', '.DICOM'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.JPG', '.JPEG', '.png', '.PNG'];
const ALL_EXTENSIONS = [...DICOM_EXTENSIONS, ...IMAGE_EXTENSIONS];

class FileWatcher {
  constructor(logger) {
    this.logger = logger;
    this.watcher = null;
    this.watchPath = null;
    this.isWatching = false;
    this.onFileDetected = null;
  }

  setFileDetectedHandler(handler) {
    this.onFileDetected = handler;
  }

  async startWatching(folderPath) {
    if (this.watcher) {
      await this.stopWatching();
    }

    const stats = await fs.stat(folderPath);
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory');
    }

    this.watchPath = folderPath;
    const normalizedPath = folderPath.replace(/\\/g, '/');

    this.logger.info('Starting file watcher', { path: folderPath });

    this.watcher = chokidar.watch(normalizedPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    });

    this.watcher
      .on('add', (filePath) => {
        const ext = path.extname(filePath);
        if (ALL_EXTENSIONS.includes(ext)) {
          this._handleFile(filePath);
        }
      })
      .on('error', (err) => this.logger.error('Watcher error', { error: err.message }))
      .on('ready', async () => {
        this.isWatching = true;
        this.logger.info('File watcher ready');
        await this._scanExisting(folderPath);
      });

    return { success: true, message: `Started watching: ${folderPath}` };
  }

  async _handleFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const fileType = DICOM_EXTENSIONS.map(e => e.toLowerCase()).includes(ext) ? 'dicom' : 'image';

      const fileInfo = {
        path: filePath,
        name: path.basename(filePath),
        size: stats.size,
        extension: ext,
        fileType,
        detectedAt: new Date().toISOString(),
      };

      this.logger.info('File detected', { name: fileInfo.name, type: fileType });
      if (this.onFileDetected) this.onFileDetected(fileInfo);
    } catch (err) {
      this.logger.error('Error processing file', { path: filePath, error: err.message });
    }
  }

  async _scanExisting(folderPath) {
    const maxAge = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;
    let count = 0;

    const scanDir = async (dir, depth = 0) => {
      if (depth > 2) return;
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await scanDir(fullPath, depth + 1);
        } else if (item.isFile()) {
          const ext = path.extname(item.name);
          if (ALL_EXTENSIONS.includes(ext)) {
            const stats = await fs.stat(fullPath);
            if (stats.mtime.getTime() > cutoff) {
              await this._handleFile(fullPath);
              count++;
            }
          }
        }
      }
    };

    try {
      await scanDir(folderPath);
      this.logger.info(`Initial scan complete, ${count} recent files found`);
    } catch (err) {
      this.logger.error('Initial scan failed', { error: err.message });
    }
  }

  async stopWatching() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
      this.watchPath = null;
      this.logger.info('File watcher stopped');
    }
    return { success: true };
  }

  getStatus() {
    return { isWatching: this.isWatching, watchPath: this.watchPath };
  }
}

module.exports = FileWatcher;
