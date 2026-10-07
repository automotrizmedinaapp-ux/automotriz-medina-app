(function () {
  var isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !isSecure) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js?v=20261006-v4-stage4-18-2-invoices', { updateViaCache: 'none' })
      .then(function (registration) {
        registration.update();
        setInterval(function () { registration.update(); }, 60 * 60 * 1000);
      })
      .catch(function () {});
  });
})();
