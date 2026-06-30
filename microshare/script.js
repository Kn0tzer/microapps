let shares = [];
let archivedShares = [];

let shareGrid, archivedList, archivedHeader, addButton, fileInput;
let settingsIcon, settingsOverlay, overlay, signInBtn, signOutBtn;
let dragOverlay;
let devicesList, globalToggle;
let incomingModal, incomingFrom, incomingFileName, incomingFileSize, incomingAcceptBtn, incomingDeclineBtn;
let warningModal, warningModalText, warningOkBtn;
let expiryModal, expiryModalSubtitle, expiryModalOptions;
let userhashInput, userhashTooltip, defaultOptions;
let _signingOut = false;
let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;
const SIZE_200MB = 200 * 1024 * 1024;
const SIZE_1GB = 1 * 1024 * 1024 * 1024;

const SETTINGS_SHARE_ID = '__settings__';

const LITTERBOX_TIMES = {
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
};

const TEMP_FILEDITCH_TIMES = {
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
};

let _pendingSendTarget = null;
let _uploadQueue = [];
let _isUploading = false;
let _currentXhr = null;
let _currentUploadCard = null;
let _lastRenderedShareIds = null;
let _pendingIncoming = null;
let _currentPeer = null;
let _ws = null;
let _wsReconnectTimer = null;
let _wsBackoff = 1000;
let _onlineDevices = [];
let _myPublicIp = '';
let _firstRender = true;
let _animateShareIds = new Set();
let _editingDeviceId = null;
let _draggedShare = null;
let _draggedShareEl = null;
let _lastBlobUrl = null;
let _animateArchivedIds = new Set();

const ARCHIVE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 7L12 16M12 16L15 12.6667M12 16L9 12.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const UNARCHIVE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21L12 12M12 12L15 15.3333M12 12L9 15.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z" stroke="currentColor" stroke-width="1.5"/></svg>';
const DOWNLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2V11M4 7L8 11L12 7M3 14H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEND_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8L14 3L11 14L8 9L2 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CANCEL_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 0) return 'ios';
  if (/Mac/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  if (/Android/.test(ua)) return 'android';
  if (/Linux/.test(ua)) return 'linux';
  return 'unknown';
}

function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'browser';
}

function defaultDeviceName() {
  return detectBrowser() + ' on ' + detectPlatform();
}

function getDeviceId() {
  let id = localStorage.getItem('microshare_device_id');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    localStorage.setItem('microshare_device_id', id);
  }
  return id;
}

function getDeviceName() {
  return localStorage.getItem('microshare_device_name') || defaultDeviceName();
}

function setDeviceName(name) {
  localStorage.setItem('microshare_device_name', name);
  sendWs({ type: 'rename', name });
  for (const d of _onlineDevices) {
    if (d.id === getDeviceId()) {
      d.name = name;
      break;
    }
  }
  renderDevices();
}

function getInGlobal() {
  return localStorage.getItem('microshare_in_global') === 'true';
}

function setInGlobal(value) {
  localStorage.setItem('microshare_in_global', String(value));
  sendWs({ type: 'toggleGlobal', inGlobal: value });
  for (const d of _onlineDevices) {
    if (d.id === getDeviceId()) {
      d.inGlobal = value;
      break;
    }
  }
  renderDevices();
}

function isMobileView() {
  return window.innerWidth <= 768;
}

document.addEventListener('DOMContentLoaded', () => {
  shareGrid = document.getElementById('shareGrid');
  archivedList = document.getElementById('archivedList');
  archivedHeader = document.getElementById('archivedHeader');
  addButton = document.getElementById('addButton');
  fileInput = document.getElementById('fileInput');
  settingsIcon = document.getElementById('settingsIcon');
  settingsOverlay = document.getElementById('settingsOverlay');
  overlay = document.getElementById('overlay');
  signInBtn = document.getElementById('signInBtn');
  signOutBtn = document.getElementById('signOutBtn');
  dragOverlay = document.getElementById('dragOverlay');
  devicesList = document.getElementById('devicesList');
  globalToggle = document.getElementById('globalToggle');
  incomingModal = document.getElementById('incomingModal');
  incomingFrom = document.getElementById('incomingFrom');
  incomingFileName = document.getElementById('incomingFileName');
  incomingFileSize = document.getElementById('incomingFileSize');
  incomingAcceptBtn = document.getElementById('incomingAcceptBtn');
  incomingDeclineBtn = document.getElementById('incomingDeclineBtn');
  warningModal = document.getElementById('warningModal');
  warningModalText = document.getElementById('warningModalText');
  warningOkBtn = document.getElementById('warningOkBtn');
  expiryModal = document.getElementById('expiryModal');
  expiryModalSubtitle = document.getElementById('expiryModalSubtitle');
  expiryModalOptions = document.getElementById('expiryModalOptions');
  userhashInput = document.getElementById('userhashInput');
  userhashTooltip = document.getElementById('userhashTooltip');
  defaultOptions = document.getElementById('defaultOptions');


  loadShares();
  renderShares();
  attachEventListeners();
  updateGlobalToggle();
  connectWebSocket();

  Sync = SyncFactory.create({
    endpoint: 'shares',
    storageKey: 'shares',
    maxItems: null,
    getItems: () => [...shares, ...archivedShares],
    setItems: (v) => {
      shares = v.filter(s => !s.archived && !s.deleted);
      archivedShares = v.filter(s => s.archived && !s.deleted);
    },
    buildPayload: (s) => ({
      name: s.name || '',
      size: s.size || 0,
      mime_type: s.mime_type || '',
      host: s.host || '',
      external_id: s.external_id || '',
      download_url: s.download_url || '',
      archived: s.archived || false,
      expires_at: s.expires_at == null ? null : Number(s.expires_at),
    }),
    toLocal: (s) => ({
      name: s.name || '',
      size: Number(s.size) || 0,
      mime_type: s.mime_type || '',
      host: s.host || '',
      external_id: s.external_id || '',
      download_url: s.download_url || '',
      archived: s.archived || false,
      expires_at: s.expires_at == null ? null : Number(s.expires_at),
    }),
    render: renderShares,
  });
  Sync.init();

  updateAuthUI();
  Auth.onAuthChange((state) => {
    if (!_signingOut) {
      updateAuthUI();
      reconnectWebSocket();
      if (state === 'signed_in' || state === 'refreshed' || state === 'synced') {
        syncDevicesToServer();
      }
      renderDevices();
    }
  });
});

