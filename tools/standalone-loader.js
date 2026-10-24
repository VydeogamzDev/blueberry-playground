/**
 * The standalone page's loader (see standalone.mjs): unpacks the archive written
 * into the page, puts its files in window.BP_ASSETS (for fetchAsset() and the
 * physics engine's WebAssembly) and runs the game's script.
 */
import { inflateSync } from 'fflate';

// the loading screen's line under its bar (see index.html); a failure turns the bar red
const step = (msg, failed = false) => {
  const el = document.getElementById('loading');
  const text = el && el.querySelector('.ld-step');
  if (text) text.innerHTML = msg;
  else if (el) el.innerHTML = `<div style="max-width:420px;text-align:center;line-height:1.6">${msg}</div>`;
  if (el && failed) el.classList.add('failed');
};
const show = (msg) => step(msg, true);
step('Unpacking the game…');

// a browser too old for the game fails before the game can say so itself
addEventListener('error', (e) => {
  if (document.getElementById('loading')) show(`Blueberry Playground couldn't start in this browser (${e.message}).<br>Try opening it in an up-to-date Chrome, Edge, Firefox or Safari.`);
});

// after the loading screen has had a chance to show
setTimeout(() => {
  try {
    const text = atob(document.getElementById('bp-pack').textContent.trim());
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    const pack = inflateSync(bytes);
    // [index length: u32][index: JSON { main, files: { path: [offset, length] } }][files]
    const n = new DataView(pack.buffer, pack.byteOffset).getUint32(0, true);
    const index = JSON.parse(new TextDecoder().decode(pack.subarray(4, 4 + n)));
    const files = {};
    for (const [path, [at, len]] of Object.entries(index.files)) files[path] = pack.subarray(4 + n + at, 4 + n + at + len);
    window.BP_ASSETS = files;
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = new TextDecoder().decode(files[index.main]);
    document.body.appendChild(script);
  } catch (e) {
    show(`Blueberry Playground couldn't start: ${e}`);
  }
}, 30);
