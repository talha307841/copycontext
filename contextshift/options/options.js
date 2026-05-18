// ContextShift options.js — Settings page logic
// config.js is loaded before this file so CONTEXTSHIFT_CONFIG is available.

function qs(id) { return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['nim_api_key', 'summ_mode', 'max_len', 'save_history'], (data) => {
    if (data.nim_api_key) {
      qs('nim-api-key').value = data.nim_api_key;
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

  qs('save-nim-key').addEventListener('click', () => {
    const key = qs('nim-api-key').value.trim();
    if (!key || key.length < 10) {
      showNimStatus('Please enter a valid NIM API key', 'error');
      return;
    }

    chrome.storage.local.set({ nim_api_key: key }, () => {
      showNimStatus('✓ API key saved securely on this device', 'success');
    });
  });

  qs('test-nim-key').addEventListener('click', async () => {
    showNimStatus('Testing connection to NVIDIA NIM...', 'info');

    chrome.storage.local.get(['nim_api_key'], async (stored) => {
      const key = stored.nim_api_key
        || (typeof CONTEXTSHIFT_CONFIG !== 'undefined' ? CONTEXTSHIFT_CONFIG.NIM_API_KEY : null);

      if (!key || key.includes('PASTE-YOUR-KEY') || !key.startsWith('nvapi-')) {
        showNimStatus('✗ No valid API key found. Enter your key above and save first.', 'error');
        return;
      }

      const endpoint = typeof CONTEXTSHIFT_CONFIG !== 'undefined'
        ? CONTEXTSHIFT_CONFIG.NIM_ENDPOINT
        : 'https://integrate.api.nvidia.com/v1/chat/completions';

      const model = typeof CONTEXTSHIFT_CONFIG !== 'undefined'
        ? CONTEXTSHIFT_CONFIG.NIM_MODEL
        : 'nvidia/llama-3.1-nemotron-70b-instruct';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }]
          })
        });

        if (res.ok) {
          showNimStatus(`✓ Connected successfully — model: ${model}`, 'success');
        } else if (res.status === 401) {
          showNimStatus('✗ Invalid API key — check it at build.nvidia.com', 'error');
        } else if (res.status === 429) {
          showNimStatus('✓ Key valid (rate limited) — NIM is connected', 'success');
        } else {
          showNimStatus(`✗ API error ${res.status} — try again`, 'error');
        }
      } catch (e) {
        showNimStatus('✗ Network error — make sure you are online', 'error');
      }
    });
  });

  qs('mode-full').onchange = () => chrome.storage.local.set({ summ_mode: 'full' });
  qs('mode-smart').onchange = () => chrome.storage.local.set({ summ_mode: 'smart' });
  qs('mode-custom').onchange = () => chrome.storage.local.set({ summ_mode: 'custom' });

  qs('max-len').oninput = function() {
    qs('max-len-val').textContent = this.value;
    chrome.storage.local.set({ max_len: parseInt(this.value, 10) });
  };

  qs('save-history').onchange = function() {
    chrome.storage.local.set({ save_history: this.checked });
  };

  qs('clear-history').onclick = function() {
    chrome.storage.local.remove(['cs_history'], () => {
      alert('History cleared.');
    });
  };
});

function showNimStatus(message, type) {
  const el = qs('nim-status');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  el.className = `status-bar status-${type}`;

  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}
