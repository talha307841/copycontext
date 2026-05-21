import LZString from 'lz-string';

export function compress(text: string): string {
  return LZString.compressToUTF16(text);
}

export function decompress(compressed: string): string {
  return LZString.decompressFromUTF16(compressed) || '';
}
