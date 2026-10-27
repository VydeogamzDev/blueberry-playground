#!/usr/bin/env node
/** Run AFTER the existing game build: node tools/prepare-offline.mjs --dist dist --config offline.config.json */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
const valueOf=(key, fallback)=>{const i=args.indexOf(key);return i>=0?args[i+1]:fallback;};
const root=process.cwd();
const configPath=path.resolve(root,valueOf('--config','offline.config.json'));
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const dist=path.resolve(root,valueOf('--dist','dist'));
if(!fs.existsSync(path.join(dist,'index.html')))throw Error(`No index.html in ${dist}. Run the normal game build first.`);
// (Blueberry Playground: the version is the game's own, from package.json, unless the config sets one)
const {appId,version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,mode='split',coreInclude=[]}=config;
if(!/^[a-z0-9][a-z0-9-]{1,39}$/.test(appId||''))throw Error('Set a unique lowercase appId (2–40 chars, letters/digits/hyphens).');
if(typeof version!=='string'||!version.trim())throw Error('Set version to your own game version.');
if(!['split','all-core'].includes(mode))throw Error('mode must be split or all-core.');
const toolDir=path.dirname(fileURLToPath(import.meta.url));
const kitDir=path.resolve(toolDir,'../kit');
const runtimeOut=path.join(dist,'offline');fs.mkdirSync(runtimeOut,{recursive:true});
for(const name of ['offline-client.js','save-backup.js','idb-backup.js','offline-panel.js','offline-panel.css','bounded-api.js']){
 fs.copyFileSync(path.join(kitDir,name),path.join(runtimeOut,name));
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>{
 const full=path.join(dir,d.name);
 if(d.isSymbolicLink())throw Error(`Symlinks not supported in release: ${full}`);
 return d.isDirectory()?walk(full):[full];
});}
function sha(data){return crypto.createHash('sha256').update(data).digest('hex');}
function patternRegExp(p){let s='';for(let i=0;i<p.length;i++){
 const c=p[i];if(c==='*'&&p[i+1]==='*'){s+='.*';i++;}else if(c==='*')s+='[^/]*';else if(c==='?')s+='[^/]';else s+=c.replace(/[\\^$+?.()|{}\[\]]/g,'\\$&');
 }return new RegExp('^'+s+'$');}
const include=coreInclude.map(patternRegExp);
const isCore=p=>mode==='all-core'||include.some(re=>re.test(p))||/\.(?:js|mjs|css|json|webmanifest|wasm|txt|woff2?|ttf|otf)$/i.test(p);
const reserved=new Set(['sw.js','index.html','offline-manifest.json','build-info.json']);
const files=walk(dist).map(full=>({full,rel:path.relative(dist,full).split(path.sep).join('/')}))
 .filter(x=>!reserved.has(x.rel)).sort((a,b)=>a.rel.localeCompare(b.rel));
const initial=[{path:'/',sha256:sha(fs.readFileSync(path.join(dist,'index.html'))),bytes:fs.statSync(path.join(dist,'index.html')).size,type:'core'},
 ...files.map(x=>({path:'/'+x.rel,sha256:sha(fs.readFileSync(x.full)),bytes:fs.statSync(x.full).size,type:isCore(x.rel)?'core':'media'}))];
const buildId=`${version}-${sha(JSON.stringify(initial)).slice(0,14)}`;
fs.writeFileSync(path.join(dist,'build-info.json'),JSON.stringify({appId,version,buildId},null,2)+'\n');
const buildInfo=path.join(dist,'build-info.json');
const entries=[...initial,{path:'/build-info.json',sha256:sha(fs.readFileSync(buildInfo)),bytes:fs.statSync(buildInfo).size,type:'core'}].sort((a,b)=>a.path.localeCompare(b.path));
// Fail loudly on filenames the service worker's strict, unambiguous URL matcher cannot support.
const invalid=entries.filter(e=>!e.path.startsWith('/') || !/^[a-zA-Z0-9_./-]*$/.test(e.path.slice(1)) || e.path.includes('..'));
if(invalid.length)throw Error(`Rename non-URL-safe release files before publishing: ${invalid.map(e=>e.path).join(', ')}`);
// Prevent content from being excluded by accident. Source map files may be sensitive; exclude from your standard build.
if(!entries.find(e=>e.path==='/'))throw Error('Missing canonical root page');
const manifest={format:1,appId,version,buildId,core:entries.filter(e=>e.type==='core').map(({type,...rest})=>rest),media:entries.filter(e=>e.type==='media').map(({type,...rest})=>rest)};
fs.writeFileSync(path.join(dist,'offline-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
let tpl=fs.readFileSync(path.join(kitDir,'sw.template.js'),'utf8');
tpl=tpl.replaceAll('__OFFLINE_APP_ID__',appId).replaceAll('__OFFLINE_BUILD_ID__',buildId);
fs.writeFileSync(path.join(dist,'sw.js'),tpl);
const bytes=entries.reduce((n,e)=>n+e.bytes,0),coreBytes=manifest.core.reduce((n,e)=>n+e.bytes,0);
console.log(`Offline kit ${appId} ${buildId}: core ${manifest.core.length} files (${(coreBytes/1048576).toFixed(2)} MiB), media ${manifest.media.length} files (${((bytes-coreBytes)/1048576).toFixed(2)} MiB)`);
console.log('All published game files accounted for. Ship the complete dist directory (including sw.js and offline-manifest.json).');
