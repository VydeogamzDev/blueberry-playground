/* Small optional Settings UI. Give it an existing parent element, an offline manager, and a backup adapter. */
export function mountOfflinePanel(parent,{manager,backup,onMessage=()=>{},confirmRestore=(msg)=>window.confirm(msg)}){
 parent.innerHTML=`<section class="offline-kit">
  <h3>OFFLINE & STORAGE</h3>
  <p data-ok>Checking saved files…</p><p data-state aria-live="polite"></p>
  <div class="offline-kit-buttons">
   <button data-act="check">CHECK FILES</button><button data-act="deep">VERIFY HASHES</button>
   <button data-act="sync">SAVE EVERYTHING NOW</button><button data-act="repair">REPAIR MISSING FILES</button>
   <button data-act="storage">PROTECT STORAGE</button><button data-act="update">CHECK FOR UPDATES</button>
   <button data-act="backup">BACK UP SAVE</button><button data-act="restore">RESTORE SAVE</button>
  </div><textarea data-code placeholder="Copy a save backup here, or use the file picker" rows="3"></textarea>
  <input type="file" data-file accept=".json,application/json" aria-label="Choose backup file">
 </section>`;
 const $=s=>parent.querySelector(`[data-${s}]`);
 function message(s){$('state').textContent=s;onMessage(s);}
 function format(v){if(!v?.coreTotal)return 'OFFLINE NOT READY';return `${v.coreHave}/${v.coreTotal} core · ${v.mediaHave}/${v.mediaTotal} media · ${v.ready?'ALL SAVED ✓':'NOT COMPLETE'}`;}
 async function check(deep=false){const v=await manager.status(deep);$('ok').textContent=format(v);return v;}
 async function action(type){try{
  if(type==='check'||type==='deep'){message('Checking local files…');await check(type==='deep');message('Check finished');}
  if(type==='sync'||type==='repair'){
   message('Saving verified files when the signal allows…');const result=await (type==='sync'?manager.warm():manager.repair());
   await check();message(result?.ok?'All offline files saved ✓':result?.reason||'Not complete. Resume syncing on a reliable connection.');
  }
  if(type==='storage'){message(await manager.protectStorage()?'Storage protection granted':'Storage protection not available or not granted. Keep backups.');}
  if(type==='update'){message('Checking connection (3 seconds maximum)…');const res=await manager.check({manual:true});if(!res.ok)message(res.reason);}
  if(type==='backup'){
   if(!backup){message('No save adapter configured for this game');return;}
   const code=await backup.make();$('code').value=code;backup.download?.(code);
   try{await navigator.clipboard?.writeText?.(code);}catch{/* user can copy the textarea */}
   message('Backup generated. Keep the JSON file or copy its contents to a safe place.');
  }
  if(type==='restore'){
   if(!backup){message('No save adapter configured');return;}
   const selected=$('file').files?.[0];const code=selected?await selected.text():$('code').value;
   const info=await backup.inspect(code);
   if(!await confirmRestore(`Replace this game's current save with the backup from ${info.createdAt}? Your current progress will be overwritten.`))return;
   await backup.restore(code,{confirmed:true});message('Save restored. Reload the game if its UI does not update automatically.');
  }
 }catch(e){message('Could not finish: '+String(e.message||e));}}
 parent.addEventListener('click',e=>{const a=e.target.closest('[data-act]');if(a)action(a.dataset.act);});
 check().catch(()=>message('Offline worker not ready. Open once with a reliable connection.'));
 return {check,action};
}
