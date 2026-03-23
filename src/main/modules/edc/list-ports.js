const { execFile } = require('child_process');

/**
 * List available serial ports with SerialPort.list() fallback to OS commands.
 * Returns array of { path, friendlyName } objects.
 */
async function listSerialPorts() {
  try {
    const { SerialPort } = require('serialport');
    return await SerialPort.list();
  } catch (_) {
    // SerialPort.list() failed — fall back to OS-specific commands
  }

  if (process.platform === 'win32') {
    return listPortsWmic();
  }
  if (process.platform === 'darwin') {
    return listPortsMac();
  }
  return [];
}

function listPortsWmic() {
  return new Promise((resolve) => {
    execFile(
      'wmic',
      ['path', 'Win32_PnPEntity', 'where', "Name like '%(COM%'", 'get', 'Name', '/format:csv'],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        const ports = [];
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('Node')) continue;
          // CSV format: Node,Name — we want the Name column
          const cols = trimmed.split(',');
          const name = cols.slice(1).join(',').trim();
          if (!name) continue;
          const match = name.match(/\((COM\d+)\)/);
          if (match) {
            ports.push({ path: match[1], friendlyName: name });
          }
        }
        resolve(ports);
      }
    );
  });
}

function listPortsMac() {
  return new Promise((resolve) => {
    execFile('ls', ['/dev/cu.*'], { shell: true }, (err, stdout) => {
      if (err) return resolve([]);
      const ports = stdout
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(path => ({ path, friendlyName: path }));
      resolve(ports);
    });
  });
}

module.exports = { listSerialPorts };
