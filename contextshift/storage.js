// ContextShift storage.js — LZ-String compression helpers for chrome.storage.local
// Must be importScripts'd AFTER lz-string.min.js in background.js

/**
 * Compress a JS object to an LZ-string for storage.
 * Falls back to plain JSON stringify if compression fails.
 */
function csCompress(obj) {
  try {
    return LZString.compress(JSON.stringify(obj));
  } catch (_) {
    return JSON.stringify(obj);
  }
}

/**
 * Decompress a stored LZ-string back to a JS object.
 * Handles backward-compatible legacy uncompressed data gracefully.
 */
function csDecompress(str) {
  if (str == null) return null;
  // Already a plain object (legacy uncompressed path)
  if (typeof str === 'object') return str;
  // Try LZ-String decompression first
  try {
    const raw = LZString.decompress(str);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  // Fall back: treat as plain JSON string (legacy uncompressed data)
  try {
    return JSON.parse(str);
  } catch (_) {}
  return null;
}
