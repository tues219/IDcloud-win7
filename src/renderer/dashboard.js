// IIFE to avoid "already declared" errors on page reload
;(function() {
const bridge = window.bridge;
const eventLog = [];
let activeFilter = 'all';
let persistedLogsLoaded = false;

function showToast(message) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function shortError(msg) {
  if (!msg) return '';
  if (msg.includes('Not authenticated')) return 'Not authenticated';
  if (msg.includes('Patient search failed')) return 'Patient search failed';
  if (msg.includes('Presigned URL failed')) return 'Upload request failed';
  if (msg.includes('S3 upload failed')) return 'Upload failed';
  if (msg.length > 60) return msg.substring(0, 57) + '...';
  return msg;
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
      msg.textContent = data.message ? `Update check failed: ${data.message}` : 'Update check failed';
      dlBtn.style.display = 'none';
      installBtn.style.display = 'none';
      progress.style.display = 'none';
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
  if (data.type === 'file-detected') {
    addLog('info', 'xray', `File detected: ${data.fileInfo.name}`);
  }
});

bridge.onQueueUpdate((status) => {
  if (status) renderQueue(status);
});

const STATUS_LABELS = {
  'ready': 'Ready',
  'connected': 'Connected',
  'disconnected': 'Disconnected',
  'card-inserted': 'Card Inserted',
  'read-complete': 'Read Complete',
  'processing': 'Processing',
  'error': 'Error',
  'need-api-key': 'Need API Key',
  'need-watch-folder': 'Need Watch Folder',
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
  }

}

// Initial status fetch
async function refreshStatus() {
  try {
    const status = await bridge.getStatus();
    updateStatus('cardReader', status.cardReader.status);
    updateStatus('edc', status.edc.status);
    // Determine xray status based on both watcher and auth
    if (status.xray.fileWatcher.isWatching && status.xray.authenticated) {
      updateStatus('xray', 'connected');
    } else if (status.xray.fileWatcher.isWatching && !status.xray.authenticated) {
      updateStatus('xray', 'need-api-key');
    } else if (!status.xray.fileWatcher.isWatching && status.xray.authenticated) {
      updateStatus('xray', 'need-watch-folder');
    } else {
      updateStatus('xray', 'disconnected');
    }
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
  const msg = `Start on boot ${e.target.checked ? 'enabled' : 'disabled'}`;
  addLog('info', 'settings', msg);
  showToast(msg);
});

// ── EDC Gear Toggle ──
document.getElementById('btn-edc-gear').addEventListener('click', () => {
  const settings = document.getElementById('edc-settings');
  const gear = document.getElementById('btn-edc-gear');
  settings.classList.toggle('open');
  gear.classList.toggle('open');
});

