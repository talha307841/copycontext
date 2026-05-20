// ContextShift popup.js — Handles popup logic
const TARGET_URLS = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/',
  perplexity: 'https://www.perplexity.ai/',
  grok: 'https://grok.com/',
};

let captured = null;
let currentPlatform = null;
let currentTabId = null;

function detectPlatformFromUrl(url) {
  const host = (url || '').toLowerCase();
  if (host.includes('openai.com') || host.includes('chatgpt.com')) return 'chatgpt';
  if (host.includes('claude.ai')) return 'claude';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('perplexity.ai')) return 'perplexity';
  if (host.includes('grok.com') || host.includes('x.com/i/grok')) return 'grok';
  return null;
}

function sendTabMessageWithTimeout(tabId, payload, timeoutMs = 7000) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: 'Request timed out while reading this page.' });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, payload, resp => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: 'Could not reach page script. Refresh the tab and try again.' });
        return;
      }
      resolve(resp || { success: false, error: 'No response from page script.' });
    });
  });
}

function qs(id) { return document.getElementById(id); }
function showStatus(msg, type = '') {
  const bar = qs('cs-status-bar');
  bar.textContent = msg;
  bar.className = type;
}
function setLoading(loading) {
  const bar = qs('cs-status-bar');
  if (loading) bar.classList.add('loading');
  else bar.classList.remove('loading');
}
function renderPlatformBadge(platform) {
  const badge = qs('cs-platform-badge');
  if (!platform) {
    badge.textContent = 'Not on a supported AI platform';
    badge.className = 'cs-platform-badge not-detected';
  } else {
    badge.textContent = `\u2022 ${platform.charAt(0).toUpperCase() + platform.slice(1)} detected`;
    badge.className = 'cs-platform-badge detected';
  }
}
function renderApiBadge(connected) {
  const badge = qs('cs-api-badge');
  if (!badge) return;
  if (connected) {
    badge.textContent = '\u25cf Connected';
    badge.className = 'cs-badge cs-badge--online';
  } else {
    badge.textContent = '\u25cf Offline';
    badge.className = 'cs-badge cs-badge--offline';
  }
}
function renderHistory(history) {
  const list = qs('cs-history-list');
  const empty = qs('cs-history-empty');
  list.innerHTML = '';
  if (!history || history.length === 0) {
    list.style.display = 'none';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  list.style.display = '';
  history.slice(0, 5).forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.sourcePlatform} • ${new Date(entry.timestamp).toLocaleString()} • ${entry.preview}`;
    li.onclick = () => {
      qs('cs-preview').value = entry.fullContext;
      qs('cs-preview-section').style.display = '';
      qs('cs-transfer-section').style.display = '';
    };
    list.appendChild(li);
  });
}
function formatFullContext(messages, sourcePlatform, targetPlatform) {
  const platformName = {
    chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini',
    perplexity: 'Perplexity', grok: 'Grok'
  };
  const conversationText = messages.map(m =>
    `${m.role === 'user' ? '👤 USER' : '🤖 ASSISTANT'}:\n${m.content}`
  ).join('\n\n---\n\n');
  return `[ContextShift Transfer: ${platformName[sourcePlatform] || sourcePlatform} → ${platformName[targetPlatform] || 'New AI'}]\n\nI was having the following conversation with another AI assistant. Please read the full context below and continue helping me from where we left off.\n\n${conversationText}\n\n---\nPlease confirm you've understood the above conversation context and ask me how you'd like to proceed.`;
}
function extractiveSummarize(messages) {
  if (!messages || messages.length === 0) return 'No conversation found.';
  const firstUser = messages.find(m => m.role === 'user');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const longestAssistant = messages.filter(m => m.role === 'assistant').sort((a, b) => b.content.length - a.content.length)[0];
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  return `## Context Handoff (Auto-summarized)\n\n**Original question:** ${firstUser?.content?.slice(0, 300) || 'N/A'}\n\n**Key response:** ${longestAssistant?.content?.slice(0, 500) || 'N/A'}\n\n**Where we left off:** ${lastUser?.content?.slice(0, 300) || 'N/A'}\n\n**Last AI response:** ${lastAssistant?.content?.slice(0, 300) || 'N/A'}\n\n(${messages.length} total messages in original conversation)`;
}

