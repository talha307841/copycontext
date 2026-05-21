import * as vscode from 'vscode';
import { compress, decompress } from './lz-string';
import { getHistory, saveToHistory } from './history';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('contextshift.captureContext', async () => {
      // Try to capture from active text editor
      const editor = vscode.window.activeTextEditor;
      let captured = '';
      if (editor) {
        captured = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
      } else if (vscode.window.activeTerminal) {
        // Try to capture from terminal (visible buffer only)
        vscode.window.showInformationMessage('Capturing from terminal: please copy visible text to clipboard and run again if needed.');
        captured = await vscode.env.clipboard.readText();
      } else {
        vscode.window.showWarningMessage('No active editor or terminal to capture context from.');
        return;
      }
      if (!captured) {
        vscode.window.showWarningMessage('No text selected or available to capture.');
        return;
      }
      await saveToHistory(context, captured);
      vscode.window.showInformationMessage('ContextShift: Context captured and saved to history.');
    }),
    vscode.commands.registerCommand('contextshift.injectContext', async () => {
      // Get last context from history
      const history = await getHistory(context);
      if (!history.length) {
        vscode.window.showWarningMessage('No captured context in history.');
        return;
      }
      const lastContext = history[0];
      // Try to inject into active editor
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await editor.edit(editBuilder => {
          editBuilder.insert(editor.selection.active, lastContext);
        });
        vscode.window.showInformationMessage('ContextShift: Injected context into active editor.');
        return;
      }
      // Try to inject into terminal
      const terminal = vscode.window.activeTerminal;
      if (terminal) {
        terminal.sendText(lastContext, false);
        vscode.window.showInformationMessage('ContextShift: Injected context into active terminal.');
        return;
      }
      vscode.window.showWarningMessage('No active editor or terminal to inject context into.');
    }),
    vscode.commands.registerCommand('contextshift.showHistory', async () => {
      // TODO: Show capture history in a webview panel or quick pick
      vscode.window.showInformationMessage('ContextShift: Show History (not yet implemented)');
    }),
    vscode.commands.registerCommand('contextshift.showSettings', async () => {
      // Open settings UI for ContextShift
      await vscode.commands.executeCommand('workbench.action.openSettings', 'contextshift');
    })
  );
}

export function deactivate() {}
