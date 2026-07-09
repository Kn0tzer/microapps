const Auth = (() => {
  let _identity = null;
  let _listeners = [];
  let _signedInNotified = false;
  let _pollTimer = null;

  function _notifyListeners(eventName) {
    _listeners.forEach(cb => {
      try { cb(eventName, _identity); } catch (e) { console.error('auth: listener error', e); }
    });
  }

  function _clearIdentity() {
    _identity = null;
    _signedInNotified = false;
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    localStorage.removeItem('shoo_identity');
    _notifyListeners('signed_out');
  }

  function _loadStoredIdentity() {
    const stored = localStorage.getItem('shoo_identity');
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (!parsed?.token) { _clearIdentity(); return; }
      const segments = parsed.token.split('.');
      if (!segments[1]) { _clearIdentity(); return; }
      const payload = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(segments[1].length + (4 - segments[1].length % 4) % 4, '=')));
      if (payload.exp && payload.exp * 1000 < Date.now()) { _clearIdentity(); return; }
      _identity = { userId: parsed.userId, token: parsed.token };
    } catch (e) { console.error('auth: failed to parse stored identity', e); _clearIdentity(); }
  }

  function _checkIdentity(rawIdentity) {
    try {
      const parsed = typeof rawIdentity === 'string' ? JSON.parse(rawIdentity) : rawIdentity;
      const newIdentity = {
        userId: parsed.userId || parsed.pairwise_sub,
        token: parsed.token || parsed.id_token,
      };
      if (newIdentity.token && newIdentity.userId) {
        if (_pollTimer) {
          clearInterval(_pollTimer);
          _pollTimer = null;
        }
        _identity = newIdentity;
        localStorage.setItem('shoo_identity', JSON.stringify(_identity));
        if (!_signedInNotified) {
          _signedInNotified = true;
          _notifyListeners('signed_in');
          if (typeof Sync !== 'undefined' && Sync.pullFromServer) {
            setTimeout(() => Sync.pullFromServer(), 200);
          }
        }
      }
    } catch (e) { console.error('auth: check identity error', e); }
  }

  function _pollIdentity() {
    if (_identity?.token) return;

    // use storage events for cross-tab / popup sign-ins
    window.addEventListener('storage', (e) => {
      if (e.key === 'shoo_identity' && e.newValue) {
        _checkIdentity(e.newValue);
      }
    });

    let attempts = 0;
    _pollTimer = setInterval(() => {
      if (_identity?.token) { clearInterval(_pollTimer); _pollTimer = null; return; }
      attempts++;
      const shooIdentity = localStorage.getItem('shoo_identity');
      let sdkIdentity = null;
      if (window.Shoo) {
        try { sdkIdentity = window.Shoo.getIdentity(); } catch (e) { console.error('auth: shoo getIdentity error', e); }
      }
      const rawIdentity = shooIdentity || (sdkIdentity?.token ? sdkIdentity : null);
      if (rawIdentity) {
        _checkIdentity(rawIdentity);
      }
      if (attempts >= 60) {
        clearInterval(_pollTimer);
        _pollTimer = null;
      }
    }, 500);
    window.addEventListener('pagehide', () => {
      if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
      }
    });
  }

  function signIn() {
    if (window.Shoo) {
      try { window.Shoo.startSignIn({ returnTo: window.location.pathname }); } catch (e) { console.error('auth: sign in error', e); }
    }
  }

  function signOut() {
    try { window.Shoo?.clearIdentity(); } catch (e) { console.error('auth: sign out error', e); }
    _clearIdentity();
  }

  function getToken() { return _identity?.token || null; }
  function getUserId() { return _identity?.userId || null; }
  function isAuthenticated() { return !!(_identity?.token && _identity?.userId); }

  function onAuthChange(callback) {
    _listeners.push(callback);
    return () => { _listeners = _listeners.filter(l => l !== callback); };
  }

  function refreshIdentity() {
    if (!window.Shoo) return false;
    try {
      const shooId = window.Shoo.getIdentity();
      if (shooId?.userId && shooId?.token) {
        const newId = { userId: shooId.userId, token: shooId.token };
        const stored = localStorage.getItem('shoo_identity');
        const storedParsed = stored ? JSON.parse(stored) : null;
        if (!storedParsed || storedParsed.token !== shooId.token) {
          _identity = newId;
          localStorage.setItem('shoo_identity', JSON.stringify(_identity));
          _notifyListeners('refreshed');
          _notifyListeners('synced');
        } else {
          _identity = newId;
        }
        if (!storedParsed && !_signedInNotified) {
          _signedInNotified = true;
          _notifyListeners('signed_in');
        }
        return true;
      }
    } catch (e) { console.error('auth: refresh identity error', e); }
    return false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      _loadStoredIdentity();
      _pollIdentity();
      setTimeout(refreshIdentity, 500);
    });
  } else {
    _loadStoredIdentity();
    _pollIdentity();
    setTimeout(refreshIdentity, 500);
  }

  return { signIn, signOut, getToken, getUserId, isAuthenticated, onAuthChange, refreshIdentity };
})();