function attachEventListeners() {
  addButton.addEventListener('click', () => {
    _pendingSendTarget = null;
    fileInput.click();
  });
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      if (_pendingSendTarget) {
        const target = _pendingSendTarget;
        _pendingSendTarget = null;
        sendFileToDevice(files[0], target);
      } else {
        handleFiles(files);
      }
    }
    fileInput.value = '';
  });

  settingsIcon.addEventListener('click', openSettings);
  overlay.addEventListener('click', closeSettingsPanel);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettingsPanel();
  });

  signInBtn.addEventListener('click', () => Auth.signIn());
  signOutBtn.addEventListener('click', () => {
    _signingOut = true;
    signOutBtn.textContent = 'sign out successful';
    signOutBtn.disabled = true;
    Auth.signOut();
    setTimeout(() => {
      _signingOut = false;
      signOutBtn.textContent = 'sign out';
      signOutBtn.disabled = false;
      updateAuthUI();
    }, 3000);
  });

  if (userhashInput) {
    userhashInput.addEventListener('input', () => {
      const currentDefault = defaultOptions.querySelector('.selected')?.dataset?.value || 'ask';
      renderDefaultOptions(loadSettings());
      const btn = defaultOptions.querySelector('[data-value="' + currentDefault + '"]');
      if (btn) btn.classList.add('selected');
      else {
        const fallback = defaultOptions.querySelector('[data-value="ask"]');
        if (fallback) fallback.classList.add('selected');
      }
    });
  }

  if (userhashInput) {
    userhashInput.addEventListener('change', () => {
      const settings = loadSettings();
      settings.userhash = userhashInput.value.trim();
      saveSettings(settings);
    });
  }
  const fileditchToggle = document.getElementById('preferFileditchToggle');
  if (fileditchToggle) {
    fileditchToggle.addEventListener('change', () => {
      const settings = loadSettings();
      settings.preferFileditch = fileditchToggle.checked;
      saveSettings(settings);
    });
  }

  archivedHeader.addEventListener('click', toggleArchived);
  globalToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setInGlobal(!getInGlobal());
    updateGlobalToggle();
  });

  incomingAcceptBtn.addEventListener('click', () => acceptIncoming());
  incomingDeclineBtn.addEventListener('click', () => declineIncoming());
  incomingModal.addEventListener('click', (e) => {
    if (e.target === incomingModal) declineIncoming();
  });

  warningOkBtn.addEventListener('click', () => {
    warningModal.classList.remove('visible');
  });

  expiryModal.addEventListener('click', (e) => {
    if (e.target === expiryModal) hideExpiryModal();
  });

  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    dragCounter++;
    dragOverlay.classList.add('visible');
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dragOverlay.classList.remove('visible');
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove('visible');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      if (_pendingSendTarget) {
        const target = _pendingSendTarget;
        _pendingSendTarget = null;
        sendFileToDevice(files[0], target);
      } else {
        handleFiles(files);
      }
    }
  });
}

function updateGlobalToggle() {
  if (getInGlobal()) globalToggle.classList.add('active');
  else globalToggle.classList.remove('active');
}

function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;
  const defaultOption = loadSettings().defaultOption;
  if (defaultOption && defaultOption !== 'ask') {
    for (const f of files) {
      const plan = resolveUploadPlan(f, { id: defaultOption });
      enqueueUpload(f, plan);
    }
    processUploadQueue();
    return;
  }
  showExpiryModal(files);
}

function showExpiryModal(files) {
  if (_uploadQueue.length > 0 || _isUploading) {
    for (const f of files) queueWithAutoExpiry(f);
    processUploadQueue();
    showWarning('files queued with 3-day default expiry');
    return;
  }
  const options = computeAvailableOptions(files);
  expiryModalOptions.innerHTML = '';
  expiryModalSubtitle.textContent = files.length === 1
    ? files[0].name
    : files.length + ' files';

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'expiry-modal-option';
    if (options.length === 1) btn.classList.add('full');
    btn.type = 'button';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      hideExpiryModal();
      startUploadsWithOption(files, opt);
    });
    expiryModalOptions.appendChild(btn);
  }

  requestAnimationFrame(() => {
    expiryModal.classList.add('visible');
  });
}

function hideExpiryModal() {
  expiryModal.classList.remove('visible');
}

function computeAvailableOptions(files) {
  let allUnder1GB = true;
  let all1GBOrMore = true;
  for (const f of files) {
    if (f.size >= SIZE_1GB) allUnder1GB = false;
    else all1GBOrMore = false;
  }
  if (all1GBOrMore) {
    return [
      { id: '3d', label: '3 days' },
      { id: 'never', label: 'never' },
    ];
  }
  if (allUnder1GB) {
    return [
      { id: '1h', label: '1 hour' },
      { id: '12h', label: '12 hours' },
      { id: '1d', label: '1 day' },
      { id: '3d', label: '3 days' },
      { id: 'never', label: 'never' },
    ];
  }
  return [
    { id: '3d', label: '3 days' },
    { id: 'never', label: 'never' },
  ];
}

function startUploadsWithOption(files, option) {
  for (const f of files) {
    const plan = resolveUploadPlan(f, option);
    enqueueUpload(f, plan);
  }
  processUploadQueue();
}

function queueWithAutoExpiry(file) {
  const plan = resolveUploadPlan(file, { id: '3d' });
  enqueueUpload(file, plan);
}

