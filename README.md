# ContextShift

ContextShift is a privacy-first Chrome Extension that captures AI chat context from one platform and helps transfer it to another without a backend server.

Supported platforms:
- ChatGPT (`chat.openai.com`, `chatgpt.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)
- Perplexity (`perplexity.ai`, `www.perplexity.ai`)
- Grok (`grok.com`, `x.com/i/grok`)

## Why ContextShift

ContextShift is designed for users who want:
- Local-first context handling
- No analytics or telemetry pipeline
- No required sign-up for core functionality
- Fast transfer workflows between AI tools

Core principles:
- 100% local processing in extension runtime
- No application backend
- API key stored in local extension storage only

## Current Features

1. Floating overlay controls on supported AI pages
- Capture button to extract current conversation
- Paste Context button to inject last captured context directly into the current page input

2. Popup workflow
- Capture conversation
- Generate full context or summary
- Copy output to clipboard
- Auto-inject into selected target platform

3. Smart summary (optional)
- NVIDIA NIM integration through background service worker
- Local extractive fallback when key is missing or request fails

4. Local history
- Last 10 captured contexts saved locally
- Quick reuse from popup history

## Project Structure

```
contextshift/
├── manifest.json
├── background.js
├── content.js
├── floatingButton.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
└── icons/
	├── icon16.png
	├── icon48.png
	└── icon128.png
```

## Installation (Chrome)

1. Clone or download this repository.
2. Open Chrome and visit `chrome://extensions`.
3. Turn on Developer mode (top-right).
4. Click Load unpacked.
5. Select the `contextshift` folder (the one containing `manifest.json`).

Important:
- If Chrome says it cannot load icons, verify `contextshift/icons` contains valid PNG files.

## Quick Start

1. Open ChatGPT, Claude, Gemini, Perplexity, or Grok.
2. Use overlay button `⎌ Capture` to capture and save context.
3. Use overlay button `⇥ Paste Context` to paste the latest saved context into the current page input.
4. Or click the extension icon to open popup for summary, copy, history, and auto-inject flows.

## Popup Workflow

1. Capture Conversation
- Reads conversation from active supported tab

2. Mode Selection
- Full Context: full handoff formatting
- Smart Summary: NVIDIA NIM summarization
- Custom Focus: targeted summary using user focus prompt

3. Transfer
- Copy to Clipboard
- Auto-Inject to selected destination platform

4. History
- Recent entries shown in popup
- Click an entry to load into preview

## Overlay Buttons

The overlay includes:
- `⎌ Capture`: extracts conversation from current page, formats context, stores latest context, and optionally appends history
- `⇥ Paste Context`: injects latest saved context directly into detected chat input

Expected behavior:
- If capture succeeds: button confirms with saved message count
- If no context exists yet: Paste button displays temporary no-context state

## Settings (Options Page)

Available settings:
- NVIDIA NIM API key
- Default summarization mode
- Max context length slider
- Save history locally toggle
- Clear saved history button

NIM test button:
- Sends minimal request to validate key and connectivity
- Displays success/failure state

## Architecture

### Content Scripts

`content.js`
- Platform detection
- Conversation extraction using per-platform selectors
- Input injection for textarea and contenteditable editors

`floatingButton.js`
- Renders fixed overlay controls
- Sends action messages to background worker

### Background Service Worker

`background.js`
- Handles secure API calls to NVIDIA endpoint
- Orchestrates capture/store and paste flows for overlay
- Stores/retrieves history and latest captured context
- Handles auto-inject into newly opened target tabs

### Storage Keys

- `nim_api_key`
- `summ_mode`
- `max_len`
- `save_history`
- `cs_history` (array, max 10)
- `cs_last_context` (latest captured full context)

## Privacy Model

What stays local:
- Captured conversations
- Local history
- Settings and API key in extension local storage

What leaves device only when user enables NIM summary:
- Conversation text sent to NVIDIA API endpoint for summarization

No backend server is used by this project.

## Known Limitations

1. Platform DOM changes
- AI sites often change markup, which can break selectors

2. Dynamic rendering timing
- Some pages may require a short wait or scroll before extraction finds all messages

3. Input injection differences
- React/contenteditable implementations vary by platform version

## Troubleshooting

1. Overlay appears but capture fails
- Refresh the AI page once
- Ensure you are on a supported domain
- Scroll conversation to load older messages
- Reload extension in `chrome://extensions`

2. Overlay says captured but paste is empty
- Capture again after the latest update (older versions did not persist overlay captures)
- Confirm the tab is a supported platform before pasting

3. Claude extraction issues
- Reload page after extension reload
- Ensure Claude conversation is open (not just landing/new state)

4. Auto-inject fails
- Target page may still be loading input editor
- Use copy button as fallback

5. Icon/manifest load errors
- Verify icons are real PNG files and filenames match manifest exactly

## Development Notes

- Stack: plain JavaScript, Manifest V3
- No bundler
- No npm required

Recommended testing matrix:
- Chrome stable
- Each supported platform with both short and long chats
- Capture, paste, popup copy, popup inject, and history reuse

## Release Checklist

- Validate all manifest permissions are still minimal
- Confirm floating buttons render on all supported domains
- Confirm `cs_last_context` is written after overlay capture
- Confirm `cs_history` remains capped at 10 entries
- Confirm options save/load works after browser restart

## License

Add your preferred license before public distribution.