import * as vscode from 'vscode';
import { compress, decompress } from './lz-string';

const HISTORY_KEY = 'cs_history';
const MAX_HISTORY = 10;

export async function getHistory(context: vscode.ExtensionContext): Promise<string[]> {
  const compressedArr = context.globalState.get<string[]>(HISTORY_KEY, []);
  return compressedArr.map(decompress);
}

export async function saveToHistory(context: vscode.ExtensionContext, contextText: string) {
  let compressedArr = context.globalState.get<string[]>(HISTORY_KEY, []);
  compressedArr.unshift(compress(contextText));
  if (compressedArr.length > MAX_HISTORY) {
    compressedArr = compressedArr.slice(0, MAX_HISTORY);
  }
  await context.globalState.update(HISTORY_KEY, compressedArr);
}