function resolveUploadPlan(file, option) {
  const settings = loadSettings();
  const fdHost = settings.preferFileditch ? 'fileditch' : 'temp_fileditch';

  if (settings.preferFileditch) {
    return {
      host: fdHost,
      uploadHost: fdHost,
      time: option.id === 'never' ? null : option.id,
      expires_at: option.id === 'never' ? null : (Date.now() + (TEMP_FILEDITCH_TIMES[option.id] || 0)),
    };
  }

  const isLarge = file.size >= SIZE_1GB;
  const isMedium = file.size >= SIZE_200MB;
  const choice = option.id;

  if (isLarge) {
    if (choice === '3d') {
      return {
        host: fdHost,
        uploadHost: fdHost,
        time: '3d',
        expires_at: Date.now() + TEMP_FILEDITCH_TIMES['3d'],
      };
    }
    return {
      host: fdHost,
      uploadHost: fdHost,
      time: null,
      expires_at: null,
    };
  }

  if (choice === 'never' && !isMedium) {
    if (settings.userhash) {
      return {
        host: 'catbox',
        uploadHost: 'catbox',
        time: null,
        expires_at: null,
      };
    }
    return {
      host: fdHost,
      uploadHost: fdHost,
      time: null,
      expires_at: null,
    };
  }

  if (choice === 'never') {
    return {
      host: 'litterbox',
      uploadHost: 'litterbox',
      time: '3d',
      expires_at: Date.now() + LITTERBOX_TIMES['3d'],
    };
  }

  return {
    host: 'litterbox',
    uploadHost: 'litterbox',
    time: choice,
    expires_at: Date.now() + (LITTERBOX_TIMES[choice] || 0),
  };
}

function enqueueUpload(file, plan) {
  _uploadQueue.push({ file, plan });
  processUploadQueue();
}

async function processUploadQueue() {
  if (_isUploading) return;
  if (_uploadQueue.length === 0) return;

  _isUploading = true;
  const { file, plan } = _uploadQueue.shift();

  const tempId = Date.now();
  const onCancel = () => {
    if (_currentXhr) {
      try { _currentXhr.abort(); } catch {}
    }
  };
  const tempCard = createUploadingCard(file, plan, tempId, onCancel);
  _currentUploadCard = tempCard;
  shareGrid.insertBefore(tempCard, shareGrid.firstChild);

  const startTime = Date.now();
  let lastLoaded = 0;
  let lastTime = startTime;

  try {
    const result = await uploadExternal(file, plan, (loaded, total) => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      const db = loaded - lastLoaded;
      const speed = dt > 0 ? db / dt : 0;
      lastLoaded = loaded;
      lastTime = now;

      const pct = total > 0 ? (loaded / total) * 100 : 0;
      const remaining = speed > 0 ? (total - loaded) / speed : 0;

      const fillEl = tempCard.querySelector('.share-upload-bar-fill');
      if (fillEl) fillEl.style.width = pct + '%';

      const speedEl = tempCard.querySelector('.upload-speed');
      if (speedEl) speedEl.textContent = formatSpeed(speed);

      const pctEl = tempCard.querySelector('.upload-pct');
      if (pctEl) pctEl.textContent = Math.floor(pct) + '%';

      const amountEl = tempCard.querySelector('.upload-amount');
      if (amountEl) amountEl.textContent = formatSize(loaded) + '/' + formatSize(total);

      const etaEl = tempCard.querySelector('.upload-eta');
      if (etaEl) etaEl.textContent = formatTime(remaining);
    }, (xhr) => {
      _currentXhr = xhr;
    });

    const shareId = String(result.id) || String(Date.now());
    const newShare = {
      id: shareId,
      name: result.name || file.name,
      size: Number(result.size) || file.size,
      mime_type: result.mime_type || file.type || '',
      host: result.host || plan.host,
      external_id: result.external_id || '',
      download_url: result.download_url || '',
      expires_at: plan.expires_at == null ? null : Number(plan.expires_at),
      archived: false,
      updated_at: Date.now(),
      deleted: false,
      order: shares.length,
    };

    _animateShareIds.add(shareId);
    tempCard.remove();
    _currentUploadCard = null;
    shares.push(newShare);
    saveShares();
    renderShares();
    syncMutation([newShare]);
  } catch (err) {
    tempCard.remove();
    _currentUploadCard = null;
    showWarning('upload failed: ' + (err.message || 'unknown error'));
  } finally {
    _isUploading = false;
    _currentXhr = null;
    setTimeout(processUploadQueue, 100);
  }
}

async function uploadExternal(file, plan, onProgress, onXhr) {
  if (plan.uploadHost === 'catbox' || plan.uploadHost === 'litterbox') {
    return await uploadViaProxy(file, plan, onProgress, onXhr);
  }
  if (plan.uploadHost === 'temp_fileditch' || plan.uploadHost === 'fileditch') {
    return await uploadToFileditch(file, plan, onProgress, onXhr);
  }
  throw new Error('unsupported host: ' + plan.uploadHost);
}

function uploadViaProxy(file, plan, onProgress, onXhr) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onXhr) onXhr(xhr);
    const params = new URLSearchParams();
    params.set('host', plan.uploadHost);
    params.set('filename', file.name);
    params.set('mimeType', file.type || 'application/octet-stream');
    if (plan.time) params.set('time', plan.time);
    if (plan.uploadHost === 'catbox') {
      const userhash = loadSettings().userhash;
      if (userhash) params.set('userhash', userhash);
    }
    const url = window.location.origin + '/api/upload/proxy?' + params.toString();
    xhr.open('POST', url);
    const token = Auth.getToken();
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const text = (xhr.responseText || '').trim();
        if (!text) {
          reject(new Error('empty ' + plan.uploadHost + ' response'));
          return;
        }
        const firstLine = text.split(/\r?\n/)[0].trim();
        const downloadUrl = firstLine;
        let externalId = '';
        try {
          const u = new URL(downloadUrl);
          const parts = u.pathname.split('/').filter(Boolean);
          externalId = parts[parts.length - 1] || downloadUrl;
        } catch {
          externalId = downloadUrl;
        }
        resolve({
          id: externalId,
          name: file.name,
          size: file.size,
          mime_type: file.type || '',
          host: plan.host,
          external_id: externalId,
          download_url: downloadUrl,
        });
      } else {
        reject(new Error(plan.uploadHost + ' upload failed (' + xhr.status + '): ' + (xhr.responseText || '')));
      }
    });
    xhr.addEventListener('error', () => reject(new Error(plan.uploadHost + ' network error')));
    xhr.addEventListener('abort', () => reject(new Error('aborted')));
    xhr.send(file);
  });
}

