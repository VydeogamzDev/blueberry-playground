/** Bytes to base64 and back, for typed arrays in save files. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(str: string): Uint8Array {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A typed array's bytes as base64 (little-endian, as every browser keeps them). */
export const arrayToBase64 = (a: Int16Array | Float32Array | Uint8Array): string => toBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