// ── X-ray Config Toggle ──
document.getElementById('xray-config-toggle').addEventListener('click', () => {
  const body = document.getElementById('xray-config-body');
  const header = document.getElementById('xray-config-toggle');
  body.classList.toggle('open');
  header.classList.toggle('open');
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
  }
  // Fallback: if no port selected (none saved, or saved port not in list), auto-select Quectel
  if (!select.value) {
    const quectelPorts = ports.filter(p => p.friendlyName && p.friendlyName.includes('Quectel USB AT Port'));
    const quectel = quectelPorts.length ? quectelPorts[quectelPorts.length - 1] : null;
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
  if (config.xray) {
    document.getElementById('xray-folder').value = config.xray.watchFolder || '';
    document.getElementById('xray-api').value = config.xray.apiBaseUrl || '';
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
  showToast('EDC settings saved');

  const restart = confirm('EDC settings saved. The application needs to restart to apply changes.\n\nRestart now?');
  if (restart) {
    await bridge.restartApp();
  }
});

// ── X-ray Save (inline in X-ray tab) ──
document.getElementById('btn-save-xray').addEventListener('click', async () => {
  const config = await bridge.getConfig();
  const xrayConfig = config.xray || {};
  await bridge.saveConfig('xray', {
    ...xrayConfig,
    watchFolder: document.getElementById('xray-folder').value,
    apiBaseUrl: document.getElementById('xray-api').value,
  });
  addLog('info', 'settings', 'X-ray settings saved');
  showToast('X-ray settings saved');
});

// ── Folder Browse ──
document.getElementById('btn-select-folder').addEventListener('click', async () => {
  const result = await bridge.selectFolder();
  if (result.success) {
    document.getElementById('xray-folder').value = result.path;
  }
});

// ── Xray Auth ──
let currentUser = null;

function showConnectView() {
  document.getElementById('xray-connect').style.display = '';
  document.getElementById('xray-authenticated').style.display = 'none';
  document.getElementById('xray-connect-error').textContent = '';
}

function showConnectedView(device, branch) {
  document.getElementById('xray-connect').style.display = 'none';
  document.getElementById('xray-authenticated').style.display = '';
  document.getElementById('xray-device-name').textContent = device?.name || 'Device';
  document.getElementById('xray-branch-name').textContent = branch?.name || '';
}


// Check auth status on load
bridge.getAuthStatus().then(async (status) => {
  if (status.authenticated && status.device) {
    showConnectedView(status.device, status.branch);
  } else {
    showConnectView();
  }
});


document.getElementById('btn-xray-connect').addEventListener('click', async () => {
  const apiKey = document.getElementById('xray-api-key').value.trim();
  const errorEl = document.getElementById('xray-connect-error');
  errorEl.textContent = '';

  if (!apiKey) {
    errorEl.textContent = 'Please enter your API key';
    return;
  }

  const connectBtn = document.getElementById('btn-xray-connect');
  connectBtn.disabled = true;
  connectBtn.innerHTML = '<span class="spinner"></span>Connecting...';

  try {
    const result = await bridge.saveApiKey({ apiKey });
    if (result.success) {
      addLog('info', 'xray', `Connected as ${result.device?.name || 'device'}`);
      showToast(`Connected as ${result.device?.name || 'device'}`);
      showConnectedView(result.device, result.branch);
    } else {
      errorEl.textContent = result.error || 'Connection failed';
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Connection failed';
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
});

document.getElementById('btn-xray-disconnect').addEventListener('click', async () => {
  await bridge.disconnectDevice();
  showConnectView();
  document.getElementById('xray-api-key').value = '';
  addLog('info', 'xray', 'Disconnected');
  showToast('Disconnected');
});

// ── Drop Zone ──
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).map(f => bridge.getPathForFile(f)).filter(Boolean);
  if (files.length > 0) {
    await bridge.dropFiles(files);
    addLog('info', 'xray', `Dropped ${files.length} file(s)`);
  }
});

let currentQueueItems = [];