function uploadToFileditch(file, plan, onProgress, onXhr) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    if (plan.time) formData.append('time', plan.time);
    const xhr = new XMLHttpRequest();
    if (onXhr) onXhr(xhr);
    const uploadUrl = plan.uploadHost === 'fileditch'
      ? 'https://new.fileditch.com/upload.php'
      : 'https://temp.fileditch.com/upload.php';
    xhr.open('POST', uploadUrl);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch {}
        if (data && data.url) {
          const externalId = data.filename || (data.url.split('/').pop() || '');
          const resolvedHost = plan.uploadHost === 'fileditch' ? 'fileditch' : 'temp_fileditch';
          resolve({
            id: externalId,
            name: data.filename || file.name,
            size: data.size != null ? data.size : file.size,
            mime_type: file.type || '',
            host: resolvedHost,
            external_id: externalId,
            download_url: data.url,
          });
        } else {
          reject(new Error('invalid ' + uploadUrl + ' response'));
        }
      } else {
        reject(new Error(uploadUrl + ' upload failed (' + xhr.status + '): ' + (xhr.responseText || '')));
      }
    });
    xhr.addEventListener('error', () => reject(new Error(uploadUrl + ' network error')));
    xhr.addEventListener('abort', () => reject(new Error('aborted')));
    xhr.send(formData);
  });
}

function createUploadingCard(file, plan, tempId, onCancel) {
  const card = document.createElement('div');
  card.className = 'share-card uploading';
  card.dataset.tempId = tempId;

  const info = document.createElement('div');
  info.className = 'share-info';
  const name = document.createElement('div');
  name.className = 'share-name';
  name.textContent = file.name;
  const meta = document.createElement('div');
  meta.className = 'share-meta';
  const size = document.createElement('span');
  size.className = 'share-size';
  size.textContent = formatSize(file.size);
  meta.appendChild(size);
  info.appendChild(name);
  info.appendChild(meta);

  card.appendChild(info);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'share-cancel';
  cancelBtn.title = 'cancel upload';
  cancelBtn.setAttribute('aria-label', 'cancel upload');
  cancelBtn.innerHTML = CANCEL_SVG;
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onCancel) onCancel();
  });
  card.appendChild(cancelBtn);

  const bar = document.createElement('div');
  bar.className = 'share-upload-bar';
  const fill = document.createElement('div');
  fill.className = 'share-upload-bar-fill';
  bar.appendChild(fill);
  card.appendChild(bar);

  const stats = document.createElement('div');
  stats.className = 'upload-stats';
  const speed = document.createElement('span');
  speed.className = 'upload-speed';
  speed.textContent = '--';
  const pct = document.createElement('span');
  pct.className = 'upload-pct';
  pct.textContent = '0%';
  const amount = document.createElement('span');
  amount.className = 'upload-amount';
  amount.textContent = '0/0';
  const eta = document.createElement('span');
  eta.className = 'upload-eta';
  eta.textContent = '--:--';
  stats.appendChild(speed);
  stats.appendChild(pct);
  stats.appendChild(amount);
  stats.appendChild(eta);
  card.appendChild(stats);

  return card;
}

function archiveShare(shareId) {
  const card = document.querySelector(`[data-share-id="${shareId}"]`);
  if (card) {
    card.classList.add('removing');
    card.addEventListener('animationend', () => {
      performArchive(shareId);
    }, { once: true });
  } else {
    performArchive(shareId);
  }
}

function performArchive(shareId) {
  const share = findShare(shareId);
  if (!share) return;
  share.archived = true;
  share.updated_at = Date.now();
  shares = shares.filter(s => s.id !== shareId);
  archivedShares.push(share);
  _animateArchivedIds.add(shareId);
  saveShares();
  syncMutation([share]);
  renderShares();
}

function restoreArchive(shareId) {
  const share = archivedShares.find(s => s.id === shareId);
  if (!share) return;
  share.archived = false;
  share.updated_at = Date.now();
  saveShares();
  syncMutation([share]);
  renderShares();
}

function toggleArchived() {
  archivedHeader.classList.toggle('collapsed');
  archivedList.classList.toggle('collapsed');
}

function loadSettings() {
  const settingsShare = shares.find(s => s.id === SETTINGS_SHARE_ID);
  if (settingsShare) {
    try {
      const data = JSON.parse(settingsShare.name);
      return {
        userhash: (data.userhash || localStorage.getItem('microshare_userhash') || '').trim(),
        defaultOption: data.defaultOption || localStorage.getItem('microshare_default_upload') || 'ask',
        preferFileditch: data.preferFileditch === true,
      };
    } catch {}
  }
  return {
    userhash: (localStorage.getItem('microshare_userhash') || '').trim(),
    defaultOption: localStorage.getItem('microshare_default_upload') || 'ask',
    preferFileditch: localStorage.getItem('microshare_prefer_fileditch') === 'true',
  };
}

function saveSettings(s) {
  const userhash = (s.userhash || '').trim();
  localStorage.setItem('microshare_userhash', userhash);
  localStorage.setItem('microshare_default_upload', s.defaultOption || 'ask');
  localStorage.setItem('microshare_prefer_fileditch', String(!!s.preferFileditch));
  const existing = shares.findIndex(s => s.id === SETTINGS_SHARE_ID);
  const settingsItem = {
    id: SETTINGS_SHARE_ID,
    name: JSON.stringify({ userhash, defaultOption: s.defaultOption || 'ask', preferFileditch: !!s.preferFileditch }),
    size: 0,
    mime_type: '',
    host: '',
    external_id: '',
    download_url: '',
    archived: false,
    expires_at: null,
    updated_at: Date.now(),
    deleted: false,
    order: -1,
  };
  if (existing >= 0) {
    shares[existing] = settingsItem;
  } else {
    shares.push(settingsItem);
  }
  syncMutation([settingsItem]);
}

