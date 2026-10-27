/* Explicit allow-list localStorage backup/restore with checksums and rollback.
 * JSON backup is plaintext; do not include authentication tokens or private credentials.
 * Call flush() before exporting; render from restored state in afterRestore(). */
const FORMAT='game-local-save';
const LIMIT=8*1024*1024;
const utf8=new TextEncoder();
async function sha256(s){const d=await crypto.subtle.digest('SHA-256',utf8.encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function assertObj(v,msg){if(!v||typeof v!=='object'||Array.isArray(v))throw Error(msg);}
function strictKeys(keys){if(!Array.isArray(keys)||!keys.length||keys.some(k=>typeof k!=='string'||!k))throw Error('Supply explicit localStorage save keys');}
export function createSaveBackup({appId,schema=1,keys,storage=localStorage,flush=()=>{},validate=()=>true,migrate=null,afterRestore=()=>{}}){
 if(!/^[a-z0-9][a-z0-9-]{1,39}$/.test(appId||''))throw Error('Invalid appId');
 strictKeys(keys);const allowed=new Set(keys);
 async function make(){
  await flush();
  const body={format:FORMAT,formatVersion:1,appId,schema,createdAt:new Date().toISOString(),values:{}};
  for(const k of keys)body.values[k]=storage.getItem(k);
  const checksum=await sha256(JSON.stringify(body));
  return JSON.stringify({...body,checksum},null,2);
 }
 async function inspect(text){
  if(typeof text!=='string'||utf8.encode(text).byteLength>LIMIT)throw Error('Backup is too large or invalid');
  let envelope;try{envelope=JSON.parse(text);}catch{throw Error('Backup is not valid JSON');}
  assertObj(envelope,'Backup envelope missing');
  const {checksum,...body}=envelope;
  if(body.format!==FORMAT||body.formatVersion!==1||body.appId!==appId||!Number.isSafeInteger(body.schema))throw Error('Backup belongs to another game or unsupported format');
  if(typeof checksum!=='string'||checksum!==await sha256(JSON.stringify(body)))throw Error('Backup checksum does not match');
  assertObj(body.values,'Backup values missing');
  if(Object.keys(body.values).some(k=>!allowed.has(k)))throw Error('Backup attempts to modify unapproved keys');
  if(keys.some(k=>!(k in body.values)||!(body.values[k]===null||typeof body.values[k]==='string')))throw Error('Required save keys missing');
  let values=body.values;
  if(body.schema!==schema){
   if(!migrate)throw Error(`Save schema ${body.schema} is incompatible with ${schema}; supply a migration.`);
   values=await migrate({...values},body.schema,schema);
   assertObj(values,'Migration did not return a save object');
   if(keys.some(k=>!(k in values)||!(values[k]===null||typeof values[k]==='string')))throw Error('Migration did not produce correct save keys');
  }
  // Application validator is required to validate its own game-save schema.
  if(!await validate(values))throw Error('Game save validation failed');
  return {createdAt:body.createdAt,sourceSchema:body.schema,currentSchema:schema,values};
 }
 async function restore(text,{confirmed=false}={}){
  if(!confirmed)throw Error('Restore requires explicit confirmation; it replaces the selected saves.');
  const prepared=await inspect(text);
  await flush();
  const previous=Object.fromEntries(keys.map(k=>[k,storage.getItem(k)]));
  try{
   for(const k of keys){const value=prepared.values[k];if(value===null)storage.removeItem(k);else storage.setItem(k,value);}
   await afterRestore();
   return {ok:true,...prepared};
  }catch(e){
   for(const k of keys){try{if(previous[k]===null)storage.removeItem(k);else storage.setItem(k,previous[k]);}catch{/* quota error can prevent rollback */}}
   throw new Error(`Restore rolled back: ${String(e.message||e)}`);
  }
 }
 function download(text,filename=`${appId}-save-backup.json`){
  const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
 }
 return {make,inspect,restore,download};
}
