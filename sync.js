const Sync = (() => {
  const API_BASE = window.location.origin + '/api';
  const POLL_INTERVAL = 30000;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;
  const MAX_COMPLETED = 10;

  let _pollTimer = null;
  let _isSyncing = false;
  let _lastSyncTime = 0;
  let _syncEnabled = false;

  function init() {
    _syncEnabled = Auth.isAuthenticated();

    Auth.onAuthChange((state) => {
      if (state === 'signed_in' || state === 'refreshed' || state === 'synced') {
        _syncEnabled = true;
        _startPolling();
      } else if (state === 'signed_out') {
        _syncEnabled = false;
        _stopPolling();
      }
    });

    if (_syncEnabled) {
      _startPolling();
      _initialPullWithRetry();
    }
  }

  function _startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(() => {
      if (_syncEnabled && !_isSyncing) pullFromServer();
    }, POLL_INTERVAL);
  }

  function _stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  function _initialPullWithRetry(attempt = 0) {
    const maxAttempts = 10;
    if (!Auth.isAuthenticated()) {
      if (attempt < maxAttempts) {
        setTimeout(() => _initialPullWithRetry(attempt + 1), 500);
      }
      return;
    }
    pullFromServer();
  }

  async function _apiRequest(method, path, body, retryAttempt = 0) {
    const token = Auth.getToken();
    if (!token) throw new Error('Not authenticated');

    const url = API_BASE + path;
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');

        if (response.status === 401) {
          Auth.refreshIdentity();
          throw new Error('Auth failed');
        }

        if (response.status >= 500 && retryAttempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * Math.pow(2, retryAttempt)));
          return _apiRequest(method, path, body, retryAttempt + 1);
        }

        throw new Error(`API ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (err) {
      if (retryAttempt < MAX_RETRIES && _isNetworkError(err)) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * Math.pow(2, retryAttempt)));
        return _apiRequest(method, path, body, retryAttempt + 1);
      }
      throw err;
    }
  }

  function _isNetworkError(err) {
    return err.message.includes('fetch') || err.message.includes('Failed to fetch') || err.name === 'TypeError';
  }

  function _buildPayload(changedTasks) {
    return {
      tasks: changedTasks.map(t => ({
        id: String(t.id),
        title: t.title || '',
        description: t.description || '',
        completed: t.completed || false,
        subtasks: t.subtasks || [],
        updated_at: t.updated_at || Date.now(),
        deleted: t.deleted || false,
      })),
    };
  }

  function _applyServerResponse(serverTasks) {
    const localTasks = typeof tasks !== 'undefined' ? tasks : [];
    const mergedTasks = _mergeTasks(localTasks, serverTasks);
    if (typeof tasks !== 'undefined') tasks = mergedTasks;
    _saveTasksLocal(mergedTasks);
    if (typeof renderTasks === 'function') renderTasks();
    _lastSyncTime = Date.now();
    return mergedTasks;
  }

  async function pullFromServer() {
    if (!_syncEnabled || _isSyncing) return;
    _isSyncing = true;

    try {
      const data = await _apiRequest('GET', '/tasks');
      const serverTasks = data.tasks || [];
      let mergedTasks = _applyServerResponse(serverTasks);

      const completed = mergedTasks.filter(t => t.completed && !t.deleted);
      const active = mergedTasks.filter(t => !t.completed || t.deleted);
      if (completed.length > MAX_COMPLETED) {
        const toKeep = completed.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, MAX_COMPLETED);
        const toWipe = completed.filter(t => !toKeep.includes(t));

        if (toWipe.length > 0) {
          const wipePayload = toWipe.map(t => ({ ...t, deleted: true, updated_at: Date.now() }));
          try { await _pushRaw(wipePayload); } catch {}
        }

        mergedTasks = [...active, ...toKeep];
      }

      if (typeof tasks !== 'undefined') tasks = mergedTasks;
      _saveTasksLocal(mergedTasks);
      if (typeof renderTasks === 'function') renderTasks();

      const serverIds = new Set(serverTasks.map(t => String(t.id)));
      const localOnlyTasks = mergedTasks.filter(t => !serverIds.has(String(t.id)) && !t.deleted);
      if (localOnlyTasks.length > 0) {
        await _pushRaw(localOnlyTasks);
      }
    } catch {} finally {
      _isSyncing = false;
    }
  }

  async function _pushRaw(changedTasks) {
    if (!changedTasks || changedTasks.length === 0) return;
    const data = await _apiRequest('POST', '/tasks', _buildPayload(changedTasks));
    _applyServerResponse(data.tasks || []);
  }

  async function pushToServer(changedTasks) {
    if (!_syncEnabled || !changedTasks || changedTasks.length === 0) return;

    try {
      const data = await _apiRequest('POST', '/tasks', _buildPayload(changedTasks));
      _applyServerResponse(data.tasks || []);
    } catch {}
  }

  function _mergeTasks(localTasks, serverTasks) {
    const merged = new Map();
    const serverTaskMap = new Map();

    for (const st of serverTasks) {
      serverTaskMap.set(String(st.id), st);
    }

    for (const lt of localTasks) {
      const id = String(lt.id);
      const serverTask = serverTaskMap.get(id);

      if (!serverTask) {
        merged.set(id, lt);
      } else if (serverTask.deleted) {
      } else if (serverTask.updated_at > (lt.updated_at || 0)) {
        merged.set(id, _serverTaskToLocal(serverTask));
      } else {
        merged.set(id, lt);
      }
    }

    for (const st of serverTasks) {
      const id = String(st.id);
      if (!merged.has(id) && !st.deleted) {
        merged.set(id, _serverTaskToLocal(st));
      }
    }

    return Array.from(merged.values());
  }

  function _serverTaskToLocal(st) {
    return {
      id: Number(st.id) || st.id,
      title: st.title || '',
      description: st.description || '',
      completed: st.completed || false,
      subtasks: Array.isArray(st.subtasks) ? st.subtasks.map(s => ({
        id: Number(s.id) || s.id,
        title: s.title || '',
        completed: s.completed || false,
      })) : [],
      updated_at: st.updated_at,
      deleted: st.deleted || false,
    };
  }

  function _saveTasksLocal(taskList) {
    try { localStorage.setItem('tasks', JSON.stringify(taskList)); } catch {}
  }

  return { init, pullFromServer, pushToServer };
})();
