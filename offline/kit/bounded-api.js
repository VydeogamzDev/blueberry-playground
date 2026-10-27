/* Optional helper for game APIs (leaderboards, scores, etc.).
 * Unlike static assets, API requests are NOT cached by the service worker.
 * Return your own local fallback when this function reports offline. */
export function createBoundedAPI({timeoutMs=3500,cooldownMs=90000}={}){
 let poorUntil=0;
 async function request(url,options={}){
  if(navigator.onLine===false||Date.now()<poorUntil)return {ok:false,offline:true,response:null};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(url,{...options,signal:controller.signal});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   return {ok:true,offline:false,response};
  }catch{
   poorUntil=Date.now()+cooldownMs;
   return {ok:false,offline:true,response:null};
  }finally{clearTimeout(timer);}
 }
 return {request,get cooldownUntil(){return poorUntil;}};
}
