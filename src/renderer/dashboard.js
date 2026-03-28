// IIFE to avoid "already declared" errors on page reload
;(function() {
const bridge = window.bridge;
const eventLog = [];
let activeFilter = 'all';
let persistedLogsLoaded = false;

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');

    // Load persisted logs when Event Log tab is first shown
    if (tab.dataset.tab === 'log' && !persistedLogsLoaded) {
      loadPersistedLogs();
    }
  });
});

// Version
bridge.getVersion().then(v => {
  document.getElementById('version').textContent = `v${v}`;
});

// Auto-Update
bridge.onUpdateStatus((data) => {
  const banner = document.getElementById('update-banner');
  const msg = document.getElementById('update-message');
  const dlBtn = document.getElementById('btn-update-download');
  const installBtn = document.getElementById('btn-update-install');
  const progress = document.getElementById('update-progress');
  const progressBar = document.getElementById('update-progress-bar');

  switch (data.status) {
    case 'available':
      banner.style.display = '';
      msg.textContent = `Version ${data.version} is available`;
      dlBtn.style.display = '';
      installBtn.style.display = 'none';
      progress.style.display = 'none';
      break;
    case 'downloading':
      dlBtn.style.display = 'none';
      progress.style.display = '';
      progressBar.style.width = `${data.percent}%`;
      msg.textContent = `Downloading update... ${Math.round(data.percent)}%`;
      break;
    case 'downloaded':
      progress.style.display = 'none';
      installBtn.style.display = '';
      msg.textContent = `Version ${data.version} ready to install`;
      break;
    case 'error':
      banner.style.display = '';
      msg.textContent = 'Update check failed';
      setTimeout(() => banner.style.display = 'none', 5000);
      break;
  }
});

document.getElementById('btn-update-download').addEventListener('click', () => bridge.downloadUpdate());
document.getElementById('btn-update-install').addEventListener('click', () => bridge.installUpdate());
document.getElementById('btn-update-dismiss').addEventListener('click', () => {
  document.getElementById('update-banner').style.display = 'none';
});

// Status updates
bridge.onStatusUpdate((data) => {
  addLog('info', data.module, `Status: ${data.status}`);
  updateStatus(data.module, data.status, data.error);
});

bridge.onEvent((data) => {
  if (data.type === 'card-data') {
    addLog('info', 'cardReader', 'Card data received');
  }
});

const STATUS_LABELS = {
  'ready': 'Ready',
  'connected': 'Connected',
  'disconnected': 'Disconnected',
  'card-inserted': 'Card Inserted',
  'read-complete': 'Read Complete',
  'processing': 'Processing',
  'error': 'Error',
};

function updateStatus(module, status, error) {
  const elId = module === 'cardReader' ? 'card-reader' : module;

  // Update the status dot
  const dot = document.getElementById(`${elId}-dot`);
  if (dot) {
    dot.className = 'svc-dot ' + status;
  }

  // Update the state text
  const stateEl = document.getElementById(`${elId}-status`);
  if (stateEl) {
    stateEl.textContent = STATUS_LABELS[status] || status.charAt(0).toUpperCase() + status.slice(1);
  }

  const detail = document.getElementById(`${elId}-detail`);
  if (detail) {
    if (error) {
      detail.textContent = error;
    } else if (module === 'edc' && (status === 'connected' || status === 'ready')) {
      // Show port name when EDC is ready/connected
      bridge.getConfig().then(cfg => {
        if (cfg.edc && cfg.edc.comPort) detail.textContent = cfg.edc.comPort;
      });
    } else if (module !== 'edc') {
      detail.textContent = '';
    }
    // For EDC, preserve port detail when no error
  }

  // Toggle EDC gear visibility: hide when connected, show when disconnected
  if (module === 'edc') {
    const gear = document.getElementById('btn-edc-gear');
    const settings = document.getElementById('edc-settings');
    if (gear) {
      gear.style.display = (status === 'connected') ? 'none' : '';
    }
    // Collapse settings panel when connected
    if (settings && status === 'connected') {
      settings.classList.remove('open');
      if (gear) gear.classList.remove('open');
    }
  }
}

