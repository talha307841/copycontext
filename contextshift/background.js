// ContextShift background.js — Chrome Extension MV3 Service Worker
importScripts('config.js');
importScripts('summarizer.js');
importScripts('lz-string.min.js');
importScripts('storage.js');

// Format full context for handoff
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

// Save to history (FIFO, max 10) — entries stored compressed
async function saveToHistory(entry) {
  return new Promise(resolve => {
    chrome.storage.local.get(['cs_history'], data => {
      const raw = data.cs_history || [];
      // Decompress existing entries (handles legacy uncompressed data too)
      let history = raw.map(item => csDecompress(item)).filter(Boolean);
      history.unshift(entry);
      if (history.length > 10) history = history.slice(0, 10);
      // Compress each entry before storing
      chrome.storage.local.set({ cs_history: history.map(csCompress) }, () => resolve());
    });
  });
}

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'CAPTURE_AND_STORE_FROM_TAB') {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'Could not identify active tab.' });
      return true;
    }
    chrome.tabs.sendMessage(tabId, { action: 'GET_CONVERSATION' }, async (resp) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: 'Conversation extraction unavailable on this page.' });
        return;
      }
      if (!resp?.success || !resp?.messages?.length) {
        sendResponse(resp || { success: false, error: 'No conversation found on page.' });
        return;
      }

      const sourcePlatform = resp.platform || 'unknown';
      const fullContext = formatFullContext(resp.messages, sourcePlatform, sourcePlatform);
      const latest = {
        id: Date.now(),
        timestamp: Date.now(),
        sourcePlatform,
        messageCount: resp.messages.length,
        messages: resp.messages,
        preview: fullContext.slice(0, 100),
        fullContext,
        summary: ''
      };

      const settings = await getStorage(['save_history']);
      await setStorage({ cs_last_context: csCompress(latest) });
      if (settings.save_history !== false) {
        await saveToHistory(latest);
      }

      sendResponse({
        success: true,
        platform: sourcePlatform,
        messageCount: resp.messages.length,
        preview: latest.preview
      });
    });
    return true;
  }

  if (message.action === 'PASTE_LAST_CONTEXT_IN_TAB') {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'Could not identify active tab.' });
      return true;
    }

    chrome.storage.local.get(['cs_last_context'], (data) => {
      const contextText = csDecompress(data.cs_last_context)?.fullContext;
      if (!contextText) {
        sendResponse({ success: false, error: 'No captured context found yet.' });
        return;
      }

      chrome.tabs.sendMessage(tabId, { action: 'INJECT_TEXT', text: contextText }, (resp) => {
        if (chrome.runtime.lastError || !resp?.success) {
          sendResponse({ success: false, error: 'Could not paste context into this page input.' });
          return;
        }
        sendResponse({ success: true, chars: contextText.length });
      });
    });
    return true;
  }

  if (message.action === 'GET_CONVERSATION_FROM_TAB') {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'Could not identify active tab.' });
      return true;
    }
    chrome.tabs.sendMessage(tabId, { action: 'GET_CONVERSATION' }, (resp) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: 'Conversation extraction unavailable on this page.' });
        return;
      }
      sendResponse(resp || { success: false, error: 'No response from content script.' });
    });
    return true;
  }

  if (message.action === 'SUMMARIZE_WITH_NIM') {
    const { messages, mode, customFocus } = message;

    chrome.storage.local.get(['nim_api_key', 'nim_model'], async (stored) => {
      const runtimeConfig = {
        ...CONTEXTSHIFT_CONFIG,
        NIM_API_KEY: stored.nim_api_key || CONTEXTSHIFT_CONFIG.NIM_API_KEY,
        NIM_MODEL: stored.nim_model || CONTEXTSHIFT_CONFIG.NIM_MODEL
      };

      const result = await callNIMSummarizer({
        messages,
        mode,
        customFocus,
        config: runtimeConfig
      });

      if (result.success) {
        sendResponse({ success: true, summary: result.summary });
      } else {
        const fallbackText = result.fallback || extractiveSummarize(messages);
        sendResponse({
          success: false,
          reason: result.reason,
          summary: fallbackText,
          usedFallback: true
        });
      }
    });

    return true;
  }

  if (message.action === 'EXTRACT_CONVERSATION') {
    chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      func: () => {
        return new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'GET_CONVERSATION' }, resolve);
        });
      }
    }, (results) => {
      if (chrome.runtime.lastError || !results || !results[0]?.result) {
        sendResponse({ success: false, error: 'Extraction failed' });
        return;
      }
      sendResponse(results[0].result);
    });
    return true;
  }

  if (message.action === 'SAVE_TO_HISTORY') {
    saveToHistory(message.entry).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'GET_HISTORY') {
    chrome.storage.local.get(['cs_history'], data => {
      const raw = data.cs_history || [];
      const history = raw.map(item => csDecompress(item)).filter(Boolean);
      sendResponse({ success: true, history });
    });
    return true;
  }

  if (message.action === 'CLEAR_HISTORY') {
    chrome.storage.local.remove(['cs_history'], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'TEST_NIM_CONNECTION') {
    chrome.storage.local.get(['nim_api_key'], async (stored) => {
      const key = stored.nim_api_key || CONTEXTSHIFT_CONFIG.NIM_API_KEY;
      if (!key || key.includes('PASTE-YOUR-KEY')) {
        sendResponse({ error: 'No API key saved yet' });
        return;
      }
      try {
        const res = await fetch(CONTEXTSHIFT_CONFIG.NIM_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: CONTEXTSHIFT_CONFIG.NIM_MODEL,
            max_tokens: 5,
            stream: false,
            messages: [{ role: 'user', content: 'test' }]
          })
        });
        if (res.ok) {
          sendResponse({ success: true, model: CONTEXTSHIFT_CONFIG.NIM_MODEL });
        } else {
          const errorData = await res.json().catch(() => ({}));
          sendResponse({
            success: false,
            status: res.status,
            error: errorData.error?.message || `HTTP ${res.status}`
          });
        }
      } catch (e) {
        sendResponse({ success: false, error: `Network error: ${e.message}` });
      }
    });
    return true;
  }

  if (message.action === 'NIM_SUMMARIZE_AND_PASTE') {
    // Called from overlay content script — summarizes last captured context with NIM then injects into page
    const tabId = sender?.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: 'No tab' }); return true; }

    chrome.storage.local.get(['cs_last_context', 'nim_api_key', 'nim_model'], async (stored) => {
      const lastCtx = csDecompress(stored.cs_last_context);
      const messages = lastCtx?.messages;

      if (!messages?.length) {
        // No messages stored — fall back to pasting raw fullContext
        const rawText = lastCtx?.fullContext;
        if (!rawText) { sendResponse({ success: false, error: 'No context captured yet' }); return; }
        chrome.tabs.sendMessage(tabId, { action: 'INJECT_TEXT', text: rawText }, (r) => {
          sendResponse(r?.success ? { success: true, usedNim: false } : { success: false });
        });
        return;
      }

      const runtimeConfig = {
        ...CONTEXTSHIFT_CONFIG,
        NIM_API_KEY: stored.nim_api_key || CONTEXTSHIFT_CONFIG.NIM_API_KEY,
        NIM_MODEL: stored.nim_model || CONTEXTSHIFT_CONFIG.NIM_MODEL
      };
      const result = await callNIMSummarizer({ messages, mode: 'smart', customFocus: null, config: runtimeConfig });
      const textToPaste = result.success ? result.summary : (lastCtx.fullContext || extractiveSummarize(messages));

      chrome.tabs.sendMessage(tabId, { action: 'INJECT_TEXT', text: textToPaste }, (r) => {
        sendResponse({ success: r?.success || false, usedNim: result.success });
      });
    });
    return true;
  }

  if (message.action === 'INJECT_TEXT_TO_SENDER') {
    // Called from floatingButton (content script) — injects text into the same tab
    const tabId = sender?.tab?.id;
    if (!tabId || !message.text) { sendResponse({ success: false }); return true; }
    chrome.tabs.sendMessage(tabId, { action: 'INJECT_TEXT', text: message.text }, (r) => {
      sendResponse(r?.success ? { success: true } : { success: false });
    });
    return true;
  }

  if (message.action === 'INJECT_CONTEXT') {
    const { targetUrl, contextText } = message;
    chrome.tabs.create({ url: targetUrl, active: true }, (tab) => {
      const tabId = tab.id;
      let injected = false;
      const timeout = setTimeout(() => {
        if (!injected) sendResponse({ success: false, error: 'Tab did not load in time.' });
      }, 15000);
      function handleUpdate(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(handleUpdate);
          clearTimeout(timeout);
          chrome.tabs.sendMessage(tabId, { action: 'INJECT_TEXT', text: contextText }, (resp) => {
            injected = true;
            if (chrome.runtime.lastError || !resp?.success) {
              // Fallback: copy to clipboard
              chrome.scripting.executeScript({
                target: { tabId },
                func: (text) => navigator.clipboard.writeText(text),
                args: [contextText]
              });
              sendResponse({ success: false, error: 'Inject failed, copied to clipboard.' });
            } else {
              sendResponse({ success: true });
            }
          });
        }
      }
      chrome.tabs.onUpdated.addListener(handleUpdate);
    });
    return true;
  }
});

