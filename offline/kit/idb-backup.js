/* Optional IndexedDB save adapter: one DB, named object stores, transactional restore.
 * Only for records with JSON-safe values/keys: no Blob, Map, Set, ArrayBuffer, etc.
 * Do NOT assume localStorage + IndexedDB restores are jointly atomic. */
const FORMAT='game-idb-save';
function jsonSafe(v,seen=new WeakSet()){
 if(v===null||typeof v==='string'||typeof v==='boolean')return true;
 if(typeof v==='number')return Number.isFinite(v);
 if(typeof v!=='object'||seen.has(v))return false;
 const proto=Object.getPrototypeOf(v);
 if(!Array.isArray(v)&&proto!==Object.prototype&&proto!==null)return false;
 seen.add(v);
 const ok=Array.isArray(v)?v.every(x=>jsonSafe(x,seen)):Object.values(v).every(x=>jsonSafe(x,seen));
 seen.delete(v);return ok;
}
const bytes=new TextEncoder();
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const openDB=name=>new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('Database does not exist; create game DB before restoring'));};});
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('Transaction aborted'));tx.onerror=()=>reject(tx.error||Error('Transaction failed'));});
export function createIDBBackup({appId,dbName,storeNames,schema=1,validate=()=>true,afterRestore=()=>{}}){
 if(!appId||!dbName||!Array.isArray(storeNames)||!storeNames.length)throw Error('Set appId, database and explicit object stores');
 async function make(){
  const db=await openDB(dbName);
  try{
   for(const s of storeNames)if(!db.objectStoreNames.contains(s))throw Error(`Missing store ${s}`);
   const tx=db.transaction(storeNames,'readonly'),finished=done(tx),stores={};
   for(const name of storeNames){stores[name]=[];const req=tx.objectStore(name).openCursor();
    req.onsuccess=()=>{const c=req.result;if(c){if(!jsonSafe(c.key)||!jsonSafe(c.value)){tx.abort();return;}stores[name].push({key:c.key,value:c.value});c.continue();}};
   }
   await finished;
   const body={format:FORMAT,formatVersion:1,appId,schema,dbName,createdAt:new Date().toISOString(),stores};
   const roundTrip=JSON.parse(JSON.stringify(body));
   // All entries were checked for JSON safety before serialisation.
   for(const name of storeNames)if(roundTrip.stores[name].length!==stores[name].length)throw Error('Record not JSON-safe');
   return JSON.stringify({...roundTrip,checksum:await hash(JSON.stringify(roundTrip))},null,2);
  }finally{db.close();}
 }
 async function inspect(text){
  if(typeof text!=='string'||bytes.encode(text).byteLength>30*1024*1024)throw Error('Backup exceeds 30MB or is invalid');
  let source;try{source=JSON.parse(text);}catch{throw Error('Invalid JSON backup');}
  const {checksum,...body}=source;
  if(body.format!==FORMAT||body.formatVersion!==1||body.appId!==appId||body.dbName!==dbName||body.schema!==schema)throw Error('Wrong game/database/schema');
  if(checksum!==await hash(JSON.stringify(body)))throw Error('Backup checksum mismatch');
  if(Object.keys(body.stores||{}).sort().join('|')!==[...storeNames].sort().join('|'))throw Error('Unexpected object stores');
  for(const name of storeNames)if(!Array.isArray(body.stores[name])||body.stores[name].some(x=>!x||!('key'in x)||!('value'in x)))throw Error(`Invalid records in ${name}`);
  if(!await validate(body.stores))throw Error('Game record validation failed');
  return {createdAt:body.createdAt,stores:body.stores};
 }
 async function restore(text,{confirmed=false}={}){
  if(!confirmed)throw Error('You must confirm a destructive restore');
  const checked=await inspect(text),db=await openDB(dbName);
  try{
   const tx=db.transaction(storeNames,'readwrite'),finished=done(tx);
   for(const name of storeNames){const store=tx.objectStore(name);store.clear();
    for(const record of checked.stores[name]){
     if(store.keyPath===null)store.put(record.value,record.key);
     else store.put(record.value);
    }
   }
   await finished; // All stores commit together or none do.
  }finally{db.close();}
  await afterRestore();return {ok:true,createdAt:checked.createdAt};
 }
 return {make,inspect,restore};
}
