const fs = require('fs');
const path = require('path');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const RETENTION_DAYS = 30;

let logsDir = null;

function ensureLogsDir() {
  if (!logsDir) {
    try {
      const { app } = require('electron');
      logsDir = path.join(app.getPath('userData'), 'logs');
    } catch {
      logsDir = path.join(process.cwd(), 'logs');
    }
  }
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function getDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getTimestamp() {
  return new Date().toISOString();
}

function rotateAndCleanup(logFile) {
  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > MAX_FILE_SIZE) {
        const rotated = logFile + '.' + Date.now() + '.old';
        fs.renameSync(logFile, rotated);
      }
    }
    // Cleanup old files
    const dir = ensureLogsDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (stats.mtime.getTime() < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error('Log rotation error:', err.message);
  }
}

function writeToFile(logFile, line) {
  try {
    rotateAndCleanup(logFile);
    fs.appendFileSync(logFile, line + '\n');
  } catch (err) {
    console.error('Log write error:', err.message);
  }
}

function createLogger(moduleName) {
  const makeLog = (level) => (message, data) => {
    const entry = {
      timestamp: getTimestamp(),
      level,
      module: moduleName,
      message,
      ...(data !== undefined ? { data } : {})
    };
    const line = JSON.stringify(entry);
    const logFile = path.join(ensureLogsDir(), `${getDateString()}.log`);
    writeToFile(logFile, line);
    if (level === 'error') {
      console.error(`[${moduleName}] ${message}`, data || '');
    } else if (level === 'warn') {
      console.warn(`[${moduleName}] ${message}`, data || '');
    } else {
      console.log(`[${moduleName}] ${message}`, data || '');
    }
  };

  return {
    info: makeLog('info'),
    warn: makeLog('warn'),
    error: makeLog('error'),
    debug: makeLog('debug'),
    transaction: (data) => {
      const entry = {
        timestamp: getTimestamp(),
        module: moduleName,
        ...data
      };
      const logFile = path.join(ensureLogsDir(), 'edc-transactions.log');
      writeToFile(logFile, JSON.stringify(entry));
    }
  };
}

module.exports = { createLogger };