// On popup open — fetch history immediately, independently of tab detection
chrome.runtime.sendMessage({ action: 'GET_HISTORY' }, res => {
  if (res && res.success) renderHistory(res.history);
});

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const tab = tabs && tabs[0];
  if (!tab) return;
  currentTabId = tab.id;
  const urlPlatform = detectPlatformFromUrl(tab.url);
  sendTabMessageWithTimeout(tab.id, { action: 'GET_CONVERSATION' }, 5000).then(resp => {
    if (resp && resp.success) {
      currentPlatform = resp.platform;
      renderPlatformBadge(currentPlatform);
      qs('cs-capture-btn').disabled = false;
    } else {
      currentPlatform = urlPlatform;
      renderPlatformBadge(currentPlatform);
      qs('cs-capture-btn').disabled = !currentPlatform;
    }
  });

  // Render API connection badge
  chrome.storage.local.get(['nim_api_key'], (data) => {
    const hasKey = data.nim_api_key && !data.nim_api_key.includes('PASTE');
    renderApiBadge(hasKey);
  });

  // Update Generate button label to match the saved mode
  chrome.storage.local.get(['summ_mode'], (settings) => {
    const mode = settings.summ_mode || 'smart';
    const labels = {
      full:   'Generate Full Context',
      smart:  'Generate Smart Summary  (NVIDIA NIM)',
      custom: 'Generate Custom Summary  (NVIDIA NIM)',
    };
    qs('cs-generate-btn').textContent = labels[mode] || labels.smart;
  });

  // Restore a completed NIM stream if popup was closed mid-generation (< 5 min old)
  chrome.storage.local.get(['cs_nim_stream'], (data) => {
    const s = data.cs_nim_stream;
    if (!s || !s.text) return;
    const age = Date.now() - (s.ts || 0);
    if (age > 5 * 60 * 1000) return; // too old
    if (s.status === 'done') {
      qs('cs-preview-section').style.display = '';
      qs('cs-transfer-section').style.display = '';
      qs('cs-preview').value = s.text;
      showStatus('✓ Smart summary ready — powered by NVIDIA NIM', 'success');
    } else if (s.status === 'streaming') {
      qs('cs-preview-section').style.display = '';
      qs('cs-transfer-section').style.display = '';
      qs('cs-preview').value = s.text;
      showStatus('✍️ Still generating... (background)');
    }
  });
});

// Settings gear
qs('cs-settings').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

// History toggle — controls the wrapper div so both list & empty state collapse together
qs('cs-history-header').onclick = () => {
  const body = qs('cs-history-body');
  const chevron = qs('cs-history-chevron');
  const btn = qs('cs-history-header');
  const isOpen = body.style.display !== 'none';
  if (isOpen) {
    body.style.display = 'none';
    chevron.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  } else {
    body.style.display = '';
    chevron.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    // Re-fetch history when expanding
    chrome.runtime.sendMessage({ action: 'GET_HISTORY' }, res => {
      if (res && res.success) renderHistory(res.history);
    });
  }
};

// Capture button
qs('cs-capture-btn').onclick = () => {
  if (!currentPlatform) return;
  showStatus('Capturing conversation...');
  setLoading(true);
  sendTabMessageWithTimeout(currentTabId, { action: 'GET_CONVERSATION' }).then(resp => {
    setLoading(false);
    if (resp && resp.success) {
      captured = resp;
      showStatus(`${resp.messages.length} messages captured`);
      qs('cs-generate-section').style.display = '';
      qs('cs-preview-section').style.display = 'none';
      qs('cs-transfer-section').style.display = 'none';
      // Immediately persist so overlay paste & history both work
      chrome.runtime.sendMessage({
        action: 'STORE_CONTEXT_FROM_POPUP',
        messages: resp.messages,
        platform: resp.platform
      }, () => {
        chrome.runtime.sendMessage({ action: 'GET_HISTORY' }, res => {
          if (res && res.success) renderHistory(res.history);
        });
      });
    } else {
      showStatus(resp?.error || 'Could not capture conversation.', 'error');
    }
  });
};

