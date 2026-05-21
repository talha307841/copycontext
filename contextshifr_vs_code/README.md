# ContextShift VS Code Extension

Seamless, compressed AI context handoffs between AI tools and chat panels inside VS Code.

## Features
- Effortless capture of chat context from webviews, terminals, and chat panels
- Instant context injection between AI tools and chats
- Local-first storage and history (no backend, no telemetry)
- LZString compression for efficient storage
- Optional NVIDIA NIM API integration for smart summarization
- UI: commands, webview panels, status bar, and settings

## Getting Started
1. Open VS Code and install this extension (development mode: `F5` to launch Extension Host)
2. Use the `ContextShift: Capture Context` command to capture chat context
3. Use the `ContextShift: Inject Context` command to paste context into another chat or tool
4. Configure settings via the gear icon or `ContextShift: Settings`

## Privacy
- All data is stored locally in VS Code global state
- No data leaves your device unless you explicitly enable and use the NIM API

## Development
- Stack: TypeScript, VS Code Extension API
- No backend required

---
Built with 💜 for developers who live in multiple AI tabs and chats at once.
