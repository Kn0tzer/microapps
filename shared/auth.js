const Auth = (() => {
  let _identity = null;
  let _listeners = [];
  let _initialized = false;
  let _hasNotifiedSignIn = false;

  function init() {
    if (_initialized) return;
    _initialized = true;
    _loadStoredIdentity();
    _pollForShooCallback();
  }

  function _loadStoredIdentity() {
    const stored = localStorage.getItem('shoo_identity');
    if (!stored) return;
    try {
      _identity = JSON.parse(stored);
      if (!_identity?.token) {
        _identity = null;
        return;
      }
      const payload = JSON.parse(atob(_identity.token.split('.')[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        _identity = null;
        localStorage.removeItem('shoo_identity');
      }
    } catch {
      _identity = null;
      localStorage.removeItem('shoo_identity');
    }
  }

  function _pollForShooCallback() {
    if (_identity?.token) return;

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;

      const shooIdentity = localStorage.getItem('shoo_identity');
      let sdkIdentity = null;
      if (window.Shoo) {
        try { sdkIdentity = window.Shoo.getIdentity(); } catch {}
      }

      const rawIdentity = shooIdentity || (sdkIdentity?.token ? sdkIdentity : null);

      if (rawIdentity) {
        clearInterval(interval);
        try {
          const parsed = typeof rawIdentity === 'string' ? JSON.parse(rawIdentity) : rawIdentity;
          const newIdentity = {
            userId: parsed.userId || parsed.pairwise_sub,
            token: parsed.token || parsed.id_token,
          };

          if (newIdentity.token && newIdentity.userId) {
            _identity = newIdentity;
            localStorage.setItem('shoo_identity', JSON.stringify(_identity));

            if (!_hasNotifiedSignIn) {
              _hasNotifiedSignIn = true;
              _notifyListeners('signed_in');
              if (typeof Sync !== 'undefined' && Sync.pullFromServer) {
                setTimeout(() => Sync.pullFromServer(), 200);
              }
            }
          }
        } catch {}
      }

      if (attempts >= 300) clearInterval(interval);
    }, 100);
  }

  function signIn() {
    if (!window.Shoo) return;
    try {
      window.Shoo.startSignIn({ returnTo: window.location.pathname });
    } catch {}
  }

  function signOut() {
    try { window.Shoo?.clearIdentity(); } catch {}
    _identity = null;
    _hasNotifiedSignIn = false;
    localStorage.removeItem('shoo_identity');
    _notifyListeners('signed_out');
  }

  function getToken() { return _identity?.token || null; }
  function isAuthenticated() { return !!(_identity?.token && _identity?.userId); }

  function onAuthChange(callback) {
    _listeners.push(callback);
    return () => { _listeners = _listeners.filter(l => l !== callback); };
  }

  function _notifyListeners(state) {
    _listeners.forEach(cb => {
      try { cb(state, _identity); } catch {}
    });
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
          _notifyListeners('synced');
        } else {
          _identity = newId;
        }
        return true;
      }
    } catch {}
    return false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      setTimeout(refreshIdentity, 500);
    });
  } else {
    init();
    setTimeout(refreshIdentity, 500);
  }

  return { signIn, signOut, getToken, isAuthenticated, onAuthChange, refreshIdentity };
})();
