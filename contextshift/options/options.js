// ContextShift options.js — Settings page logic
// config.js is loaded before this file via service worker scripts

function qs(id) { return document.getElementById(id); }

function showStatus(msg, type = '') {
  const bar = qs('nim-status');
  bar.textContent = msg;
  bar.style.display = '';
  bar.className = 'status-bar ' + type;
  setTimeout(() => bar.style.display = 'none', 5000);
}

function loadSettings() {
  chrome.storage.local.get(['nim_api_key', 'summ_mode', 'max_len', 'save_history'], data => {
    if (data.nim_api_key) {
      const key = data.nim_api_key;
      qs('nim-api-key').value = key;
      qs('nim-api-key').placeholder = `Current: ${key.slice(0, 10)}...${key.slice(-4)}`;
    }
    if (data.summ_mode) {
      qs('mode-full').checked = data.summ_mode === 'full';
      qs('mode-smart').checked = data.summ_mode === 'smart';
      qs('mode-custom').checked = data.summ_mode === 'custom';
    }
    if (data.max_len) {
      qs('max-len').value = data.max_len;
      qs('max-len-val').textContent = data.max_len;
    }
    if (typeof data.save_history === 'boolean') {
      qs('save-history').checked = data.save_history;
    }
  });
}

function debounce(fn, ms) {
  let t;
  return function() {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, arguments), ms);
  };
}

// Save NIM key
document.getElementById('save-nim-key').addEventListener('click', () => {
  const key = qs('nim-api-key').value.trim();
  if (!key || key.length < 10) {
    showStatus('Please enter a valid NIM API key', 'error');
    return;
  }
  chrome.storage.local.set({ nim_api_key: key }, () => {
    showStatus('✓ API key saved securely', 'success');
  });
});

// Test connection
document.getElementById('test-nim-key').addEventListener('click', () => {
  showStatus('Testing connection...', 'info');
  // Use background service worker to bypass CORS
  chrome.runtime.sendMessage({ action: 'TEST_NIM_CONNECTION' }, (resp) => {
    if (resp?.success) {
      showStatus(`✓ Connected — model: ${resp.model}`, 'success');
    } else if (resp?.status === 401) {
      showStatus('✗ Invalid API key', 'error');
    } else if (resp?.status) {
      showStatus(`✗ Error ${resp.status}: ${resp.error || 'Unknown'}`, 'error');
    } else {
      showStatus(resp?.error || '✗ Connection failed', 'error');
    }
  });
});

// Summary mode selection
qs('mode-full').onchange = () => chrome.storage.local.set({ summ_mode: 'full' });
qs('mode-smart').onchange = () => chrome.storage.local.set({ summ_mode: 'smart' });
qs('mode-custom').onchange = () => chrome.storage.local.set({ summ_mode: 'custom' });

// Max length slider
qs('max-len').oninput = function() {
  qs('max-len-val').textContent = this.value;
  chrome.storage.local.set({ max_len: parseInt(this.value, 10) });
};

// Save history toggle
qs('save-history').onchange = function() {
  chrome.storage.local.set({ save_history: this.checked });
};

// Clear history
qs('clear-history').onclick = function() {
  chrome.storage.local.remove(['cs_history'], () => {
    alert('History cleared.');
  });
};

document.addEventListener('DOMContentLoaded', loadSettings);
