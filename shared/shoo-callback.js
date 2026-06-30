(function () {
  var msg = document.getElementById('msg');
  var home = document.getElementById('home');
  var params = new URLSearchParams(window.location.search);
  var hasCode = params.has('code') && params.has('state');

  if (!hasCode) {
    msg.textContent = 'no sign-in in progress';
    home.style.display = 'inline-block';
    return;
  }

  setTimeout(function () {
    msg.id = 'err';
    msg.textContent = 'sign-in timed out. try again from the app.';
    home.style.display = 'inline-block';
  }, 3000);
})();