function renderDefaultOptions(settings) {
  const hasUserhash = !!settings.userhash;
  let opts;
  if (hasUserhash) {
    opts = [
      { id: '1h', label: '1 hour' },
      { id: '12h', label: '12 hours' },
      { id: '1d', label: '1 day' },
      { id: '3d', label: '3 days' },
      { id: 'never', label: 'never' },
      { id: 'ask', label: 'ask each time' },
    ];
  } else {
    opts = [
      { id: '3d', label: 'temp.fileditch (3d)' },
      { id: 'never', label: 'temp.fileditch (never)' },
      { id: 'ask', label: 'ask each time' },
    ];
  }
  defaultOptions.innerHTML = '';
  for (const o of opts) {
    const btn = document.createElement('button');
    btn.className = 'default-option-btn';
    if (o.id === settings.defaultOption) btn.classList.add('selected');
    btn.dataset.value = o.id;
    btn.textContent = o.label;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      defaultOptions.querySelectorAll('.default-option-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const settings = loadSettings();
      settings.defaultOption = o.id;
      saveSettings(settings);
    });
    defaultOptions.appendChild(btn);
  }
}

function openSettings() {
  const settings = loadSettings();
  userhashInput.value = settings.userhash;
  const toggle = document.getElementById('preferFileditchToggle');
  if (toggle) toggle.checked = settings.preferFileditch;
  renderDefaultOptions(settings);
  settingsOverlay.classList.add('visible');
  updateAuthUI();
}

function closeSettingsPanel() {
  const userhash = userhashInput.value.trim();
  const selected = defaultOptions.querySelector('.selected');
  const defaultOption = selected ? selected.dataset.value : 'ask';
  const preferFileditch = document.getElementById('preferFileditchToggle')?.checked || false;
  saveSettings({ userhash, defaultOption, preferFileditch });
  settingsOverlay.classList.remove('visible');
}

function updateAuthUI() {
  if (!signInBtn || !signOutBtn) return;
  if (Auth.isAuthenticated()) {
    signInBtn.style.display = 'none';
    signOutBtn.style.display = 'block';
  } else {
    signInBtn.style.display = 'block';
    signOutBtn.style.display = 'none';
  }
}

function getDaysLeft(share) {
  if (share.expires_at === null) return Infinity;
  if (typeof share.expires_at === 'number' && share.expires_at > 0) {
    const msLeft = share.expires_at - Date.now();
    if (msLeft <= 0) return 0;
    return msLeft / (1000 * 60 * 60 * 24);
  }
  return null;
}

function formatTimeLeft(daysLeft) {
  if (daysLeft == null) return null;
  if (daysLeft === Infinity) return null;
  if (daysLeft <= 0) return 'expired';
  if (daysLeft < 1) {
    const hours = Math.max(1, Math.ceil(daysLeft * 24));
    return hours + 'h left';
  }
  const days = Math.ceil(daysLeft);
  return days + 'd left';
}

function hostLabel(host) {
  if (host === 'catbox') return 'catbox';
  if (host === 'litterbox') return 'litterbox';
  if (host === 'temp_fileditch') return 'fileditch';
  return host;
}

function archiveExpiredShares() {
  const expired = shares.filter(s => {
    const daysLeft = getDaysLeft(s);
    return daysLeft !== null && daysLeft !== Infinity && daysLeft <= 0;
  });
  if (expired.length === 0) return;
  for (const share of expired) {
    share.archived = true;
    share.updated_at = Date.now();
    shares = shares.filter(s => s.id !== share.id);
    archivedShares.push(share);
    syncMutation([share]);
  }
  saveShares();
}

function renderShares() {
  archiveExpiredShares();

  const active = shares.filter(s => !s.archived && !s.deleted && s.id !== SETTINGS_SHARE_ID)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const activeIds = active.map(s => String(s.id));

  if (_lastRenderedShareIds && arraysEqual(_lastRenderedShareIds, activeIds)) {
    renderArchivedList();
    return;
  }

  _lastRenderedShareIds = activeIds;

  const uploadingCard = shareGrid.querySelector('.share-card.uploading');
  if (uploadingCard) uploadingCard.remove();

  shareGrid.innerHTML = '';
  active.forEach(s => {
    const card = createShareCard(s);
    if (_animateShareIds.has(s.id)) {
      card.classList.add('adding');
      _animateShareIds.delete(s.id);
    } else if (_firstRender && s.updated_at && Date.now() - s.updated_at < 60000) {
      card.classList.add('adding');
    }
    shareGrid.appendChild(card);
  });

  if (uploadingCard && uploadingCard === _currentUploadCard) {
    shareGrid.insertBefore(uploadingCard, shareGrid.firstChild);
  }

  renderArchivedList();

  if (_firstRender) _firstRender = false;
}

