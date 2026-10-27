/* Browser-side update handshake. Start AFTER rendering the game; no network request should block boot. */
const WAIT=3000,COOLDOWN=90000;
const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out')),ms);})]).finally(()=>clearTimeout(timer));};
export function createOfflineManager({appId,buildId,onStatus=()=>{},beforeReload=()=>{},onUpdateReady=()=>{}}){
 if(!appId||!buildId)throw Error('Pass your local appId and buildId from /build-info.json (generated at build time).');
 let registration=null,busy=false,poorUntil=0,activating=false,reloading=false,lastCheck=0;
 const emit=(type,detail={})=>onStatus({type,...detail});
 const fakeOffline=()=>navigator.onLine===false||Date.now()<poorUntil;
 const controlled=()=>Boolean(navigator.serviceWorker?.controller);
 const signalFailure=()=>{poorUntil=Date.now()+COOLDOWN;emit('weak-signal',{cooldownMs:COOLDOWN});};
 async function ask(type,deep=false,timeout=3000){
  const target=navigator.serviceWorker?.controller||registration?.active;
  if(!target)throw Error('Offline service worker is not active yet');
  const channel=new MessageChannel();
  try{
   return await bounded(new Promise((resolve,reject)=>{
    channel.port1.onmessage=e=>resolve(e.data);
    channel.port1.onmessageerror=()=>reject(Error('Offline status could not be read'));
    target.postMessage({type,deep},[channel.port2]);
   }),timeout);
  }finally{channel.port1.close();channel.port2.close();}
 }
 const status=(deep=false)=>ask('OFFLINE_STATUS',deep,deep?120000:12000);
 const warm=()=>fakeOffline()?Promise.resolve({ok:false,reason:'No usable signal'}):ask('WARM_OFFLINE',false,120000);
 const repair=()=>fakeOffline()?Promise.resolve({ok:false,reason:'No usable signal'}):ask('REPAIR_OFFLINE',false,120000);
 async function protectStorage(){
  if(!navigator.storage?.persist)return false;
  return Boolean(await navigator.storage.persist().catch(()=>false));
 }
 function offer(){if(registration?.waiting&&controlled()){
  emit('update-ready');onUpdateReady({activate});
  return true;
 }return false;}
 async function check({manual=false}={}){
  if(busy||!registration)return {ok:false,reason:'Not ready'};
  if(offer())return {ok:true,waiting:true};
  if(fakeOffline()){
   if(manual)emit('offline',{message:'No usable signal. Cached game is still playable.'});
   return {ok:false,reason:'Offline or in 90-second cooldown'};
  }
  if(!manual&&Date.now()-lastCheck<60000)return {ok:false,reason:'Throttled'};
  lastCheck=Date.now();busy=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),WAIT);
  if(manual)emit('checking');
  try{
   const res=await fetch(`/build-info.json?probe=${Date.now()}`,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
   if(!res.ok||res.redirected||!(res.headers.get('content-type')||'').includes('json'))throw Error('Invalid version response');
   const version=await res.json();
   if(version.appId!==appId||typeof version.buildId!=='string')throw Error('Wrong app or bad reply');
   if(version.buildId!==buildId){
    emit('downloading');
    await bounded(registration.update(),20000);
    if(!offer())emit('installing',{message:'Update downloading in the background. Keep playing.'});
   }else if(manual)emit('current');
   return {ok:true,remote:version.buildId};
  }catch(e){signalFailure();return {ok:false,reason:String(e)};}
  finally{clearTimeout(timer);busy=false;}
 }
 async function activate(){
  if(activating||!registration?.waiting||!controlled())return false;
  activating=true;emit('activating');
  try{await beforeReload();}catch(err){activating=false;emit('save-failed',{message:String(err)});return false;}
  registration.waiting.postMessage({type:'SKIP_WAITING'});
  setTimeout(()=>{if(!reloading){activating=false;emit('activation-timeout');}},7500);
  return true;
 }
 async function start(){
  if(!('serviceWorker'in navigator)||location.protocol==='file:'){emit('unsupported');return;}
  // Game HTML should have rendered before start() is called.
  navigator.serviceWorker.addEventListener('controllerchange',async()=>{
   if(!activating||reloading)return;
   reloading=true;
   try{await beforeReload();location.reload();}catch(err){reloading=false;emit('save-failed',{message:String(err)});}
  });
  try{
   registration=await bounded(navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}),12000);
   const watching=()=>registration.installing?.addEventListener('statechange',e=>{
    if(e.target.state==='installed')offer();
   });
   registration.addEventListener('updatefound',watching);watching();offer();
   if(controlled())status().then(v=>emit('offline-status',v)).catch(()=>{});
   // Delay extra media loading until after boot, and never let it block rendering.
   setTimeout(()=>{if(!fakeOffline())warm().then(v=>emit('sync-result',v)).catch(()=>{});},8000);
   setTimeout(()=>check(),6000);
  }catch(e){emit('registration-unavailable',{message:String(e)});}
  window.addEventListener('online',()=>setTimeout(()=>{check();warm().catch(()=>{});},3000));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
 }
 return {start,check,activate,status,warm,repair,protectStorage,get registration(){return registration;}};
}
