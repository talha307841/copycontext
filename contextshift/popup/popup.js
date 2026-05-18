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
let lastMode = 'full';

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
    badge.style.color = '#f87171';
  } else {
    badge.textContent = `You're on ${platform.charAt(0).toUpperCase() + platform.slice(1)} ✓`;
    badge.style.color = '#34d399';
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

// On popup open
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const tab = tabs[0];
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
  chrome.runtime.sendMessage({ action: 'GET_HISTORY' }, res => {
    if (res && res.success) renderHistory(res.history);
  });
});

// Settings gear
qs('cs-settings').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

// History toggle
qs('cs-history-header').onclick = () => {
  const list = qs('cs-history-list');
  const toggle = qs('cs-history-toggle');
  if (list.style.display === 'none') {
    list.style.display = '';
    toggle.textContent = '▲';
  } else {
    list.style.display = 'none';
    toggle.textContent = '▼';
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
      showStatus(`${resp.messages.length} messages captured from ${resp.platform}`);
      qs('cs-mode-section').style.display = '';
      qs('cs-preview-section').style.display = 'none';
      qs('cs-transfer-section').style.display = 'none';
      lastMode = 'full';
      document.querySelectorAll('.cs-mode-card').forEach(card => card.classList.remove('selected'));
      document.querySelector('.cs-mode-card[data-mode="full"]').classList.add('selected');
      qs('cs-custom-focus').style.display = 'none';
    } else {
      showStatus(resp?.error || 'Could not capture conversation.', 'error');
    }
  });
};

// Mode card selection
Array.from(document.querySelectorAll('.cs-mode-card')).forEach(card => {
  card.onclick = () => {
    document.querySelectorAll('.cs-mode-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    lastMode = card.dataset.mode;
    if (lastMode === 'custom') {
      qs('cs-custom-focus').style.display = '';
    } else {
      qs('cs-custom-focus').style.display = 'none';
    }
  };
});

// Generate button
qs('cs-generate-btn').onclick = () => {
  if (!captured) return;
  const mode = lastMode;
  const messages = captured.messages;
  const sourcePlatform = captured.platform;
  const targetPlatform = qs('cs-inject-platform').value;
  qs('cs-preview-section').style.display = '';
  qs('cs-transfer-section').style.display = '';
  if (mode === 'full') {
    const formatted = formatFullContext(messages, sourcePlatform, targetPlatform);
    qs('cs-preview').value = formatted;
    showStatus('Full context formatted.');
    saveHistory(formatted, messages, sourcePlatform);
    return;
  }
  showStatus('Summarizing with NIM...');
  setLoading(true);
  chrome.runtime.sendMessage({
    action: 'SUMMARIZE_WITH_NIM',
    mode,
    customFocus: qs('cs-custom-focus').value,
    messages
  }, resp => {
    setLoading(false);
    if (resp?.usedFallback) {
      showStatus('⚠️ NIM unavailable — using local summary. Add your key in Settings.', 'error');
    } else if (resp && resp.success) {
      showStatus('✓ Summary generated by NVIDIA NIM', 'success');
    } else {
      showStatus(resp?.reason || 'Could not summarize.', 'error');
    }
    const summaryText = resp?.summary || extractiveSummarize(messages);
    qs('cs-preview').value = summaryText;
    saveHistory(summaryText, messages, sourcePlatform);
  });
};

// Copy to clipboard
qs('cs-copy-btn').onclick = () => {
  const text = qs('cs-preview').value;
  navigator.clipboard.writeText(text).then(() => {
    qs('cs-copy-btn').textContent = '✓ Copied!';
    setTimeout(() => qs('cs-copy-btn').textContent = 'Copy to Clipboard', 1800);
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
  chrome.runtime.sendMessage({ action: 'SAVE_TO_HISTORY', entry });
}