function renderArchivedList() {
  archivedList.innerHTML = '';
  const archived = archivedShares.filter(s => s.archived && !s.deleted && s.id !== SETTINGS_SHARE_ID)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  if (archived.length === 0) {
    archivedHeader.style.display = 'none';
  } else {
    archivedHeader.style.display = 'flex';
    archived.forEach(s => {
      const card = createArchivedCard(s);
      if (_animateArchivedIds.has(s.id)) {
        card.classList.add('adding');
        _animateArchivedIds.delete(s.id);
      }
      archivedList.appendChild(card);
    });
  }
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function startRenameShare(shareId, nameEl) {
  const share = findShare(shareId);
  if (!share) return;

  const textSpan = nameEl.querySelector('span');
  if (!textSpan) return;

  let newName;
  if (isMobileView()) {
    const input = prompt('rename file', share.name || '');
    if (input === null) return;
    newName = input.trim();
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'share-name-input';
    input.value = share.name || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    textSpan.replaceWith(input);
    input.focus();
    input.select();

    let resolved = false;
    const finish = (commit) => {
      if (resolved) return;
      resolved = true;
      if (!commit) {
        input.replaceWith(textSpan);
        return;
      }
      const value = input.value.trim();
      if (value && value !== share.name) {
        share.name = value;
        share.updated_at = Date.now();
        saveShares();
        debouncedSyncMutation([share]);
      }
      textSpan.textContent = share.name;
      input.replaceWith(textSpan);
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
    return;
  }

  if (!newName || newName === share.name) return;
  share.name = newName;
  share.updated_at = Date.now();
  saveShares();
  syncMutation([share]);
  renderShares();
}

function createShareCard(share) {
  const card = document.createElement('div');
  card.className = 'share-card';
  card.dataset.shareId = share.id;

  const info = document.createElement('div');
  info.className = 'share-info';
  const name = document.createElement('div');
  name.className = 'share-name';
  const nameText = document.createElement('span');
  nameText.textContent = share.name;
  name.appendChild(nameText);
  name.title = share.name;
  nameText.addEventListener('click', (e) => {
    e.stopPropagation();
    startRenameShare(share.id, name);
  });
  const meta = document.createElement('div');
  meta.className = 'share-meta';
  const size = document.createElement('span');
  size.className = 'share-size';
  size.textContent = formatSize(share.size);
  meta.appendChild(size);
  const daysLeft = getDaysLeft(share);
  const expiryText = formatTimeLeft(daysLeft);
  if (expiryText) {
    const expiry = document.createElement('span');
    expiry.className = 'share-expiry';
    expiry.textContent = expiryText;
    meta.appendChild(expiry);
  }
  info.appendChild(name);
  info.appendChild(meta);

  card.appendChild(info);

  if (share.download_url) {
    const downloadLink = document.createElement('a');
    downloadLink.className = 'share-download';
    downloadLink.href = share.download_url;
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    downloadLink.title = 'download';
    downloadLink.setAttribute('aria-label', 'download');
    downloadLink.innerHTML = DOWNLOAD_SVG;
    card.appendChild(downloadLink);
  }

  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'share-archive';
  archiveBtn.title = 'archive';
  archiveBtn.setAttribute('aria-label', 'archive');
  archiveBtn.innerHTML = ARCHIVE_SVG;
  archiveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    archiveShare(share.id);
  });
  card.appendChild(archiveBtn);

  initShareDrag(card, share);
  return card;
}

function initShareDrag(card, share) {
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    _draggedShare = share;
    _draggedShareEl = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(share.id));
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    _draggedShare = null;
    _draggedShareEl = null;
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!_draggedShare || _draggedShare.id === share.id) return;
    const rect = card.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (e.clientX < midX) {
      shareGrid.insertBefore(_draggedShareEl, card);
    } else {
      shareGrid.insertBefore(_draggedShareEl, card.nextElementSibling);
    }
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    saveShareDragOrder();
  });
}

function saveShareDragOrder() {
  const cards = shareGrid.querySelectorAll('.share-card:not(.uploading)');
  cards.forEach((card, index) => {
    const share = findShare(card.dataset.shareId);
    if (share) {
      share.order = index;
      share.updated_at = Date.now();
    }
  });
  saveShares();
  const changed = Array.from(cards).map(card => findShare(card.dataset.shareId)).filter(Boolean);
  syncMutation(changed);
}

function createArchivedCard(share) {
  const card = document.createElement('div');
  card.className = 'archived-card';
  card.dataset.shareId = share.id;

  const name = document.createElement('div');
  name.className = 'archived-card-name';
  name.textContent = share.name;

  const meta = document.createElement('div');
  meta.className = 'share-meta';
  const size = document.createElement('span');
  size.className = 'share-size';
  size.textContent = formatSize(share.size);
  meta.appendChild(size);
  const daysLeft = getDaysLeft(share);
  const expiryText = formatTimeLeft(daysLeft);
  if (expiryText) {
    const expiry = document.createElement('span');
    expiry.className = 'share-expiry';
    expiry.textContent = expiryText;
    meta.appendChild(expiry);
  }

  const row = document.createElement('div');
  row.className = 'archived-card-row';
  row.appendChild(meta);

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'archived-card-restore';
  restoreBtn.title = 'unarchive';
  restoreBtn.setAttribute('aria-label', 'unarchive');
  restoreBtn.innerHTML = UNARCHIVE_SVG;
  restoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    restoreArchive(share.id);
  });

  card.appendChild(name);
  card.appendChild(row);
  card.appendChild(restoreBtn);

  return card;
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '--';
  const mbps = bytesPerSec / (1024 * 1024);
  if (mbps >= 1) return mbps.toFixed(mbps >= 10 ? 0 : 1) + ' mb/s';
  const kbps = bytesPerSec / 1024;
  return kbps.toFixed(0) + ' kb/s';
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '--:--';
  const s = Math.floor(seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
}

function findShare(id) {
  return shares.find(s => s.id === id) || archivedShares.find(s => s.id === id);
}

function saveShares() {
  try {
    const all = [...shares, ...archivedShares];
    localStorage.setItem('shares', JSON.stringify(all));
  } catch {}
}

function loadShares() {
  try {
    const raw = localStorage.getItem('shares');
    const all = raw ? JSON.parse(raw) : [];
    shares = all.filter(s => !s.archived && !s.deleted);
    archivedShares = all.filter(s => s.archived && !s.deleted);
  } catch {
    shares = [];
    archivedShares = [];
  }
}

function syncMutation(changedShares) {
  if (!Auth.isAuthenticated()) return;
  Sync.pushToServer(changedShares);
}

function debouncedSyncMutation(changedShares) {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(() => syncMutation(changedShares), SYNC_DEBOUNCE_MS);
}

