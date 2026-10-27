/**
 * An MP3 beside every Ogg in public/ (the sound effects and the music), for
 * iPhones and iPads: Safari there can't decode Ogg Vorbis (older iOS can't play
 * it at all), so the game loads these instead (see engine/assets.ts audioPath).
 * Only files whose MP3 is missing or older than the Ogg are made.
 *   npm run apple-audio
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
import { Mp3Encoder } from '@breezystack/lamejs';

const ROOT = new URL('../public/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
/** kbps: a sound effect is short and mostly mono; the music is listened to. */
const KBPS = { sfx: 96, music: 128 };
const FRAME = 1152;

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const toInt16 = (f) => {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
  return out;
};

const decoder = new OggVorbisDecoder();
await decoder.ready;
let made = 0;
let bytes = 0;
const oggs = walk(ROOT).filter((f) => f.endsWith('.ogg'));
for (const ogg of oggs) {
  const mp3 = ogg.replace(/\.ogg$/, '.mp3');
  let fresh = false;
  try {
    fresh = statSync(mp3).mtimeMs >= statSync(ogg).mtimeMs;
  } catch {
    /* none yet */
  }
  if (fresh) continue;
  await decoder.reset();
  const { channelData, sampleRate, errors } = await decoder.decodeFile(readFileSync(ogg));
  if (errors?.length) throw new Error(`${ogg}: ${errors[0].message}`);
  const chans = channelData.slice(0, 2).map(toInt16);
  const kbps = /[\\/]music[\\/]/.test(ogg) ? KBPS.music : KBPS.sfx;
  const enc = new Mp3Encoder(chans.length, sampleRate, kbps);
  const parts = [];
  for (let i = 0; i < chans[0].length; i += FRAME) {
    const l = chans[0].subarray(i, i + FRAME);
    const buf = chans.length > 1 ? enc.encodeBuffer(l, chans[1].subarray(i, i + FRAME)) : enc.encodeBuffer(l);
    if (buf.length) parts.push(buf);
  }
  const end = enc.flush();
  if (end.length) parts.push(end);
  const out = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
  writeFileSync(mp3, out);
  made++;
  bytes += out.length;
}
decoder.free();
console.log(`${made} of ${oggs.length} MP3s made (${(bytes / 1048576).toFixed(1)} MB)`);
