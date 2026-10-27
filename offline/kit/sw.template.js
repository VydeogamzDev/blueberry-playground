/* Offline Reliability Kit v1.0 — static, SAME-ORIGIN ROOT deployments only.
 * Core is atomic and verified; media is verified individually and retained by SHA key.
 * Navigation is always cache-first. A fake one-bar signal never blocks cached startup.
 * Placeholders are replaced by tools/prepare-offline.mjs. */
const APP_ID = '__OFFLINE_APP_ID__';
const BUILD_ID = '__OFFLINE_BUILD_ID__';
const CORE_PREFIX = `${APP_ID}-offline-core-`;
const CORE_CACHE = `${CORE_PREFIX}${BUILD_ID}`;
const MEDIA_CACHE = `${APP_ID}-offline-media`;
const MANIFEST = '/offline-manifest.json';
const HOME = '/';
const PING_MS = 3000;
const FILE_MS = 20000;
const MEDIA_MS = 15000;
const COOLDOWN_MS = 90000;
let poorUntil=0, warming=null, repairTask=null;
const offline = () => self.navigator?.onLine === false;
const poor = () => offline() || Date.now()<poorUntil;
const fail = () => new Response('Offline file unavailable; reconnect to complete offline sync.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
async function getOnline(resource,timeoutMs,options={}){
 if(poor())throw Error('No usable connection');
 const abort=new AbortController();
 const timer=setTimeout(()=>{poorUntil=Date.now()+COOLDOWN_MS;abort.abort();},timeoutMs);
 try{return await fetch(resource,{...options,signal:abort.signal,cache:'no-store'});}
 finally{clearTimeout(timer);}
}
function validEntry(e){return e && typeof e.path==='string' && /^\/[a-zA-Z0-9_./-]*$/.test(e.path) &&
  !e.path.includes('..') && /^[a-f0-9]{64}$/.test(e.sha256) && Number.isSafeInteger(e.bytes)&&e.bytes>=0;}
function validManifest(m){return m && m.format===1 && m.appId===APP_ID && m.buildId===BUILD_ID &&
 Array.isArray(m.core) && Array.isArray(m.media) && m.core.some(e=>e.path===HOME) &&
 [...m.core,...m.media].every(validEntry) &&
 new Set([...m.core,...m.media].map(e=>e.path)).size === m.core.length+m.media.length;}
async function digest(response){const bytes=await response.clone().arrayBuffer();const buf=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(buf)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function acceptable(entry,res){
 if(!res?.ok||res.redirected||res.type==='opaqueredirect')return false;
 const type=(res.headers.get('content-type')||'').toLowerCase(),p=entry.path;
 if(p==='/')return type.includes('text/html');
 if(/\.(?:js|mjs)$/.test(p))return /javascript|ecmascript/.test(type);
 if(p.endsWith('.css'))return type.includes('text/css');
 if(p.endsWith('.json'))return type.includes('json');
 if(p.endsWith('.webmanifest'))return /json|manifest/.test(type);
 if(p.endsWith('.wasm'))return type.includes('wasm');
 if(p.endsWith('.png'))return type.includes('image/png');
 if(p.endsWith('.svg'))return type.includes('svg');
 if(p.endsWith('.webp'))return type.includes('webp');
 return true;
}
async function fetchVerified(entry,ms){
 const res=await getOnline(entry.path,ms);
 if(!acceptable(entry,res))throw Error(`Bad response for ${entry.path}`);
 if(await digest(res)!==entry.sha256)throw Error(`SHA mismatch for ${entry.path}`);
 return res;
}
const mediaKey=entry=>`${entry.path}?__offline_sha=${entry.sha256}`;
async function installedManifest(){
 const cache=await caches.open(CORE_CACHE),hit=await cache.match(MANIFEST);
 if(!hit)return null;
 const m=await hit.json().catch(()=>null);
 return validManifest(m)?m:null;
}
async function install(){
 // Leave all previous core releases alone unless the NEW core is complete.
 const manifestResponse=await getOnline(`${MANIFEST}?build=${encodeURIComponent(BUILD_ID)}`,PING_MS);
 if(!manifestResponse.ok||manifestResponse.redirected)throw Error('No valid offline manifest');
 const manifest=await manifestResponse.clone().json();
 if(!validManifest(manifest))throw Error('Versioned offline manifest is invalid');
 const cache=await caches.open(CORE_CACHE);
 try{
  let cursor=0;
  const job=async()=>{while(cursor<manifest.core.length){
   const entry=manifest.core[cursor++];
   await cache.put(entry.path,await fetchVerified(entry,FILE_MS));
  }};
  const result=await Promise.allSettled(Array.from({length:Math.min(3,manifest.core.length)},job));
  const error=result.find(r=>r.status==='rejected');if(error)throw error.reason;
  for(const e of manifest.core)if(!await cache.match(e.path))throw Error(`Incomplete core: ${e.path}`);
  await cache.put(MANIFEST,manifestResponse);
 }catch(e){await caches.delete(CORE_CACHE);throw e;}
}
self.addEventListener('install',e=>e.waitUntil(install()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
 await self.clients.claim();
 const old=(await caches.keys()).filter(k=>k.startsWith(CORE_PREFIX)&&k!==CORE_CACHE);
 // Keep the immediate predecessor, which may still be used by an older tab.
 const keep=old.at(-1);
 for(const name of old)if(name!==keep)await caches.delete(name);
})()));
async function status(deep=false){
 const m=await installedManifest();
 if(!m)return {type:'OFFLINE_STATUS',ready:false,coreHave:0,coreTotal:0,mediaHave:0,mediaTotal:0,buildId:BUILD_ID};
 const c=await caches.open(CORE_CACHE),a=await caches.open(MEDIA_CACHE);
 let coreHave=0,mediaHave=0;
 for(const e of m.core){const r=await c.match(e.path);if(r?.ok&&!r.redirected&&(!deep||await digest(r)===e.sha256))coreHave++;}
 for(const e of m.media){const r=await a.match(mediaKey(e));if(r?.ok&&!r.redirected&&(!deep||await digest(r)===e.sha256))mediaHave++;}
 return {type:'OFFLINE_STATUS',ready:coreHave===m.core.length&&mediaHave===m.media.length,
  coreHave,coreTotal:m.core.length,mediaHave,mediaTotal:m.media.length,buildId:BUILD_ID};
}
async function warm(){
 if(poor())return {ok:false,reason:'No usable signal; old cache remains safe.'};
 const m=await installedManifest();if(!m)return {ok:false,reason:'No complete game core is installed.'};
 const a=await caches.open(MEDIA_CACHE),missing=[];
 for(const e of m.media)if(!await a.match(mediaKey(e)))missing.push(e);
 let cursor=0,saved=0;
 const job=async()=>{while(cursor<missing.length){
  if(poor())return;
  const entry=missing[cursor++];
  try{const r=await fetchVerified(entry,MEDIA_MS);await a.put(mediaKey(entry),r);saved++;}
  catch{return;} // Stop this worker when poor signal; rerun after the next good connection.
 }};
 await Promise.all([job(),job()]);
 return {ok:(await status()).ready,saved,...await status()};
}
async function repair(){
 if(poor())return {ok:false,reason:'No usable signal'};
 const m=await installedManifest();if(!m)return {ok:false,reason:'No installed core manifest'};
 const core=await caches.open(CORE_CACHE);
 let fixed=0;
 for(const e of m.core){
  if(await core.match(e.path))continue;
  try{await core.put(e.path,await fetchVerified(e,FILE_MS));fixed++;}
  catch{break;}
 }
 const extra=await warm();
 return {ok:(await status()).ready,coreRepaired:fixed,mediaRepaired:extra?.saved||0,...await status()};
}
self.addEventListener('message',event=>{
 const type=event.data?.type,port=event.ports?.[0];
 if(type==='SKIP_WAITING'){self.skipWaiting();return;}
 const reply=(promise)=>event.waitUntil(Promise.resolve(promise).then(result=>port?.postMessage(result)).catch(err=>port?.postMessage({ok:false,error:String(err)})));
 if(type==='OFFLINE_STATUS')reply(status(Boolean(event.data.deep)));
 if(type==='WARM_OFFLINE'){
  if(!warming)warming=warm().finally(()=>{warming=null;});
  reply(warming);
 }
 if(type==='REPAIR_OFFLINE'){
  if(!repairTask)repairTask=repair().finally(()=>{repairTask=null;});
  reply(repairTask);
 }
});
async function rangeResult(res,header){
 // For locally cached video/audio seeking. Uses memory proportional to the file size:
 // very large videos should use a dedicated media/streaming strategy.
 const bytes=await res.arrayBuffer(),length=bytes.byteLength;
 const match=/^bytes=(\d*)-(\d*)$/.exec(header||'');if(!match)return new Response('',{status:416,headers:{'Content-Range':`bytes */${length}`}});
 const start=match[1]?Number(match[1]):Math.max(0,length-Number(match[2]||0));
 const end=match[2]&&match[1]?Math.min(length-1,Number(match[2])):length-1;
 if(start>=length||end<start)return new Response('',{status:416,headers:{'Content-Range':`bytes */${length}`}});
 const headers=new Headers(res.headers);headers.set('Content-Range',`bytes ${start}-${end}/${length}`);
 headers.set('Accept-Ranges','bytes');headers.set('Content-Length',String(end-start+1));
 return new Response(bytes.slice(start,end+1),{status:206,headers});
}
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname==='/sw.js'||url.pathname===MANIFEST)return;
 if(url.pathname==='/build-info.json'&&url.searchParams.has('probe')){
  event.respondWith(getOnline(req,PING_MS).then(r=>r.ok&&!r.redirected?r:fail()).catch(fail));return;
 }
 event.respondWith((async()=>{
  const m=await installedManifest();
  if(!m)return fail();
  const path=req.mode==='navigate'?HOME:url.pathname;
  const core=m.core.find(e=>e.path===path),media=m.media.find(e=>e.path===path);
  if(!core&&!media){
   // Do not hijack dynamic API routes: the GAME should handle its API timeouts.
   return fetch(req);
  }
  const cache=await caches.open(core?CORE_CACHE:MEDIA_CACHE);
  const cacheKey=core?core.path:mediaKey(media);
  const saved=await cache.match(cacheKey);
  if(saved?.ok&&!saved.redirected){
   return req.headers.has('range')?rangeResult(saved,req.headers.get('range')):saved;
  }
  if(poor())return fail();
  try{
   const entry=core||media;
   const res=await fetchVerified(entry,core?FILE_MS:MEDIA_MS);
   await cache.put(cacheKey,res.clone());
   return req.headers.has('range')?rangeResult(res,req.headers.get('range')):res;
  }catch{return fail();}
 })());
});