function connectWebSocket() {
  if (_ws && _ws.readyState <= 1) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = protocol + '//' + window.location.host + '/api/ws';
  try {
    _ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  _ws.addEventListener('open', () => {
    _wsBackoff = 1000;
    sendHello();
  });
  _ws.addEventListener('message', (e) => {
    try { handleWsMessage(JSON.parse(e.data)); } catch {}
  });
  _ws.addEventListener('close', () => {
    _ws = null;
    scheduleReconnect();
  });
  _ws.addEventListener('error', () => {});
}

function reconnectWebSocket() {
  if (_ws) {
    try { _ws.close(); } catch {}
    _ws = null;
  }
  if (_wsReconnectTimer) {
    clearTimeout(_wsReconnectTimer);
    _wsReconnectTimer = null;
  }
  _wsBackoff = 1000;
  connectWebSocket();
}

function scheduleReconnect() {
  if (_wsReconnectTimer) return;
  const delay = Math.min(_wsBackoff, 30000);
  _wsReconnectTimer = setTimeout(() => {
    _wsReconnectTimer = null;
    _wsBackoff = Math.min(_wsBackoff * 2, 30000);
    connectWebSocket();
  }, delay);
}

function sendWs(msg) {
  if (_ws && _ws.readyState === 1) {
    try { _ws.send(JSON.stringify(msg)); } catch {}
  }
}

function sendHello() {
  const userId = (Auth.isAuthenticated() && Auth.getToken()) ? safeUserId() : null;
  sendWs({
    type: 'hello',
    deviceId: getDeviceId(),
    userId,
    name: getDeviceName(),
    platform: detectPlatform(),
    inGlobal: getInGlobal(),
  });
}

function safeUserId() {
  try {
    const stored = localStorage.getItem('shoo_identity');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed.userId || parsed.pairwise_sub || null;
  } catch {
    return null;
  }
}

function handleWsMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'welcome') {
    _myPublicIp = msg.publicIp || '';
  } else if (msg.type === 'deviceList') {
    _onlineDevices = msg.devices || [];
    renderDevices();
  } else if (msg.type === 'offer') {
    handleIncomingOffer(msg);
  } else if (msg.type === 'answer') {
    handleAnswer(msg);
  } else if (msg.type === 'signal') {
    handleSignal(msg);
  } else if (msg.type === 'cancel') {
    handleCancel(msg);
  } else {
    console.warn('[WS] Unknown message type:', msg.type);
  }
}

function renderDevices() {
  if (!devicesList) return;
  devicesList.innerHTML = '';
  const myId = getDeviceId();
  const myUserId = Auth.isAuthenticated() ? safeUserId() : null;
  const inGlobal = getInGlobal();
  const others = _onlineDevices.filter(d => d.id !== myId);
  const own = others.filter(d => myUserId && d.userId === myUserId);
  const global = others.filter(d => (!myUserId || d.userId !== myUserId) && d.inGlobal && inGlobal);
  const list = [...own, ...global];
  for (const device of list) {
    devicesList.appendChild(createDeviceCard(device, myUserId));
  }
  const total = own.length + global.length;
  const section = devicesList.parentElement;
  if (total === 0) section.classList.add('empty');
  else section.classList.remove('empty');
}

function createDeviceCard(device, myUserId) {
  const card = document.createElement('div');
  card.className = 'device-card';
  if (myUserId && device.userId === myUserId) card.classList.add('self');
  if (device.inGlobal) card.classList.add('global');
  card.dataset.deviceId = device.id;

  const info = document.createElement('div');
  info.className = 'device-info';
  const name = document.createElement('div');
  name.className = 'device-name';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = device.name;
  name.appendChild(nameSpan);
  if (myUserId && device.userId === myUserId) {
    name.title = 'click to rename';
    name.addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameDevice(device.id, name);
    });
  }
  info.appendChild(name);

  card.appendChild(info);

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('device-name')) return;
    _pendingSendTarget = device;
    fileInput.click();
  });

  return card;
}

