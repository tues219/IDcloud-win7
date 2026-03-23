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
  renderQueue(status);
});

const STATUS_LABELS = {
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
    } else if (module === 'edc' && status === 'connected') {
      // Restore port name when EDC reconnects
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
    updateStatus('xray', status.xray.fileWatcher.isWatching ? 'connected' : 'disconnected');
    // ws status — always running if we got here
    updateStatus('ws', 'connected');
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

function showLoginView() {
  document.getElementById('xray-login').style.display = '';
  document.getElementById('xray-branch-select').style.display = 'none';
  document.getElementById('xray-authenticated').style.display = 'none';
  document.getElementById('xray-login-error').textContent = '';
}

function showBranchSelectView(user, clinics) {
  currentUser = user;
  document.getElementById('xray-login').style.display = 'none';
  document.getElementById('xray-branch-select').style.display = '';
  document.getElementById('xray-authenticated').style.display = 'none';
  document.getElementById('xray-branch-user-email').textContent = user?.email || '';

  // Auto-select if only 1 clinic with 1 branch
  if (clinics.length === 1 && clinics[0].branches && clinics[0].branches.length === 1) {
    const clinic = clinics[0];
    const branch = clinic.branches[0];
    selectBranch(clinic.code, branch.code);
    return;
  }

  document.getElementById('clinic-list').innerHTML = renderClinicList(clinics);
  attachBranchHandlers();
}

function showAuthenticatedView(user) {
  currentUser = user;
  document.getElementById('xray-login').style.display = 'none';
  document.getElementById('xray-branch-select').style.display = 'none';
  document.getElementById('xray-authenticated').style.display = '';
  document.getElementById('xray-user-email').textContent = user?.email || '';
}

function renderClinicList(clinics) {
  if (!clinics || clinics.length === 0) {
    return '<div class="no-results">No clinics available</div>';
  }
  return clinics.map(clinic => `
    <div class="clinic-card">
      <div class="clinic-name">${esc(clinic.name || clinic.code)}</div>
      <div class="branch-list">
        ${(clinic.branches || []).map(branch => `
          <button class="branch-btn" data-clinic="${esc(clinic.code)}" data-branch="${esc(branch.code)}">
            ${esc(branch.name || branch.code)}
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function attachBranchHandlers() {
  document.querySelectorAll('.branch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectBranch(btn.dataset.clinic, btn.dataset.branch);
    });
  });
}

async function selectBranch(clinicCode, branchCode) {
  const btn = document.querySelector(`.branch-btn[data-clinic="${clinicCode}"][data-branch="${branchCode}"]`);
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
  }
  try {
    const result = await bridge.selectBranch(`${clinicCode}/${branchCode}`);
    if (result.success) {
      showAuthenticatedView(currentUser);
      addLog('info', 'xray', `Branch selected: ${clinicCode}/${branchCode}`);
    } else {
      addLog('error', 'xray', `Branch selection failed: ${result.error}`);
    }
  } catch (err) {
    addLog('error', 'xray', `Branch selection failed: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

// Check auth status on load
bridge.getAuthStatus().then(async (status) => {
  if (status.authenticated && status.user) {
    if (status.hasBranch) {
      showAuthenticatedView(status.user);
    } else {
      const clinicResult = await bridge.getClinicList();
      if (clinicResult.success && clinicResult.clinics && clinicResult.clinics.length > 0) {
        showBranchSelectView(status.user, clinicResult.clinics);
      } else {
        showAuthenticatedView(status.user);
      }
    }
  } else {
    showLoginView();
  }
});

// Pre-fill email from config
bridge.getConfig().then(config => {
  if (config.xray && config.xray.email) {
    document.getElementById('xray-email').value = config.xray.email;
  }
});

document.getElementById('btn-xray-login').addEventListener('click', async () => {
  const email = document.getElementById('xray-email').value.trim();
  const password = document.getElementById('xray-password').value;
  const errorEl = document.getElementById('xray-login-error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password';
    return;
  }

  const loginBtn = document.getElementById('btn-xray-login');
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<span class="spinner"></span>Signing in...';

  try {
    const result = await bridge.login({ email, password });
    if (result.success) {
      const config = await bridge.getConfig();
      const xrayConfig = config.xray || {};
      xrayConfig.email = email;
      await bridge.saveConfig('xray', xrayConfig);
      addLog('info', 'xray', 'Signed in successfully');

      if (result.clinics && result.clinics.length > 0) {
        showBranchSelectView(result.user, result.clinics);
      } else {
        showAuthenticatedView(result.user);
      }
    } else {
      errorEl.textContent = result.error || 'Login failed';
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Login failed';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

document.getElementById('btn-xray-logout').addEventListener('click', async () => {
  await bridge.logout();
  showLoginView();
  document.getElementById('xray-password').value = '';
  addLog('info', 'xray', 'Signed out');
});

document.getElementById('btn-branch-logout').addEventListener('click', async () => {
  await bridge.logout();
  showLoginView();
  document.getElementById('xray-password').value = '';
  addLog('info', 'xray', 'Signed out');
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
  const files = Array.from(e.dataTransfer.files).map(f => f.path);
  if (files.length > 0) {
    await bridge.dropFiles(files);
    addLog('info', 'xray', `Dropped ${files.length} file(s)`);
  }
});

let currentQueueItems = [];

function renderQueue(status) {
  const statsEl = document.getElementById('queue-stats');
  const chips = [
    { label: 'Pending', value: status.pending },
    { label: 'Processing', value: status.processing },
    { label: 'Completed', value: status.completed },
    { label: 'Failed', value: status.failed },
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
    return `
      <div class="file-item">
        <span>${esc(item.fileInfo.name)}${dicomInfo}</span>
        <span class="file-status ${esc(item.status)}">${esc(item.status)}${item.error ? ': ' + esc(item.error) : ''}${assignBtn}</span>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.btn-assign').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = parseFloat(btn.dataset.id);
      const item = currentQueueItems.find(i => i.id === itemId);
      if (item) openAssignPanel(item);
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
  const fileInfo = document.getElementById('assign-file-info');
  const dnInput = document.getElementById('assign-dn');
  const resultEl = document.getElementById('assign-result');
  const actionsEl = document.getElementById('assign-actions');

  let info = `<strong>File:</strong> ${esc(item.fileInfo.name)}`;
  if (item.metadata && item.metadata.patientNameFormatted) {
    info += `<br><strong>DICOM Patient:</strong> ${esc(item.metadata.patientNameFormatted)}`;
  }
  if (item.metadata && item.metadata.patientId) {
    info += ` | <strong>DN:</strong> ${esc(item.metadata.patientId)}`;
  }
  if (item.matchInfo && item.matchInfo.reason) {
    info += `<br><strong>Reason:</strong> ${esc(item.matchInfo.reason)}`;
  }
  fileInfo.innerHTML = info;

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
      <div class="patient-name">${esc(p.fullName || ((p.firstNameEn || '') + ' ' + (p.lastNameEn || '')).trim() || 'Unknown')}</div>
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
