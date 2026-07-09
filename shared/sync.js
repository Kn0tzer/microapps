const SyncFactory = (() => {
  function create(config) {
    if (!config || typeof config !== 'object') throw new Error('SyncFactory.create requires a config object');
    if (typeof config.getItems !== 'function') throw new Error('SyncFactory.create requires getItems function');
    if (typeof config.setItems !== 'function') throw new Error('SyncFactory.create requires setItems function');
    if (typeof config.buildPayload !== 'function') throw new Error('SyncFactory.create requires buildPayload function');
    if (typeof config.toLocal !== 'function') throw new Error('SyncFactory.create requires toLocal function');
    if (typeof config.render !== 'function') throw new Error('SyncFactory.create requires render function');
    if (!config.endpoint) throw new Error('SyncFactory.create requires endpoint');
    if (!config.storageKey) throw new Error('SyncFactory.create requires storageKey');
    const { endpoint, storageKey, maxItems, maxItemsFilter, buildPayload, toLocal, getItems, setItems, render } = config;

    const API_BASE = window.location.origin + '/api';
    const POLL_INTERVAL = 30000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;

    let _pollTimer = null;
    let _isSyncing = false;
    let _syncEnabled = false;
    let _syncedOnce = false;
    let _visibilityHandler = null;

    function init() {
      _syncEnabled = Auth.isAuthenticated();
      Auth.onAuthChange((state) => {
        if (state === 'signed_in' || state === 'synced') {
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
      if (_visibilityHandler) {
        document.removeEventListener('visibilitychange', _visibilityHandler);
      }
      _visibilityHandler = () => {
        if (document.hidden) { _stopPolling(); }
        else if (_syncEnabled) { _startPolling(); pullFromServer(); }
      };
      document.addEventListener('visibilitychange', _visibilityHandler);
    }

    function _stopPolling() {
      if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
      }
    }

    function _initialPullWithRetry() {
      let attempts = 0;
      function tryPull() {
        attempts++;
        pullFromServer().catch(() => {
          if (attempts < 3) setTimeout(tryPull, RETRY_DELAY * Math.pow(2, attempts - 1));
        });
      }
      tryPull();
    }

    async function _apiRequest(method, path, body) {
      let token = Auth.getToken();
      if (!token) throw new Error('Not authenticated');

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const url = API_BASE + path;
          const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
          const options = { method, headers };
          if (body) options.body = JSON.stringify(body);

          const response = await fetch(url, options);

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown');

            if (response.status === 401) {
              Auth.refreshIdentity();
              token = Auth.getToken();
              if (token) continue;
              throw new Error('Auth failed');
            }

            if (response.status >= 500 && attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, RETRY_DELAY * Math.pow(2, attempt)));
              continue;
            }

            throw new Error(`API ${response.status}: ${errorText}`);
          }

          return await response.json();
        } catch (err) {
          const isNetworkError = err.name === 'TypeError' || err.message?.includes('fetch');
          if (attempt < MAX_RETRIES && isNetworkError) {
            await new Promise(r => setTimeout(r, RETRY_DELAY * Math.pow(2, attempt)));
            continue;
          }
          throw err;
        }
      }
    }

    function _serializePayload(items) {
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

    function _deserializeItem(serverItem) {
      return {
        id: serverItem.id != null ? String(serverItem.id) : '',
        ...toLocal(serverItem),
        updated_at: serverItem.updated_at,
        deleted: serverItem.deleted || false,
        order: serverItem.order ?? 0,
      };
    }

    function _merge(localItems, serverItems) {
      const merged = new Map();
      const serverMap = new Map(serverItems.map(si => [String(si.id), si]));
      const localDeletedIds = new Set(localItems.filter(li => li.deleted).map(li => String(li.id)));

      for (const li of localItems) {
        const id = String(li.id);
        const serverItem = serverMap.get(id);

        if (!serverItem) {
          if (!li.deleted) merged.set(id, li);
        } else if (!serverItem.deleted && serverItem.updated_at <= (li.updated_at || 0)) {
          merged.set(id, li);
        } else if (!serverItem.deleted) {
          merged.set(id, _deserializeItem(serverItem));
        }
      }

      for (const si of serverItems) {
        const id = String(si.id);
        if (!merged.has(id) && !si.deleted && !localDeletedIds.has(id)) {
          merged.set(id, _deserializeItem(si));
        }
      }

      return Array.from(merged.values());
    }

    function _saveLocal(items) {
      try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch (e) { console.error('sync: failed to save to localStorage', e); }
    }

    async function pullFromServer() {
      if (!_syncEnabled || _isSyncing) return;
      _isSyncing = true;

      try {
        const data = await _apiRequest('GET', `/${endpoint}`);
        const serverItems = data[endpoint] || [];
        let merged = _merge(getItems(), serverItems);

        if (maxItems) {
          const filterFn = typeof maxItemsFilter === 'function' ? maxItemsFilter : t => (t.completed !== undefined ? t.completed : false) && !t.deleted;
          const completed = merged.filter(filterFn);
          if (completed.length > maxItems) {
            const toKeep = [...completed].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, maxItems);
            const toWipe = completed.filter(t => !toKeep.includes(t));
            if (toWipe.length > 0) {
              try {
                const wipeData = await _apiRequest('POST', `/${endpoint}`, _serializePayload(toWipe.map(t => ({ ...t, deleted: true, updated_at: Date.now() }))));
                merged = _merge(merged, wipeData[endpoint] || []);
              } catch (e) { console.error('sync: failed to wipe excess items', e); }
            }
            merged = [...merged.filter(t => !(t.completed !== undefined ? t.completed : false) || t.deleted), ...toKeep];
          }
        }

        if (!_syncedOnce) {
          const serverIds = new Set(serverItems.map(si => String(si.id)));
          const localOnly = merged.filter(si => !serverIds.has(String(si.id)));
          if (localOnly.length > 0) {
            try {
              const pushData = await _apiRequest('POST', `/${endpoint}`, _serializePayload(localOnly));
              merged = _merge(merged, pushData[endpoint] || []);
            } catch (e) { console.error('sync: failed to push local items on initial sync', e); }
          }
          _syncedOnce = true;
        }

        setItems(merged);
        _saveLocal(merged);
        render();
      } catch (e) {
        console.error('sync: pull failed', e);
        try {
          const localOnly = getItems().filter(si => !si.deleted);
          if (localOnly.length > 0) {
            await _apiRequest('POST', `/${endpoint}`, _serializePayload(localOnly));
          }
        } catch (e2) { console.error('sync: fallback push after pull failure failed', e2); }
      } finally {
        _isSyncing = false;
      }
    }

    async function pushToServer(changedItems) {
      if (!_syncEnabled || !changedItems?.length) return;

      try {
        const data = await _apiRequest('POST', `/${endpoint}`, _serializePayload(changedItems));
        setItems(_merge(getItems(), data[endpoint] || []));
        _saveLocal(getItems());
        render();
      } catch (e) { console.error('sync: push failed', e); }
    }

    return { init, pullFromServer, pushToServer };
  }

  return { create };
})();