function startRenameDevice(deviceId, nameEl) {
  if (_editingDeviceId) return;
  const device = _onlineDevices.find(d => d.id === deviceId);
  if (!device) return;
  const myUserId = Auth.isAuthenticated() ? safeUserId() : null;
  if (!myUserId || device.userId !== myUserId) return;

  if (isMobileView()) {
    const input = prompt('rename device', device.name || '');
    if (input === null || !input.trim()) return;
    setDeviceName(input.trim());
    return;
  }

  _editingDeviceId = deviceId;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'device-name-input';
  input.value = device.name || '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let resolved = false;
  const finish = (commit) => {
    if (resolved) return;
    resolved = true;
    _editingDeviceId = null;
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('blur', onBlur);
    if (!commit) {
      nameEl.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = device.name;
      nameEl.appendChild(span);
      input.replaceWith(nameEl);
      return;
    }
    const value = input.value.trim();
    nameEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = value || device.name;
    nameEl.appendChild(span);
    input.replaceWith(nameEl);
    if (value && value !== device.name) {
      setDeviceName(value);
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', onBlur);
}

function syncDevicesToServer() {
  if (!Auth.isAuthenticated()) return;
  const token = Auth.getToken();
  if (!token) return;
  const myId = getDeviceId();
  const payload = [{
    id: myId,
    name: getDeviceName(),
    platform: detectPlatform(),
    updated_at: Date.now(),
    deleted: false,
  }];
  fetch(window.location.origin + '/api/devices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify({ devices: payload }),
  }).catch(err => console.error('[syncDevices] Failed:', err));
}

function handleIncomingOffer(msg) {
  const from = _onlineDevices.find(d => d.id === msg.from);
  _pendingIncoming = { from, file: msg.file, data: msg.data, source: msg.from };
  if (_pendingIncoming._timeout) clearTimeout(_pendingIncoming._timeout);
  _pendingIncoming._timeout = setTimeout(() => {
    if (_pendingIncoming) declineIncoming();
  }, 60000);
  incomingFrom.textContent = (from ? from.name : 'someone') + ' is sending you a file';
  incomingFileName.textContent = msg.file && msg.file.name ? msg.file.name : 'untitled';
  incomingFileSize.textContent = msg.file && msg.file.size ? formatSize(msg.file.size) : '';
  incomingModal.classList.add('visible');
}

function acceptIncoming() {
  if (!_pendingIncoming) return;
  if (_pendingIncoming._timeout) clearTimeout(_pendingIncoming._timeout);
  incomingModal.classList.remove('visible');
  const { from, file, data, source } = _pendingIncoming;
  _pendingIncoming = null;
  startReceiver(source, file, data);
}

function declineIncoming() {
  if (!_pendingIncoming) return;
  if (_pendingIncoming._timeout) clearTimeout(_pendingIncoming._timeout);
  const { source } = _pendingIncoming;
  _pendingIncoming = null;
  incomingModal.classList.remove('visible');
  if (source) {
    sendWs({ type: 'answer', to: source, accept: false });
  }
}

function startReceiver(targetId, file, offerData) {
  cleanupPeer();
  const peer = createPeer(targetId, 'receiver', file);
  _currentPeer = peer;
  peer.pc.setRemoteDescription(new RTCSessionDescription(offerData))
    .then(() => peer.pc.createAnswer())
    .then((answer) => peer.pc.setLocalDescription(answer))
    .then(() => {
      sendWs({ type: 'answer', to: targetId, accept: true, data: peer.pc.localDescription });
    })
    .catch(() => {
      showSameNetworkWarning(peer);
    });
}

function handleAnswer(msg) {
  if (!_currentPeer || _currentPeer.targetId !== msg.from) return;
  if (!msg.accept) {
    cleanupPeer();
    showWarning('receiver declined the file');
    return;
  }
  _currentPeer.pc.setRemoteDescription(new RTCSessionDescription(msg.data))
    .catch(() => {
      showSameNetworkWarning(_currentPeer);
    });
}

function handleSignal(msg) {
  if (!_currentPeer || _currentPeer.targetId !== msg.from) return;
  if (msg.data) {
    if (msg.data.candidate) {
      _currentPeer.pc.addIceCandidate(new RTCIceCandidate(msg.data)).catch(() => {});
    } else if (msg.data.sdp) {
      _currentPeer.pc.setRemoteDescription(new RTCSessionDescription(msg.data)).catch(() => {});
    }
  }
}

function handleCancel(msg) {
  if (_currentPeer && _currentPeer.targetId === msg.from) {
    cleanupPeer();
  }
  if (_pendingIncoming && _pendingIncoming.source === msg.from) {
    _pendingIncoming = null;
    incomingModal.classList.remove('visible');
  }
}

function createPeer(targetId, role, file) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  const peer = { targetId, role, file, pc, channel: null, chunks: [], receivedSize: 0, failedTimer: null };
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendWs({ type: 'signal', to: targetId, data: e.candidate });
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      if (peer.failedTimer) return;
      peer.failedTimer = setTimeout(() => {
        if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
          showSameNetworkWarning(peer);
          cleanupPeer();
        }
      }, 8000);
    } else {
      if (peer.failedTimer) { clearTimeout(peer.failedTimer); peer.failedTimer = null; }
    }
  };
  if (role === 'sender') {
    const channel = pc.createDataChannel('file', { ordered: true });
    peer.channel = channel;
    setupSenderChannel(peer);
  } else {
    pc.ondatachannel = (e) => {
      peer.channel = e.channel;
      setupReceiverChannel(peer);
    };
  }
  return peer;
}

function showSameNetworkWarning(peer) {
  const target = _onlineDevices.find(d => d.id === peer.targetId);
  if (target && _myPublicIp && target.publicIp && _myPublicIp === target.publicIp) {
    showWarning('peer to peer file sharing may fail when both devices are on the same network');
  } else {
    showWarning('connection failed');
  }
  cleanupPeer();
}

function setupSenderChannel(peer) {
  const { channel, file } = peer;
  channel.binaryType = 'arraybuffer';
  channel.onopen = () => {
    const meta = { type: 'meta', name: file.name, size: file.size, mime_type: file.type || '' };
    channel.send(JSON.stringify(meta));
    sendFileChunks(peer);
  };
  channel.onerror = () => {
    showSameNetworkWarning(peer);
  };
  channel.onclose = () => {
    cleanupPeer();
  };
}

function setupReceiverChannel(peer) {
  const { channel } = peer;
  channel.binaryType = 'arraybuffer';
  let metadata = null;
  channel.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'meta') {
          metadata = msg;
          peer.file = { name: msg.name, size: msg.size, mime_type: msg.mime_type };
        }
      } catch {}
      return;
    }
    if (!metadata) return;
    peer.chunks.push(e.data);
    peer.receivedSize += e.data.byteLength;
    if (peer.receivedSize >= metadata.size) {
      const blob = new Blob(peer.chunks, { type: metadata.mime_type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = metadata.name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 300000);
      if (_lastBlobUrl) URL.revokeObjectURL(_lastBlobUrl);
      _lastBlobUrl = url;
      cleanupPeer();
    }
  };
  channel.onerror = () => {
    showSameNetworkWarning(peer);
  };
  channel.onclose = () => {
    cleanupPeer();
  };
}

async function sendFileChunks(peer) {
  const { channel, file } = peer;
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      while (channel.bufferedAmount > 8 * 1024 * 1024) {
        await new Promise(r => setTimeout(r, 10));
      }
      channel.send(value);
    }
  } catch {
    showSameNetworkWarning(peer);
  }
}

function sendFileToDevice(file, target) {
  if (!_ws || _ws.readyState !== 1) {
    showWarning('not connected to server');
    return;
  }
  cleanupPeer();
  const peer = createPeer(target.id, 'sender', file);
  _currentPeer = peer;
  peer.pc.createOffer()
    .then((offer) => peer.pc.setLocalDescription(offer))
    .then(() => {
      sendWs({
        type: 'offer',
        to: target.id,
        file: { name: file.name, size: file.size, mime_type: file.type || '' },
        data: peer.pc.localDescription,
      });
    })
    .catch(() => {
      showSameNetworkWarning(peer);
    });
}

function cleanupPeer() {
  if (_currentPeer) {
    try { _currentPeer.channel && _currentPeer.channel.close(); } catch {}
    try { _currentPeer.pc.close(); } catch {}
    if (_currentPeer.failedTimer) clearTimeout(_currentPeer.failedTimer);
    _currentPeer = null;
  }
}

function showWarning(text) {
  warningModalText.textContent = text;
  warningModal.classList.add('visible');
}