// Initial status fetch
async function refreshStatus() {
  try {
    const status = await bridge.getStatus();
    updateStatus('cardReader', status.cardReader.status);
    updateStatus('edc', status.edc.status);
    // ws status — always running if we got here
    updateStatus('ws', 'ready');
    if (status.xray.queue) renderQueue(status.xray.queue);
  } catch (err) {
    addLog('error', 'dashboard', err.message);
  }
}
refreshStatus();
setInterval(refreshStatus, 10000);

// ── Auto-Start Toggle ──
bridge.getAutoStart().then(enabled => {
  document.getElementById('chk-auto-start').checked = enabled;
});
document.getElementById('chk-auto-start').addEventListener('change', async (e) => {
  await bridge.setAutoStart(e.target.checked);
  addLog('info', 'settings', `Start on boot ${e.target.checked ? 'enabled' : 'disabled'}`);
});

// ── EDC Gear Toggle ──
document.getElementById('btn-edc-gear').addEventListener('click', () => {
  const settings = document.getElementById('edc-settings');
  const gear = document.getElementById('btn-edc-gear');
  settings.classList.toggle('open');
  gear.classList.toggle('open');
});

// ── Populate COM port dropdown ──
async function populateComPorts(selectedPort) {
  const select = document.getElementById('edc-com');
  const ports = await bridge.listSerialPorts();
  // Keep only the default placeholder
  select.innerHTML = '<option value="">Select port...</option>';
  ports.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.path + (p.friendlyName ? ` (${p.friendlyName})` : '');
    select.appendChild(opt);
  });
  if (selectedPort) {
    select.value = selectedPort;
  } else {
    // Auto-select Quectel USB AT Port
    const quectel = ports.find(p => p.friendlyName && p.friendlyName.includes('Quectel USB AT Port'));
    if (quectel) select.value = quectel.path;
  }
}

// ── Load Settings ──
async function loadSettings() {
  const config = await bridge.getConfig();
  if (config.edc) {
    await populateComPorts(config.edc.comPort || '');
    document.getElementById('edc-baud').value = config.edc.baudRate || 9600;
    if (config.edc.comPort) {
      document.getElementById('edc-detail').textContent = config.edc.comPort;
    }
  } else {
    await populateComPorts('');
  }
}
loadSettings();

// ── EDC Save (inline in dashboard card) ──
document.getElementById('btn-save-edc').addEventListener('click', async () => {
  const config = await bridge.getConfig();
  const edcConfig = config.edc || {};
  await bridge.saveConfig('edc', {
    ...edcConfig,
    comPort: document.getElementById('edc-com').value,
    baudRate: parseInt(document.getElementById('edc-baud').value),
  });
  addLog('info', 'settings', 'EDC settings saved');

});

// ── Event Log ──
function addLog(level, module, message) {
  const time = new Date().toLocaleTimeString();
  eventLog.unshift({ time, level, module, message });
  if (eventLog.length > 200) eventLog.pop();
  renderLog();
}

// ── Persistent Log Loading ──
async function loadPersistedLogs() {
  try {
    const logs = await bridge.getLogs();
    if (logs && logs.length > 0) {
      // Merge persisted logs (avoid duplicates by checking timestamp)
      const existingKeys = new Set(eventLog.map(e => e.time + e.module + e.message));
      for (const entry of logs) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const module = entry.module || 'system';
        const message = entry.message || '';
        if (!existingKeys.has(time + module + message)) {
          eventLog.push({ time, level: entry.level || 'info', module, message });
        }
      }
      if (eventLog.length > 200) eventLog.length = 200;
      renderLog();
    }
  } catch (err) {
    console.error('Failed to load persisted logs:', err);
  }
  persistedLogsLoaded = true;
}

// ── Log Filtering ──
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    renderLog();
  });
});

function renderLog() {
  const el = document.getElementById('event-log');
  let filtered = eventLog;

  if (activeFilter === 'error') {
    filtered = eventLog.filter(e => e.level === 'error');
  } else if (activeFilter !== 'all') {
    filtered = eventLog.filter(e => e.module === activeFilter);
  }

  el.innerHTML = filtered.slice(0, 200).map(e =>
    `<div class="log-entry ${esc(e.level)}"><span class="time">${esc(e.time)}</span> <span class="module">[${esc(e.module)}]</span> ${esc(e.message)}</div>`
  ).join('');
}


})();
