chrome.storage.local.get({ ioneInstalled: false }, (value) => {
  document.getElementById('status').textContent = value.ioneInstalled ? 'installed' : 'ready'
})
