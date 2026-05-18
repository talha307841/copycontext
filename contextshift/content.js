// ContextShift content.js — Content Script for all supported AI platforms

// Platform detection
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
    messageContainer: '[data-testid="human-turn"], [data-testid="ai-turn"], .human-turn, .assistant-turn',
    getRoleAttr: (el) => (el.dataset.testid?.includes('human') || String(el.className).includes('human')) ? 'user' : 'assistant',
    getContent: (el) => el.querySelector('.prose p, .whitespace-pre-wrap, [class*="message"]')?.innerText?.trim() || el.innerText?.trim(),
    inputBox: '[contenteditable="true"].ProseMirror, div[contenteditable="true"][placeholder]',
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
  const observer = new MutationObserver(() => {
    if (document.querySelector(sel)) {
      observer.disconnect();
      callback();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
