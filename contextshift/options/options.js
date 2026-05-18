// ContextShift options.js — Settings page logic
// config.js is loaded before this file so CONTEXTSHIFT_CONFIG is available.

function qs(id) { return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', () => {
  // Only these models are confirmed working — anything else gets replaced
  const WORKING_MODELS = [
    'meta/llama-3.2-3b-instruct',
    'meta/llama-3.1-8b-instruct',
    'google/gemma-2-2b-it',
    'nvidia/nemotron-mini-4b-instruct'
  ];

  chrome.storage.local.get(['nim_api_key', 'nim_model', 'summ_mode', 'max_len', 'save_history'], (data) => {
    if (data.nim_api_key) {
      qs('nim-api-key').value = data.nim_api_key;
    }

    // Use stored model only if it's in the known-good list
    const storedModel = data.nim_model || '';
    const effectiveModel = WORKING_MODELS.includes(storedModel)
      ? storedModel
      : CONTEXTSHIFT_CONFIG.NIM_MODEL;

    qs('nim-model').value = effectiveModel;
    // Ensure dropdown shows selection (fallback to first option if value missing)
    if (!qs('nim-model').value) qs('nim-model').selectedIndex = 0;

    // Persist correction immediately so test/save both use the good model
    if (!WORKING_MODELS.includes(storedModel)) {
      chrome.storage.local.set({ nim_model: effectiveModel });
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
    const model = qs('nim-model').value.trim() || CONTEXTSHIFT_CONFIG.NIM_MODEL;
    if (!key || key.length < 10) {
      showNimStatus('Please enter a valid NIM API key', 'error');
      return;
    }

    chrome.storage.local.set({ nim_api_key: key, nim_model: model }, () => {
      showNimStatus(`✓ API key and model saved (${model})`, 'success');
    });
  });

  qs('test-nim-key').addEventListener('click', async () => {
    showNimStatus('Testing connection to NVIDIA NIM...', 'info');

    chrome.storage.local.get(['nim_api_key', 'nim_model'], async (stored) => {
      const key = stored.nim_api_key
        || (typeof CONTEXTSHIFT_CONFIG !== 'undefined' ? CONTEXTSHIFT_CONFIG.NIM_API_KEY : null);

      if (!key || key.includes('PASTE-YOUR-KEY') || !key.startsWith('nvapi-')) {
        showNimStatus('✗ No valid API key found. Enter your key above and save first.', 'error');
        return;
      }

      const endpoint = typeof CONTEXTSHIFT_CONFIG !== 'undefined'
        ? CONTEXTSHIFT_CONFIG.NIM_ENDPOINT
        : 'https://integrate.api.nvidia.com/v1/chat/completions';

      const model = (stored.nim_model || '')
        .trim()
        || (typeof CONTEXTSHIFT_CONFIG !== 'undefined'
          ? CONTEXTSHIFT_CONFIG.NIM_MODEL
          : 'nvidia/llama-3.1-nemotron-70b-instruct');

      if (!model || !model.includes('/')) {
        showNimStatus('✗ Invalid model format. Use a full model id like nvidia/llama-3.1-nemotron-70b-instruct', 'error');
        return;
      }

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
          return;
        }

        let apiMessage = '';
        try {
          const body = await res.json();
          apiMessage = body?.error?.message || body?.message || '';
        } catch (_) {
          apiMessage = '';
        }

        if (res.status === 401) {
          showNimStatus('✗ Invalid API key — check it at build.nvidia.com', 'error');
        } else if (res.status === 403) {
          showNimStatus(`✗ Access denied (403). Your key may not have access to model ${model}. ${apiMessage}`.trim(), 'error');
        } else if (res.status === 404) {
          showNimStatus(`✗ Not found (404). Model ${model} may be unavailable for your account, misspelled, or retired. ${apiMessage}`.trim(), 'error');
        } else if (res.status === 429) {
          showNimStatus('✓ Key valid (rate limited) — NIM is connected', 'success');
        } else {
          showNimStatus(`✗ API error ${res.status}${apiMessage ? ` — ${apiMessage}` : ''}`, 'error');
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
