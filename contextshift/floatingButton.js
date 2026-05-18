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
    const btn = document.createElement('button');
    btn.id = 'contextshift-floating-btn';
    btn.innerText = '⎌ Capture';
    btn.style.position = 'fixed';
    btn.style.bottom = '28px';
    btn.style.right = '28px';
    btn.style.zIndex = 99999;
    btn.style.background = '#7c5cfc';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '24px';
    btn.style.padding = '12px 24px';
    btn.style.fontSize = '18px';
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
      chrome.runtime.sendMessage({ action: 'GET_CONVERSATION' }, (resp) => {
        if (resp && resp.success) {
          btn.innerText = '✓ Captured!';
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
    document.body.appendChild(btn);
  }

  function injectIfNeeded() {
    if (!document.getElementById('contextshift-floating-btn') && detectPlatform()) {
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