function renderQueue(status) {
  if (!status) return;
  const statsEl = document.getElementById('queue-stats');
  const chips = [
    { label: 'Pending', value: status.pending || 0 },
    { label: 'Processing', value: status.processing || 0 },
    { label: 'Completed', value: status.completed || 0 },
    { label: 'Failed', value: status.failed || 0 },
    { label: 'Awaiting', value: status.awaitingAssignment || 0 },
  ];
  statsEl.innerHTML = chips.map(c =>
    `<span class="stat-chip${c.value > 0 ? ' has-value' : ''}">${c.label}: ${c.value}</span>`
  ).join('');

  currentQueueItems = status.items || [];
  const listEl = document.getElementById('file-list');
  if (currentQueueItems.length === 0) {
    listEl.innerHTML = '<div class="file-item" style="color:var(--text-3)">No files in queue</div>';
    return;
  }
  listEl.innerHTML = currentQueueItems.map(item => {
    const dicomInfo = item.metadata && item.metadata.patientNameFormatted
      ? ` <span class="file-dicom-info">(${esc(item.metadata.patientNameFormatted)} / ${esc(item.metadata.patientId || '')})</span>`
      : '';
    const assignBtn = item.status === 'awaiting-assignment'
      ? ` <button class="btn-assign" data-id="${item.id}">Assign</button>`
      : '';
    const retryBtn = item.status === 'failed'
      ? ` <button class="btn-retry" data-id="${item.id}">Retry</button>`
      : '';
    const errorText = item.error ? ': ' + esc(shortError(item.error)) : '';
    return `
      <div class="file-item">
        <span>${esc(item.fileInfo.name)}${dicomInfo}</span>
        <span class="file-status ${esc(item.status)}">${esc(item.status)}${errorText}${assignBtn}${retryBtn}</span>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.btn-assign').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = parseFloat(btn.dataset.id);
      const item = currentQueueItems.find(i => i.id === itemId);
      if (item) openAssignPanel(item);
    });
  });

  listEl.querySelectorAll('.btn-retry').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Retrying...';
      await bridge.retryUpload(parseFloat(btn.dataset.id));
    });
  });
}

// ── Patient Assignment ──
let currentAssignItem = null;
let selectedPatient = null;

function openAssignPanel(item) {
  currentAssignItem = item;
  selectedPatient = null;
  const panel = document.getElementById('assign-panel');
  const previewEl = document.getElementById('assign-preview');
  const fileInfo = document.getElementById('assign-file-info');
  const dnInput = document.getElementById('assign-dn');
  const resultEl = document.getElementById('assign-result');
  const actionsEl = document.getElementById('assign-actions');

  // Render preview (left column)
  if (item.fileInfo.fileType === 'dicom') {
    const m = item.metadata || {};
    previewEl.innerHTML = `
      <div class="assign-metadata-card">
        <div class="metadata-icon"><i class="fa-solid fa-tooth"></i></div>
        <div class="metadata-field"><span class="metadata-label">PATIENT</span><span class="metadata-value">${esc(m.patientNameFormatted || m.patientName || 'Unknown')}</span></div>
        <div class="metadata-field"><span class="metadata-label">MODALITY</span><span class="metadata-value">${esc(m.modality || 'N/A')}</span></div>
        <div class="metadata-field"><span class="metadata-label">STUDY DATE</span><span class="metadata-value">${esc(m.studyDateFormatted || m.studyDate || 'N/A')}</span></div>
        <div class="metadata-field"><span class="metadata-label">DESCRIPTION</span><span class="metadata-value">${esc(m.studyDescription || m.seriesDescription || 'N/A')}</span></div>
      </div>
      <div class="assign-preview-filename">${esc(item.fileInfo.name)}</div>
      <div class="assign-preview-meta">DICOM &bull; ${formatFileSize(item.fileInfo.size)}</div>`;
  } else {
    const thumb = (item.metadata && item.metadata.thumbnail) || '';
    previewEl.innerHTML = `
      <img class="assign-thumbnail" src="${thumb}" alt="Preview" title="Click to enlarge">
      <div class="assign-preview-filename">${esc(item.fileInfo.name)}</div>
      <div class="assign-preview-meta">Photo &bull; ${formatFileSize(item.fileInfo.size)}</div>`;
    const thumbImg = previewEl.querySelector('.assign-thumbnail');
    if (thumbImg && thumb) {
      thumbImg.addEventListener('click', () => openPreviewModal(item));
    }
  }

  let info = '';
  if (item.matchInfo && item.matchInfo.reason) {
    info += `<strong>Reason:</strong> ${esc(item.matchInfo.reason)}`;
  }
  fileInfo.innerHTML = info;
  fileInfo.style.display = info ? '' : 'none';

  dnInput.value = (item.matchInfo && item.matchInfo.dicomPatientId) || (item.metadata && item.metadata.patientId) || '';

  if (item.matchInfo && item.matchInfo.searchResults && item.matchInfo.searchResults.length > 0) {
    resultEl.innerHTML = renderPatientResults(item.matchInfo.searchResults);
    attachPatientCardHandlers(resultEl);
  } else {
    resultEl.innerHTML = '';
  }

  actionsEl.style.display = 'none';
  panel.style.display = '';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── Preview Modal ──
async function openPreviewModal(item) {
  const modal = document.getElementById('preview-modal');
  const img = document.getElementById('preview-modal-img');
  const info = document.getElementById('preview-modal-info');

  img.src = '';
  info.textContent = 'Loading...';
  modal.style.display = 'flex';

  try {
    const result = await bridge.getFilePreview(item.fileInfo.path);
    if (result.success) {
      img.src = result.dataUrl;
      info.innerHTML = `${esc(item.fileInfo.name)} &bull; ${result.width} &times; ${result.height} &bull; ${formatFileSize(item.fileInfo.size)} &bull; ${esc(result.format || '').toUpperCase()}`;
    } else {
      info.textContent = 'Failed to load preview';
    }
  } catch {
    info.textContent = 'Failed to load preview';
  }
}

function closePreviewModal() {
  const modal = document.getElementById('preview-modal');
  modal.style.display = 'none';
  document.getElementById('preview-modal-img').src = '';
}

// Register modal close handlers (script runs after DOM is ready)
const previewModal = document.getElementById('preview-modal');
if (previewModal) {
  previewModal.querySelector('.preview-modal-backdrop').addEventListener('click', closePreviewModal);
  previewModal.querySelector('.preview-modal-close').addEventListener('click', closePreviewModal);
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePreviewModal();
});

function closeAssignPanel() {
  document.getElementById('assign-panel').style.display = 'none';
  document.getElementById('assign-result').innerHTML = '';
  document.getElementById('assign-actions').style.display = 'none';
  currentAssignItem = null;
  selectedPatient = null;
}

function renderPatientResults(patients) {
  if (!patients || patients.length === 0) return '<div class="no-results">No patients found</div>';
  return patients.map(p => `
    <div class="patient-card" data-id="${esc(String(p.id || ''))}" data-dn="${esc(p.dn || '')}">
      <div class="patient-name">${esc(p.name || p.fullName || ((p.firstNameEn || '') + ' ' + (p.lastNameEn || '')).trim() || 'Unknown')}</div>
      <div class="patient-dn">DN: ${esc(p.dn || 'N/A')}</div>
      <div class="patient-dob">${esc(p.dob || '')}</div>
    </div>
  `).join('');
}

function attachPatientCardHandlers(container) {
  container.querySelectorAll('.patient-card').forEach(card => {
    card.addEventListener('click', () => {
      container.querySelectorAll('.patient-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedPatient = {
        id: card.dataset.id,
        dn: card.dataset.dn,
      };
      document.getElementById('assign-actions').style.display = '';
    });
  });
}

document.getElementById('btn-lookup').addEventListener('click', async () => {
  const dn = document.getElementById('assign-dn').value.trim();
  if (!dn) return;
  const lookupBtn = document.getElementById('btn-lookup');
  lookupBtn.disabled = true;
  lookupBtn.innerHTML = '<span class="spinner"></span>Searching';
  const resultEl = document.getElementById('assign-result');
  resultEl.innerHTML = '<div class="no-results">Searching...</div>';
  try {
    const result = await bridge.lookupPatient(dn);
    if (result.success && result.patients && result.patients.length > 0) {
      resultEl.innerHTML = renderPatientResults(result.patients);
      attachPatientCardHandlers(resultEl);
    } else {
      resultEl.innerHTML = `<div class="no-results">${esc(result.error || 'No patient found')}</div>`;
    }
    document.getElementById('assign-actions').style.display = 'none';
    selectedPatient = null;
  } finally {
    lookupBtn.disabled = false;
    lookupBtn.textContent = 'Lookup';
  }
});

document.getElementById('btn-assign-confirm').addEventListener('click', async () => {
  if (!currentAssignItem || !selectedPatient) return;
  const result = await bridge.assignPatient(currentAssignItem.id, selectedPatient);
  if (result.success) {
    addLog('info', 'xray', `Assigned patient ${selectedPatient.dn} to ${currentAssignItem.fileInfo.name}`);
    closeAssignPanel();
  } else {
    addLog('error', 'xray', `Assignment failed: ${result.error}`);
  }
});

document.getElementById('btn-assign-cancel').addEventListener('click', () => {
  closeAssignPanel();
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
