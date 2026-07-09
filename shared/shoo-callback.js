(function () {
  const msg = document.getElementById('msg');
  const home = document.getElementById('home');
  if (!msg || !home) return;
  const params = new URLSearchParams(window.location.search);
  const hasCode = params.has('code') && params.has('state');

  if (!hasCode) {
    msg.textContent = 'no sign-in in progress';
    home.style.display = 'inline-block';
    return;
  }

  let _done = false;

  function _showError(text) {
    if (_done) return;
    _done = true;
    msg.className = 'err';
    msg.textContent = text;
    home.style.display = 'inline-block';
  }

  // 3s timeout for the full sign-in flow
  setTimeout(function () {
    _showError('sign-in timed out. try again from the app.');
  }, 3000);

  // poll for Shoo SDK to load — cancel on success to avoid timeout false positive
  function _waitForSdk() {
    if (window.Shoo) return;
    var check = setTimeout(function () {
      if (!window.Shoo) {
        _showError('sign-in unavailable. try again later.');
      }
      // if Shoo arrives after this, the callback flow handles it
    }, 2000);
  }
  _waitForSdk();
})();
