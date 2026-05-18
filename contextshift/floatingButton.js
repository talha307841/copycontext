// ContextShift floatingButton.js — Injects floating capture button on supported AI platforms
(function() {
  if (window.__contextshift_floating) return;
  window.__contextshift_floating = true;

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('openai.com') || host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('perplexity.ai')) return 'perplexity';
    if (host.includes('grok.com') || host.includes('x.com')) return 'grok';
    return null;
  }

  function createButton() {
    const wrap = document.createElement('div');
    wrap.id = 'contextshift-floating-wrap';
    wrap.style.position = 'fixed';
    wrap.style.bottom = '28px';
    wrap.style.right = '28px';
    wrap.style.zIndex = 99999;
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '10px';

    const btn = document.createElement('button');
    btn.id = 'contextshift-floating-btn';
    btn.innerText = '⎌ Capture';
    btn.style.zIndex = 1;
    btn.style.background = '#7c5cfc';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '24px';
    btn.style.padding = '12px 24px';
    btn.style.fontSize = '16px';
    btn.style.boxShadow = '0 2px 16px 0 rgba(124,92,252,0.18)';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'box-shadow 0.15s';
    btn.style.fontFamily = 'DM Sans, system-ui, sans-serif';
    btn.style.opacity = '0.96';
    btn.onmouseenter = () => btn.style.boxShadow = '0 4px 24px 0 #7c5cfc55';
    btn.onmouseleave = () => btn.style.boxShadow = '0 2px 16px 0 rgba(124,92,252,0.18)';
    btn.onclick = () => {
      btn.innerText = '⏳...';
      btn.disabled = true;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        btn.innerText = '⚠ Timeout';
        setTimeout(() => {
          btn.innerText = '⎌ Capture';
          btn.disabled = false;
        }, 1800);
      }, 8000);
      chrome.runtime.sendMessage({ action: 'CAPTURE_AND_STORE_FROM_TAB' }, (resp) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (resp && resp.success) {
          btn.innerText = `✓ ${resp.messageCount} Saved`;
          setTimeout(() => {
            btn.innerText = '⎌ Capture';
            btn.disabled = false;
          }, 1800);
        } else {
          btn.innerText = '⚠️ Error';
          setTimeout(() => {
            btn.innerText = '⎌ Capture';
            btn.disabled = false;
          }, 2200);
        }
      });
    };

    const pasteBtn = document.createElement('button');
    pasteBtn.id = 'contextshift-floating-paste-btn';
    pasteBtn.innerText = '⇥ Paste Context';
    pasteBtn.style.zIndex = 1;
    pasteBtn.style.background = '#1a1a26';
    pasteBtn.style.color = '#f0f0ff';
    pasteBtn.style.border = '1px solid rgba(124,92,252,0.45)';
    pasteBtn.style.borderRadius = '24px';
    pasteBtn.style.padding = '10px 18px';
    pasteBtn.style.fontSize = '14px';
    pasteBtn.style.boxShadow = '0 2px 16px 0 rgba(124,92,252,0.14)';
    pasteBtn.style.cursor = 'pointer';
    pasteBtn.style.transition = 'box-shadow 0.15s';
    pasteBtn.style.fontFamily = 'DM Sans, system-ui, sans-serif';
    pasteBtn.style.opacity = '0.96';
    pasteBtn.onmouseenter = () => pasteBtn.style.boxShadow = '0 4px 24px 0 rgba(124,92,252,0.35)';
    pasteBtn.onmouseleave = () => pasteBtn.style.boxShadow = '0 2px 16px 0 rgba(124,92,252,0.14)';
    pasteBtn.onclick = () => {
      pasteBtn.innerText = 'Pasting...';
      pasteBtn.disabled = true;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        pasteBtn.innerText = 'Timeout';
        setTimeout(() => {
          pasteBtn.innerText = '⇥ Paste Context';
          pasteBtn.disabled = false;
        }, 1800);
      }, 8000);
      chrome.runtime.sendMessage({ action: 'PASTE_LAST_CONTEXT_IN_TAB' }, (resp) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (resp && resp.success) {
          pasteBtn.innerText = '✓ Pasted';
          setTimeout(() => {
            pasteBtn.innerText = '⇥ Paste Context';
            pasteBtn.disabled = false;
          }, 1600);
        } else {
          pasteBtn.innerText = 'No Context';
          setTimeout(() => {
            pasteBtn.innerText = '⇥ Paste Context';
            pasteBtn.disabled = false;
          }, 2000);
        }
      });
    };

    wrap.appendChild(btn);
    wrap.appendChild(pasteBtn);
    document.body.appendChild(wrap);
  }

  function injectIfNeeded() {
    if (!document.getElementById('contextshift-floating-wrap') && detectPlatform()) {
      createButton();
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectIfNeeded);
  } else {
    injectIfNeeded();
  }
  // Re-inject if DOM changes
  const observer = new MutationObserver(injectIfNeeded);
  observer.observe(document.body, { childList: true, subtree: true });
})();
