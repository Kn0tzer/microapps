const Auth = (() => {
  let _identity = null;
  let _listeners = [];
  let _initialized = false;
  let _hasNotifiedSignIn = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    const stored = localStorage.getItem('shoo_identity');
    if (stored) {
      try {
        _identity = JSON.parse(stored);
        if (_identity && _identity.token) {
          try {
            const payload = JSON.parse(atob(_identity.token.split('.')[1]));
            if (payload.exp && payload.exp * 1000 < Date.now()) {
              _identity = null;
              localStorage.removeItem('shoo_identity');
            }
          } catch {
            _identity = null;
            localStorage.removeItem('shoo_identity');
          }
        } else {
          _identity = null;
        }
      } catch {
        _identity = null;
        localStorage.removeItem('shoo_identity');
      }
    }

    _pollForShooCallback();
  }

  function _pollForShooCallback() {
    if (_identity && _identity.token) return;

    let attempts = 0;
    const maxAttempts = 300;
    const interval = setInterval(() => {
      attempts++;

      const shooIdentity = localStorage.getItem('shoo_identity');
      let sdkIdentity = null;
      if (window.Shoo) {
        try { sdkIdentity = window.Shoo.getIdentity(); } catch {}
      }

      const rawIdentity = shooIdentity || (sdkIdentity && sdkIdentity.token ? sdkIdentity : null);

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
              _triggerPostLoginSync();
            }
          }
        } catch {}
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 100);
  }

  function _triggerPostLoginSync() {
    if (typeof Sync !== 'undefined' && Sync.pullFromServer) {
      setTimeout(() => Sync.pullFromServer(), 200);
    }
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
  function isAuthenticated() { return !!(_identity && _identity.token && _identity.userId); }

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
      if (shooId && shooId.userId && shooId.token) {
        _identity = { userId: shooId.userId, token: shooId.token };
        localStorage.setItem('shoo_identity', JSON.stringify(_identity));
        _notifyListeners('refreshed');
        return true;
      }
    } catch {}
    return false;
  }

  function syncWithShooSDK() {
    if (!window.Shoo) return;
    try {
      const shooId = window.Shoo.getIdentity();
      if (shooId && shooId.userId && shooId.token) {
        const stored = localStorage.getItem('shoo_identity');
        const storedParsed = stored ? JSON.parse(stored) : null;
        if (!storedParsed || storedParsed.token !== shooId.token) {
          _identity = { userId: shooId.userId, token: shooId.token };
          localStorage.setItem('shoo_identity', JSON.stringify(_identity));
          _notifyListeners('synced');
        }
      } else if (isAuthenticated() && !shooId) {
        signOut();
      }
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      setTimeout(syncWithShooSDK, 500);
    });
  } else {
    init();
    setTimeout(syncWithShooSDK, 500);
  }

  return { signIn, signOut, getToken, isAuthenticated, onAuthChange, refreshIdentity };
})();