// Streaming port handler — popup connects via chrome.runtime.connect({name:'nimStream'})
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'nimStream') return;

  port.onMessage.addListener(async ({ messages, mode, customFocus }) => {
    const domain = detectDomain(messages);
    const artifactSections = extractCriticalArtifacts(messages, domain);
    const artifactSection = formatArtifactSection(artifactSections, domain);

    chrome.storage.local.get(['nim_api_key', 'nim_model'], async (stored) => {
      const key = stored.nim_api_key || CONTEXTSHIFT_CONFIG.NIM_API_KEY;

      // Helper — never crash if popup already closed
      function safePost(msg) {
        try { port.postMessage(msg); } catch (_) {}
      }

      if (!key || key.includes('PASTE-YOUR-KEY')) {
        const fallback = extractiveSummarize(messages);
        safePost({ error: true, status: 'no_key', fallback });
        chrome.storage.local.set({ cs_nim_stream: { status: 'error', text: fallback, errorStatus: 'no_key', ts: Date.now() } });
        return;
      }

      const model = stored.nim_model || CONTEXTSHIFT_CONFIG.NIM_MODEL;
      const isCustom = mode === 'custom' && customFocus?.trim().length > 0;
      const systemPrompt = isCustom ? buildCustomSystemPrompt(customFocus) : NIM_SYSTEM_PROMPT;
      const maxTokens = isCustom ? CONTEXTSHIFT_CONFIG.MAX_TOKENS_CUSTOM : CONTEXTSHIFT_CONFIG.MAX_TOKENS_SUMMARY;
      const conversationText = formatConversationForNIM(messages, CONTEXTSHIFT_CONFIG.MAX_INPUT_CHARS);

      // Mark stream in-progress and keep SW alive
      chrome.storage.local.set({ cs_nim_stream: { status: 'streaming', text: '', ts: Date.now() } });
      chrome.alarms.create('nim_keepalive', { periodInMinutes: 0.4 });

      try {
        const response = await fetch(CONTEXTSHIFT_CONFIG.NIM_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            temperature: CONTEXTSHIFT_CONFIG.TEMPERATURE,
            top_p: CONTEXTSHIFT_CONFIG.TOP_P,
            max_tokens: maxTokens,
            stream: true,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Here is the conversation to analyze:\n\n${conversationText}` }
            ]
          })
        });

        if (!response.ok) {
          const fallback = extractiveSummarize(messages);
          safePost({ error: true, status: response.status, fallback });
          chrome.storage.local.set({ cs_nim_stream: { status: 'error', text: fallback, errorStatus: response.status, ts: Date.now() } });
          chrome.alarms.clear('nim_keepalive');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let storageFlushLen = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              if (artifactSection) {
                accumulated += artifactSection;
                safePost({ chunk: artifactSection });
              }
              safePost({ done: true });
              chrome.storage.local.set({ cs_nim_stream: { status: 'done', text: accumulated, ts: Date.now() } });
              chrome.alarms.clear('nim_keepalive');
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                accumulated += delta;
                safePost({ chunk: delta });
                // Flush to storage roughly every 80 chars to avoid write spam
                if (accumulated.length - storageFlushLen >= 80) {
                  storageFlushLen = accumulated.length;
                  chrome.storage.local.set({ cs_nim_stream: { status: 'streaming', text: accumulated, ts: Date.now() } });
                }
              }
            } catch (_) {}
          }
        }

        if (artifactSection) {
          accumulated += artifactSection;
          safePost({ chunk: artifactSection });
        }
        safePost({ done: true });
        chrome.storage.local.set({ cs_nim_stream: { status: 'done', text: accumulated, ts: Date.now() } });
        chrome.alarms.clear('nim_keepalive');

      } catch (e) {
        const fallback = extractiveSummarize(messages);
        safePost({ error: true, status: 'network', fallback });
        chrome.storage.local.set({ cs_nim_stream: { status: 'error', text: fallback, errorStatus: 'network', ts: Date.now() } });
        chrome.alarms.clear('nim_keepalive');
      }
    });
  });
});

// Keep service worker alive while streaming
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'nim_keepalive') {
    // Touch storage to prevent SW from going idle mid-stream
    chrome.storage.local.get(['cs_nim_stream'], () => {});
  }
});
