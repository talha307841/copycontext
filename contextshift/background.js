// ContextShift background.js — Chrome Extension MV3 Service Worker

const NIM_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NIM_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct';
const NIM_SYSTEM_PROMPT = `You are a conversation context transfer assistant. Given a conversation between a user and an AI assistant, create a concise handoff brief that lets a NEW AI assistant immediately understand:\n1. What was being worked on (project/task/goal)\n2. Key decisions already made\n3. Important code, data, or specific details mentioned\n4. What the user needs next (the unresolved question or next step)\n\nFormat your response as:\n## Context Handoff Brief\n**Working on:** [1-2 sentences]\n**Key decisions/facts:** [bullet list]\n**Current code/data:** [only if present, code blocks]\n**Next step needed:** [1 sentence — what the user was about to ask or needs]\n\nBe extremely concise. The brief must fit in one message. Omit pleasantries and filler from the original conversation.`;

// Extractive fallback summarizer
function extractiveSummarize(messages) {
  if (!messages || messages.length === 0) return 'No conversation found.';
  const firstUser = messages.find(m => m.role === 'user');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const longestAssistant = messages.filter(m => m.role === 'assistant').sort((a, b) => b.content.length - a.content.length)[0];
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  return `## Context Handoff (Auto-summarized)\n\n**Original question:** ${firstUser?.content?.slice(0, 300) || 'N/A'}\n\n**Key response:** ${longestAssistant?.content?.slice(0, 500) || 'N/A'}\n\n**Where we left off:** ${lastUser?.content?.slice(0, 300) || 'N/A'}\n\n**Last AI response:** ${lastAssistant?.content?.slice(0, 300) || 'N/A'}\n\n(${messages.length} total messages in original conversation)`;
}

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

// Save to history (FIFO, max 10)
async function saveToHistory(entry) {
  return new Promise(resolve => {
    chrome.storage.local.get(['cs_history'], data => {
      let history = data.cs_history || [];
      history.unshift(entry);
      if (history.length > 10) history = history.slice(0, 10);
      chrome.storage.local.set({ cs_history: history }, () => resolve());
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
        preview: fullContext.slice(0, 100),
        fullContext,
        summary: ''
      };

      const settings = await getStorage(['save_history']);
      await setStorage({ cs_last_context: latest });
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
      const contextText = data.cs_last_context?.fullContext;
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
    chrome.storage.local.get(['nim_api_key'], async (data) => {
      const key = data.nim_api_key;
      const { conversation, mode, customFocus, messages } = message;
      if (!key) {
        // Fallback
        const fallback = extractiveSummarize(messages);
        sendResponse({ success: false, error: 'No NIM key', fallback });
        return;
      }
      try {
        let userPrompt = conversation;
        if (mode === 'custom' && customFocus) {
          userPrompt = `Focus on: ${customFocus}\n\n${conversation}`;
        }
        const body = JSON.stringify({
          model: NIM_MODEL,
          max_tokens: 1000,
          stream: false,
          messages: [
            { role: 'system', content: NIM_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ]
        });
        const resp = await fetch(NIM_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body
        });
        if (!resp.ok) {
          const fallback = extractiveSummarize(messages);
          sendResponse({ success: false, error: 'NIM API error', fallback });
          return;
        }
        const data = await resp.json();
        const summary = data.choices?.[0]?.message?.content || '';
        sendResponse({ success: true, summary });
      } catch (e) {
        const fallback = extractiveSummarize(messages);
        sendResponse({ success: false, error: e.message, fallback });
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
      sendResponse({ success: true, history: data.cs_history || [] });
    });
    return true;
  }

  if (message.action === 'CLEAR_HISTORY') {
    chrome.storage.local.remove(['cs_history'], () => {
      sendResponse({ success: true });
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
