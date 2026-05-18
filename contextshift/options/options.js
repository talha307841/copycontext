// ContextShift options.js — Settings page logic
function qs(id) { return document.getElementById(id); }

function loadSettings() {
  chrome.storage.local.get([
    'nim_api_key', 'summ_mode', 'max_len', 'save_history'
  ], data => {
    if (data.nim_api_key) qs('nim-key').value = data.nim_api_key;
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

function saveSettings() {
  const settings = {
    nim_api_key: qs('nim-key').value.trim(),
    summ_mode: document.querySelector('input[name="summ-mode"]:checked').value,
    max_len: parseInt(qs('max-len').value, 10),
    save_history: qs('save-history').checked
  };
  chrome.storage.local.set(settings);
}

function debounce(fn, ms) {
  let t;
  return function() {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, arguments), ms);
  };
}

qs('nim-key').oninput = debounce(saveSettings, 500);
qs('mode-full').onchange = saveSettings;
qs('mode-smart').onchange = saveSettings;
qs('mode-custom').onchange = saveSettings;
qs('max-len').oninput = function() {
  qs('max-len-val').textContent = this.value;
  saveSettings();
};
qs('save-history').onchange = saveSettings;

qs('nim-save').onclick = saveSettings;

qs('clear-history').onclick = function() {
  chrome.storage.local.remove(['cs_history'], () => {
    alert('History cleared.');
  });
};

qs('nim-test').onclick = function() {
  const key = qs('nim-key').value.trim();
  if (!key) {
    qs('nim-test-result').textContent = 'Enter your NIM API key first.';
    qs('nim-test-result').style.color = '#f87171';
    return;
  }
  qs('nim-test-result').textContent = 'Testing...';
  qs('nim-test-result').style.color = '#7c5cfc';
  fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'nvidia/llama-3.1-nemotron-70b-instruct',
      max_tokens: 1,
      stream: false,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' }
      ]
    })
  }).then(r => r.json()).then(data => {
    if (data.choices && data.choices[0]?.message?.content) {
      qs('nim-test-result').textContent = `Success! Model: ${data.model || 'N/A'}`;
      qs('nim-test-result').style.color = '#34d399';
    } else {
      qs('nim-test-result').textContent = 'Invalid key or error.';
      qs('nim-test-result').style.color = '#f87171';
    }
  }).catch(() => {
    qs('nim-test-result').textContent = 'Connection failed.';
    qs('nim-test-result').style.color = '#f87171';
  });
};

document.addEventListener('DOMContentLoaded', loadSettings);
