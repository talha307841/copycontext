// ═════════════════════════════════════════════════════════════════════════════
// ContextShift — content.js
// Content script: platform detection, conversation extraction, text injection,
// and Shadow DOM floating overlay (merged from floatingButton.js)
// ═════════════════════════════════════════════════════════════════════════════

// ── Platform Detection ───────────────────────────────────────────────────────
function detectPlatform() {
  const host = window.location.hostname;
  if (host.includes('openai.com') || host.includes('chatgpt.com')) return 'chatgpt';
  if (host.includes('claude.ai')) return 'claude';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('perplexity.ai')) return 'perplexity';
  if (host.includes('grok.com') || host.includes('x.com')) return 'grok';
  return null;
}

// Platform selectors
const SELECTORS = {
  chatgpt: {
    messageContainer: '[data-message-author-role]',
    getRoleAttr: (el) => el.getAttribute('data-message-author-role'),
    getContent: (el) => el.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]')?.innerText?.trim() || el.innerText?.trim(),
    inputBox: '#prompt-textarea, [data-id="root"] textarea, div[contenteditable="true"][aria-label]',
    inputType: 'contenteditable',
  },
  claude: {
    messageContainer: '[data-testid="human-turn"], [data-testid="ai-turn"], [data-testid*="turn"], .human-turn, .assistant-turn',
    getRoleAttr: (el) => (el.dataset.testid?.includes('human') || String(el.className).includes('human')) ? 'user' : 'assistant',
    getContent: (el) => el.querySelector('[data-testid="message-content"], .prose, .whitespace-pre-wrap, [class*="message"]')?.innerText?.trim() || el.innerText?.trim(),
    inputBox: '[contenteditable="true"].ProseMirror, div.ProseMirror[contenteditable="true"], div[contenteditable="true"][placeholder], [contenteditable="true"][data-placeholder]',
    inputType: 'contenteditable',
  },
  gemini: {
    messageContainer: 'model-response, user-query, .conversation-container [class*="message"]',
    getRoleAttr: (el) => el.tagName?.toLowerCase() === 'user-query' ? 'user' : 'assistant',
    getContent: (el) => el.querySelector('.response-content, .query-text, [class*="text"]')?.innerText?.trim() || el.innerText?.trim(),
    inputBox: 'rich-textarea .ql-editor, [contenteditable="true"][aria-label*="message"], [contenteditable="true"][data-placeholder]',
    inputType: 'contenteditable',
  },
  perplexity: {
    messageContainer: '[data-testid="user-message"], [data-testid="answer"], .message, [class*="userMessage"], [class*="assistantMessage"]',
    getRoleAttr: (el) => (el.dataset.testid === 'user-message' || String(el.className).includes('user')) ? 'user' : 'assistant',
    getContent: (el) => el.innerText?.trim(),
    inputBox: 'textarea[placeholder*="Ask"], textarea[placeholder*="Follow"], textarea',
    inputType: 'textarea',
  },
  grok: {
    messageContainer: '[class*="UserMessage"], [class*="AssistantMessage"], [class*="message-bubble"]',
    getRoleAttr: (el) => (String(el.className).includes('User') || String(el.className).includes('human')) ? 'user' : 'assistant',
    getContent: (el) => el.querySelector('[class*="text"], p, div')?.innerText?.trim() || el.innerText?.trim(),
    inputBox: 'textarea[placeholder*="Ask"], textarea[aria-label], textarea',
    inputType: 'textarea',
  },
};

