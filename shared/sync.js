const SyncFactory = (() => {
  function create(config) {
    const { endpoint, storageKey, maxItems, buildPayload, toLocal, getItems, setItems, render } = config;

    const API_BASE = window.location.origin + '/api';
    const POLL_INTERVAL = 30000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;

    let _pollTimer = null;
    let _isSyncing = false;
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
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { _stopPolling(); }
        else if (_syncEnabled) { _startPolling(); pullFromServer(); }
      });
    }

    function _stopPolling() {
      if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
      }
    }

    function _initialPullWithRetry(attempt = 0) {
      if (!Auth.isAuthenticated()) {
        if (attempt < 10) {
          setTimeout(() => _initialPullWithRetry(attempt + 1), 500);
        } else {
          console.warn('[Sync] initialPullWithRetry failed: not authenticated after 10 attempts');
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
            const newToken = Auth.getToken();
            if (newToken && retryAttempt < 1) {
              await new Promise(r => setTimeout(r, 500));
              return _apiRequest(method, path, body, retryAttempt + 1);
            }
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
        if (retryAttempt < MAX_RETRIES && err.name !== 'AbortError' && (err.message?.includes('fetch') || err.name === 'TypeError')) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * Math.pow(2, retryAttempt)));
          return _apiRequest(method, path, body, retryAttempt + 1);
        }
        console.error('[Sync] API request failed:', err);
        throw err;
      }
    }

    function _buildPayload(items) {
      return {
        [endpoint]: items.map(item => ({
          id: String(item.id),
          ...buildPayload(item),
          updated_at: item.updated_at || Date.now(),
          deleted: item.deleted || false,
          order: item.order ?? 0,
        })),
      };
    }

    function _toLocal(serverItem) {
      return {
        id: Number(serverItem.id) || serverItem.id,
        ...toLocal(serverItem),
        updated_at: serverItem.updated_at,
        deleted: serverItem.deleted || false,
        order: serverItem.order ?? 0,
      };
    }

    function _merge(localItems, serverItems) {
      const merged = new Map();
      const serverMap = new Map(serverItems.map(si => [String(si.id), si]));

      for (const li of localItems) {
        const id = String(li.id);
        const serverItem = serverMap.get(id);

        if (!serverItem) {
          if (!li.deleted) merged.set(id, li);
        } else if (!serverItem.deleted && serverItem.updated_at <= (li.updated_at || 0)) {
          merged.set(id, li);
        } else if (!serverItem.deleted) {
          merged.set(id, _toLocal(serverItem));
        }
      }

      for (const si of serverItems) {
        const id = String(si.id);
        if (!merged.has(id) && !si.deleted) {
          merged.set(id, _toLocal(si));
        }
      }

      return Array.from(merged.values());
    }

    function _saveLocal(items) {
      try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch {}
    }

    async function pullFromServer() {
      if (!_syncEnabled || _isSyncing) return;
      _isSyncing = true;
      let pullFailed = true;

      try {
        const data = await _apiRequest('GET', `/${endpoint}`);
        pullFailed = false;
        const serverItems = data[endpoint] || [];
        let merged = _merge(getItems(), serverItems);

        if (maxItems) {
          const isCompleted = t => (t.completed !== undefined ? t.completed : false);
          const completed = merged.filter(t => isCompleted(t) && !t.deleted);
          if (completed.length > maxItems) {
            const toKeep = [...completed].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, maxItems);
            const toWipe = completed.filter(t => !toKeep.includes(t));
            if (toWipe.length > 0) {
              try {
                const wipeData = await _apiRequest('POST', `/${endpoint}`, _buildPayload(toWipe.map(t => ({ ...t, deleted: true, updated_at: Date.now() }))));
                merged = _merge(merged, wipeData[endpoint] || []);
              } catch {}
            }
            merged = [...merged.filter(t => !isCompleted(t) || t.deleted), ...toKeep];
          }
        }

        const serverIds = new Set(serverItems.map(si => String(si.id)));
        const localOnly = merged.filter(si => !serverIds.has(String(si.id)));
        if (localOnly.length > 0) {
          try {
            const pushData = await _apiRequest('POST', `/${endpoint}`, _buildPayload(localOnly));
            merged = _merge(merged, pushData[endpoint] || []);
          } catch {}
        }

        setItems(merged);
        _saveLocal(merged);
        render();
      } catch {} finally {
        if (pullFailed) {
          try {
            const merged = getItems();
            const localOnly = merged.filter(si => !si.deleted);
            if (localOnly.length > 0) {
              await _apiRequest('POST', `/${endpoint}`, _buildPayload(localOnly));
            }
          } catch {}
        }
        _isSyncing = false;
      }
    }

    async function pushToServer(changedItems) {
      if (!_syncEnabled || !changedItems?.length) return;

      try {
        const data = await _apiRequest('POST', `/${endpoint}`, _buildPayload(changedItems));
        setItems(_merge(getItems(), data[endpoint] || []));
        _saveLocal(getItems());
        render();
      } catch (err) { console.error('[Sync] pushToServer failed:', err); }
    }

    return { init, pullFromServer, pushToServer };
  }

  return { create };
})();
