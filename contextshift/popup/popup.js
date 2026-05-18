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
  chrome.tabs.sendMessage(tab.id, { action: 'GET_CONVERSATION' }, resp => {
    if (resp && resp.success) {
      currentPlatform = resp.platform;
      renderPlatformBadge(currentPlatform);
      qs('cs-capture-btn').disabled = false;
    } else {
      currentPlatform = null;
      renderPlatformBadge(null);
      qs('cs-capture-btn').disabled = true;
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
  chrome.tabs.sendMessage(currentTabId, { action: 'GET_CONVERSATION' }, resp => {
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
    conversation: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
    mode,
    customFocus: qs('cs-custom-focus').value,
    messages
  }, resp => {
    setLoading(false);
    if (resp && resp.success) {
      qs('cs-preview').value = resp.summary;
      showStatus('Smart summary ready.');
      saveHistory(resp.summary, messages, sourcePlatform);
    } else {
      qs('cs-preview').value = resp?.fallback || extractiveSummarize(messages);
      showStatus(resp?.error || 'NIM unavailable, used auto-summary.', 'error');
      saveHistory(qs('cs-preview').value, messages, sourcePlatform);
    }
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