// Find first match for selector list
function findFirstMatch(selectorList) {
  for (const sel of selectorList.split(', ')) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// Extract conversation
function extractConversation(platform) {
  const sel = SELECTORS[platform];
  const elements = Array.from(document.querySelectorAll(sel.messageContainer));
  if (elements.length === 0) {
    return extractUniversalFallback();
  }
  const messages = [];
  elements.forEach(el => {
    const role = sel.getRoleAttr(el);
    const content = sel.getContent(el);
    if (content && content.length > 2) {
      const last = messages[messages.length - 1];
      if (last && last.role === role) {
        last.content += '\n' + content;
      } else {
        messages.push({ role, content });
      }
    }
  });
  return messages;
}

function extractUniversalFallback() {
  const allText = Array.from(document.querySelectorAll('p, [class*="message"], [class*="turn"], [class*="bubble"]'))
    .filter(el => el.innerText?.trim().length > 20 && el.children.length < 5)
    .map(el => ({ element: el, text: el.innerText.trim() }));
  return allText.map(({ text }) => ({ role: 'assistant', content: text }));
}

// Inject text into input
function injectTextIntoInput(text, platform) {
  const sel = SELECTORS[platform];
  const selectors = sel.inputBox.split(', ');
  let inputEl = null;
  for (const s of selectors) {
    inputEl = document.querySelector(s);
    if (inputEl) break;
  }
  if (!inputEl) {
    setTimeout(() => injectTextIntoInput(text, platform), 2000);
    return;
  }
  if (sel.inputType === 'contenteditable') {
    inputEl.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch (e) {
      inputEl.innerText = text;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(inputEl, text);
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
  } else {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeInputValueSetter.call(inputEl, text);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.focus();
  }
}

// MutationObserver for chat container
function waitForChatContainer(platform, callback) {
  const sel = SELECTORS[platform]?.messageContainer;
  if (!sel) return callback();
  if (document.querySelector(sel)) return callback();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    callback();
  };
  const observer = new MutationObserver(() => {
    if (document.querySelector(sel)) {
      finish();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Never wait forever. If selector is stale, fall back to universal extraction path.
  setTimeout(finish, 5000);
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_CONVERSATION') {
    const platform = detectPlatform();
    if (!platform) {
      sendResponse({ success: false, error: 'Platform not recognized' });
      return true;
    }
    waitForChatContainer(platform, () => {
      const messages = extractConversation(platform);
      if (!messages || messages.length === 0) {
        sendResponse({ success: false, error: "Couldn't find messages on this page. Try scrolling to load the chat first." });
      } else {
        sendResponse({ success: true, platform, messages });
      }
    });
  }
  if (message.action === 'INJECT_TEXT') {
    const platform = detectPlatform();
    if (platform && message.text) {
      setTimeout(() => injectTextIntoInput(message.text, platform), 1500);
      sendResponse({ success: true });
    }
  }
  return true;
});

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Shadow DOM Overlay \u2014 fully isolated from host page CSS
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const OVERLAY_CSS = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    pointer-events: none;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  .cs-panel {
    pointer-events: auto;
    width: 296px;
    background: #0D0E12;
    border: 1px solid #1F2937;
    border-radius: 14px;
    box-shadow:
      0 8px 40px rgba(0,0,0,0.7),
      0 0 0 1px rgba(124,58,237,0.08);
    overflow: hidden;
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px;
    transition: opacity 0.15s ease;
  }

  /* \u2500\u2500 Header \u2500\u2500 */
  .cs-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: #111318;
    border-bottom: 1px solid #1F2937;
    cursor: default;
    user-select: none;
  }

  .cs-logo {
    font-size: 12px;
    font-weight: 700;
    color: #A78BFA;
    letter-spacing: 0.01em;
    flex: 1;
  }

  .cs-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #374151;
    flex-shrink: 0;
    transition: background 0.3s, box-shadow 0.3s;
    title: 'No API key configured';
  }

  .cs-dot.connected {
    background: #10B981;
    box-shadow: 0 0 6px rgba(16,185,129,0.55);
  }

  .cs-collapse-btn {
    all: unset;
    color: #4B5563;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 0 2px 6px;
    transition: color 0.15s;
    flex-shrink: 0;
  }

  .cs-collapse-btn:hover { color: #9CA3AF; }

  /* \u2500\u2500 Body \u2500\u2500 */
  .cs-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .cs-panel.collapsed .cs-body {
    display: none;
  }

  /* \u2500\u2500 Capture button (primary) \u2500\u2500 */
  .cs-btn-capture {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    background: linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%);
    color: #fff;
    border-radius: 8px;
    padding: 11px 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    letter-spacing: 0.01em;
    box-shadow: 0 2px 14px rgba(124,58,237,0.45);
    transition: box-shadow 0.15s, opacity 0.15s;
    text-align: center;
    font-family: inherit;
  }

  .cs-btn-capture:hover {
    box-shadow: 0 4px 22px rgba(124,58,237,0.65);
    opacity: 0.95;
  }

  .cs-btn-capture:active { opacity: 0.82; }

  .cs-btn-capture:disabled {
    opacity: 0.42;
    cursor: not-allowed;
    box-shadow: none;
  }

  /* \u2500\u2500 Preview card \u2500\u2500 */
  .cs-preview-card {
    background: #0A0B0F;
    border: 1px solid #1F2937;
    border-radius: 8px;
    padding: 10px 12px;
    max-height: 84px;
    overflow: hidden;
    position: relative;
  }

  .cs-preview-card::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 28px;
    background: linear-gradient(transparent, #0A0B0F);
    pointer-events: none;
  }

  .cs-preview-text {
    font-family: 'Fira Code', 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
    font-size: 10.5px;
    line-height: 1.65;
    color: #6B7280;
    white-space: pre-wrap;
    word-break: break-all;
    overflow: hidden;
  }

  .cs-preview-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #374151;
    margin-bottom: 5px;
  }

  /* \u2500\u2500 Action row (Copy + Inject) \u2500\u2500 */
  .cs-actions {
    display: flex;
    gap: 7px;
  }

  .cs-btn-secondary {
    all: unset;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    background: #111827;
    color: #9CA3AF;
    border: 1px solid #1F2937;
    border-radius: 8px;
    padding: 9px 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s;
    text-align: center;
    font-family: inherit;
  }

  .cs-btn-secondary:hover {
    border-color: #7C3AED;
    background: #160D2E;
    color: #C4B5FD;
    box-shadow: 0 0 0 1px rgba(124,58,237,0.25);
  }

  .cs-btn-secondary:active { background: #1E1040; }

  .cs-btn-secondary:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* \u2500\u2500 Status bar \u2500\u2500 */
  .cs-status {
    font-size: 11px;
    color: #4B5563;
    min-height: 13px;
    line-height: 1.4;
    transition: color 0.2s;
  }

  .cs-status.success { color: #10B981; }
  .cs-status.error   { color: #F87171; }
  .cs-status.info    { color: #818CF8; }
`;

(function initOverlay() {
  // Top-frame guard: iframes should not render the overlay
  if (window.top !== window.self) return;
  // Duplicate injection guard
  if (document.getElementById('contextshift-root')) return;
  // Only inject on supported platforms
  if (!detectPlatform()) return;

  // \u2500\u2500 Build shadow host \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // The host element itself is pointer-events:none so it never blocks the page.
  // The .cs-panel inside the shadow root resets pointer-events:auto.
  const host = document.createElement('div');
  host.id = 'contextshift-root';
  // Inline styles must set the final position because :host CSS inside the shadow
  // has lower cascade priority than the host element's own style attribute.
  host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;pointer-events:none;display:block';

  const shadow = host.attachShadow({ mode: 'open' });

  // Inject CSS
  const styleEl = document.createElement('style');
  styleEl.textContent = OVERLAY_CSS;
  shadow.appendChild(styleEl);

  // Build panel
  const panel = document.createElement('div');
  panel.className = 'cs-panel';
  panel.innerHTML = `
    <div class="cs-header">
      <span class="cs-logo">\u2388 ContextShift</span>
      <span class="cs-dot" id="cs-dot" title="API status"></span>
      <button class="cs-collapse-btn" id="cs-collapse-btn" title="Collapse" aria-label="Collapse panel">\u2212</button>
    </div>
    <div class="cs-body">
      <button class="cs-btn-capture" id="cs-capture-btn">
        \u25b6\ufe0f&nbsp; Capture Conversation
      </button>
      <div class="cs-preview-card" id="cs-preview-card" style="display:none">
        <div class="cs-preview-label">Last Capture</div>
        <pre class="cs-preview-text" id="cs-preview-text"></pre>
      </div>
      <div class="cs-actions" id="cs-actions" style="display:none">
        <button class="cs-btn-secondary" id="cs-copy-btn">\uD83D\uDCCB Copy</button>
        <button class="cs-btn-secondary" id="cs-inject-btn">\u21AA\uFE0F Inject</button>
      </div>
      <div class="cs-status" id="cs-status"></div>
    </div>
  `;
  shadow.appendChild(panel);

  // \u2500\u2500 Mount & SPA re-mount guard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function mountHost() {
    if (!document.getElementById('contextshift-root')) {
      (document.body || document.documentElement).appendChild(host);
    }
  }
  mountHost();

  // Watch for body-level child removals (SPA routers that swap the body subtree)
  const spaObserver = new MutationObserver(mountHost);
  spaObserver.observe(document.documentElement, { childList: true });
  if (document.body) spaObserver.observe(document.body, { childList: true });

  // \u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const $ = (id) => shadow.getElementById(id);

  /** Send a message to the background service worker with proper error handling.
   *  Wraps chrome.runtime.sendMessage so it never throws on an inactive SW. */
  function sendMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { success: false, error: 'No response from background.' });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }

  /** Read one or more keys from chrome.storage.local. */
  function getStorage(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  /** Update the in-panel status message. */
  function setStatus(msg, type = '') {
    const el = $('cs-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'cs-status' + (type ? ' ' + type : '');
  }

  /** Show a preview of the last captured context inside the card. */
  function showPreview(preview) {
    if (!preview) return;
    const card = $('cs-preview-card');
    const pre = $('cs-preview-text');
    if (card && pre) {
      pre.textContent = preview;
      card.style.display = '';
    }
    const actions = $('cs-actions');
    if (actions) actions.style.display = '';
  }

  // \u2500\u2500 Collapse / Expand \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  let isCollapsed = false;
  $('cs-collapse-btn').addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    panel.classList.toggle('collapsed', isCollapsed);
    $('cs-collapse-btn').textContent = isCollapsed ? '+' : '\u2212';
    $('cs-collapse-btn').title = isCollapsed ? 'Expand' : 'Collapse';
  });

  // \u2500\u2500 Capture button \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  $('cs-capture-btn').addEventListener('click', async () => {
    const btn = $('cs-capture-btn');
    btn.disabled = true;
    btn.innerHTML = '\u23f3&nbsp; Capturing\u2026';
    setStatus('Extracting conversation\u2026', 'info');

    // Race: 9 s timeout as a safety net in case SW never responds
    const timer = new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, error: 'Request timed out.' }), 9000)
    );
    const resp = await Promise.race([
      sendMessage({ action: 'CAPTURE_AND_STORE_FROM_TAB' }),
      timer,
    ]);

    if (resp && resp.success) {
      btn.innerHTML = `\u2713&nbsp; ${resp.messageCount} msgs captured`;
      setStatus(`${resp.messageCount} messages captured`, 'success');
      showPreview(resp.preview || 'Capture complete.');
    } else {
      btn.innerHTML = '\u26a0\ufe0f&nbsp; Error';
      setStatus(resp?.error || 'Capture failed.', 'error');
    }

    setTimeout(() => {
      btn.innerHTML = '\u25b6\ufe0f&nbsp; Capture Conversation';
      btn.disabled = false;
    }, 2200);
  });

  // \u2500\u2500 Copy button \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  $('cs-copy-btn').addEventListener('click', async () => {
    const btn = $('cs-copy-btn');
    btn.disabled = true;
    setStatus('Reading context\u2026', 'info');

    // Ask background to decompress and return the full context text
    const resp = await sendMessage({ action: 'GET_LAST_CONTEXT_TEXT' });

    if (resp?.success && resp.text) {
      try {
        await navigator.clipboard.writeText(resp.text);
        btn.textContent = '\u2713 Copied!';
        setStatus('Copied to clipboard.', 'success');
      } catch (_) {
        btn.textContent = '\u26a0 Failed';
        setStatus('Clipboard access denied.', 'error');
      }
    } else {
      btn.textContent = '\u26a0 None';
      setStatus(resp?.error || 'No context captured yet.', 'error');
    }

    setTimeout(() => { btn.innerHTML = '\uD83D\uDCCB Copy'; btn.disabled = false; }, 2000);
  });

  // \u2500\u2500 Auto-Inject button \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  $('cs-inject-btn').addEventListener('click', async () => {
    const btn = $('cs-inject-btn');
    btn.disabled = true;
    btn.textContent = '\u23f3 Processing\u2026';
    setStatus('Summarizing with NVIDIA NIM\u2026', 'info');

    // Timeout wrapper
    const timer = new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, error: 'Request timed out.' }), 50000)
    );
    const resp = await Promise.race([
      sendMessage({ action: 'NIM_SUMMARIZE_AND_PASTE' }),
      timer,
    ]);

    if (resp?.success) {
      btn.textContent = '\u2713 Injected!';
      setStatus(resp.usedNim ? '\u2713 NIM summary injected.' : '\u2713 Context injected.', 'success');
    } else {
      btn.textContent = '\u26a0 Failed';
      setStatus(resp?.error || 'Inject failed.', 'error');
    }

    setTimeout(() => { btn.innerHTML = '\u21AA\uFE0F Inject'; btn.disabled = false; }, 2200);
  });

  // \u2500\u2500 Startup: check API key status + restore existing preview \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  (async () => {
    try {
      const data = await getStorage(['nim_api_key', 'cs_last_context']);
      const dot = $('cs-dot');
      if (data.nim_api_key && !data.nim_api_key.includes('PASTE')) {
        if (dot) { dot.classList.add('connected'); dot.title = 'NVIDIA NIM connected'; }
      } else {
        if (dot) dot.title = 'No API key \u2014 configure in Settings';
      }
      // Restore preview from last capture if any
      if (data.cs_last_context) {
        const previewResp = await sendMessage({ action: 'GET_LAST_CONTEXT_TEXT' });
        if (previewResp?.success && previewResp.text) {
          showPreview(previewResp.text.slice(0, 120));
        }
      }
    } catch (_) {
      // Storage may be unavailable on very first load \u2014 silently ignore.
    }
  })();
})();