// Generate button — respects summ_mode from Settings
qs('cs-generate-btn').onclick = () => {
  if (!captured) return;
  const messages = captured.messages;
  const sourcePlatform = captured.platform;

  // Read the mode the user chose in Settings before doing anything
  chrome.storage.local.get(['summ_mode'], (settings) => {
    const mode = settings.summ_mode || 'smart';

    qs('cs-preview-section').style.display = '';
    qs('cs-transfer-section').style.display = '';
    qs('cs-preview').value = '';

    // ── Full mode: skip NIM entirely, use raw formatted context ──────────────
    if (mode === 'full') {
      const fullContext = formatFullContext(messages, sourcePlatform, sourcePlatform);
      qs('cs-preview').value = fullContext;
      showStatus('✓ Full context ready to transfer', 'success');
      saveHistory(fullContext, messages, sourcePlatform);
      return;
    }

    // ── Smart / Custom mode: stream through NVIDIA NIM ────────────────────────
    showStatus('⏳ Connecting to NVIDIA NIM...');
    setLoading(true);

    let fullText = '';
    let streamDone = false;
    let pollTimer = null;

    function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

    function startStoragePoll() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        chrome.storage.local.get(['cs_nim_stream'], (data) => {
          const s = data.cs_nim_stream;
          if (!s || streamDone) { stopPoll(); return; }
          if (s.text && s.text.length > fullText.length) {
            fullText = s.text;
            qs('cs-preview').value = fullText;
            qs('cs-preview').scrollTop = qs('cs-preview').scrollHeight;
            showStatus('✍️ Generating... (background)');
          }
          if (s.status === 'done') {
            stopPoll(); streamDone = true;
            setLoading(false);
            showStatus('✓ Smart summary ready — powered by NVIDIA NIM', 'success');
            saveHistory(fullText, messages, sourcePlatform);
          } else if (s.status === 'error') {
            stopPoll(); streamDone = true;
            setLoading(false);
            const fallback = s.text || extractiveSummarize(messages);
            qs('cs-preview').value = fallback;
            showStatus('⚠️ Using local extraction — add NIM key in Settings for AI compression', 'error');
            saveHistory(fallback, messages, sourcePlatform);
          }
        });
      }, 400);
    }

    // Clear previous stream record before starting
    chrome.storage.local.remove('cs_nim_stream', () => {
      let port;
      try {
        port = chrome.runtime.connect({ name: 'nimStream' });
      } catch (e) {
        setLoading(false);
        showStatus('⚠️ Could not connect — reload the extension.', 'error');
        return;
      }

      port.postMessage({ messages, mode, customFocus: null });

      port.onMessage.addListener((msg) => {
        if (msg.chunk) {
          fullText += msg.chunk;
          qs('cs-preview').value = fullText;
          qs('cs-preview').scrollTop = qs('cs-preview').scrollHeight;
          showStatus('✍️ Streaming NVIDIA NIM response...');
        } else if (msg.done) {
          stopPoll(); streamDone = true;
          setLoading(false);
          showStatus('✓ Smart summary ready — powered by NVIDIA NIM', 'success');
          saveHistory(fullText, messages, sourcePlatform);
          port.disconnect();
        } else if (msg.error) {
          stopPoll(); streamDone = true;
          setLoading(false);
          const fallback = msg.fallback || extractiveSummarize(messages);
          qs('cs-preview').value = fallback;
          showStatus('⚠️ Using local extraction — add NIM key in Settings for AI compression', 'error');
          saveHistory(fallback, messages, sourcePlatform);
          port.disconnect();
        }
      });

      // Port closes when popup closes (tab switch) — fall back to polling storage
      port.onDisconnect.addListener(() => {
        if (!streamDone) startStoragePoll();
      });
    });
  });
};

// Copy to clipboard
qs('cs-copy-btn').onclick = () => {
  const text = qs('cs-preview').value;
  navigator.clipboard.writeText(text).then(() => {
    qs('cs-copy-btn').innerHTML = '\u2713 Copied!';
    setTimeout(() => {
      qs('cs-copy-btn').innerHTML = `<svg class="cs-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    }, 1800);
    showStatus('Copied to clipboard.', 'success');
  });
};

// Auto-inject
qs('cs-inject-btn').onclick = () => {
  const platform = qs('cs-inject-platform').value;
  const url = TARGET_URLS[platform];
  const text = qs('cs-preview').value;
  showStatus(`Opening ${platform.charAt(0).toUpperCase() + platform.slice(1)}...`);
  chrome.runtime.sendMessage({ action: 'INJECT_CONTEXT', targetUrl: url, contextText: text }, resp => {
    if (resp && resp.success) {
      showStatus('Context injected!');
    } else {
      showStatus('Auto-inject failed. Context copied to clipboard instead.', 'error');
      navigator.clipboard.writeText(text);
    }
  });
};

function saveHistory(fullContext, messages, sourcePlatform) {
  const entry = {
    id: Date.now(),
    timestamp: Date.now(),
    sourcePlatform,
    messageCount: messages.length,
    preview: (fullContext || '').slice(0, 100),
    fullContext,
    summary: fullContext
  };
  chrome.runtime.sendMessage({ action: 'SAVE_TO_HISTORY', entry }, () => {
    // Re-render history list after saving
    chrome.runtime.sendMessage({ action: 'GET_HISTORY' }, res => {
      if (res && res.success) renderHistory(res.history);
    });
  });
}

// Live-refresh history when overlay captures (writes cs_history in storage)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.cs_history) return;
  chrome.runtime.sendMessage({ action: 'GET_HISTORY' }, res => {
    if (res && res.success) renderHistory(res.history);
  });
});
