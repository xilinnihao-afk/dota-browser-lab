import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parseMDX} from 'war3-model';
import {build} from 'esbuild';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'minitool/dist');
const manifest=JSON.parse(await fs.readFile(path.join(root,'minitool/generated/resources.json')));
const resourceReport=JSON.parse(await fs.readFile(path.join(root,'minitool/generated/resources-report.json')));
const built=await build({entryPoints:[path.join(root,'minitool/runtime/resources.ts')],bundle:true,format:'iife',globalName:'Runtime',write:false,target:'es2017'});
const sandbox={window:{},atob:s=>Buffer.from(s,'base64').toString('binary'),Float32Array,Float64Array,Uint32Array,Int32Array,Uint16Array,Int16Array,Uint8Array,Int8Array};
vm.createContext(sandbox);vm.runInContext(built.outputFiles[0].text,sandbox);const revive=sandbox.Runtime.revive;
let models=0,scalars=0,maxBase64=0,entries=0,maxFloatError=0;
const filenames=[];
async function walk(dir){for(const f of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())await walk(p);else filenames.push(p);}}await walk(dist);
assert(filenames.length<=200,'File count exceeds upload limit');
const allowed=new Set(['.html','.js','.css','.json','.png','.jpg','.jpeg','.gif','.webp','.svg','.woff','.woff2']);
for(const f of filenames){assert(allowed.has(path.extname(f)),f);assert(!f.includes('node_modules'));if(f.endsWith('.js')){const source=await fs.readFile(f,'utf8'),ast=ts.createSourceFile(f,source,ts.ScriptTarget.ES2017,true);assert.equal(ast.parseDiagnostics.length,0,f);assert(!/\b(?:fetch|XMLHttpRequest|WebAssembly|SharedWorker|WebSocket|EventSource)\b|\bnew\s+(?:Worker|Function)\s*\(|\beval\s*\(/.test(source),'Forbidden capability '+f);assert(!ast.statements.some(s=>ts.isImportDeclaration(s)||ts.isExportDeclaration(s)),'Must be classic script');}}
const loadedBundles=new Set(),resourceData=new Map();
async function data(key){const file=manifest[key].script;if(!loadedBundles.has(file)){sandbox.window.__dotaData=(actual,value)=>{assert.equal(manifest[actual]?.script,file,'Incorrect bundle member');assert(!resourceData.has(actual),'Duplicate resource '+actual);resourceData.set(actual,value);};vm.runInContext(await fs.readFile(path.join(dist,file),'utf8'),sandbox);loadedBundles.add(file);}assert(resourceData.has(key),key);const value=revive(resourceData.get(key));resourceData.set(key,value);return value;}
function compare(a,b,label){
 if(ArrayBuffer.isView(a)){assert.equal(a.constructor.name,b.constructor.name,label);assert.equal(a.length,b.length,label);for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);assert(delta<=Math.max(1e-6,Math.abs(a[i])*6e-7),label+': '+i);maxFloatError=Math.max(maxFloatError,delta);scalars++;}return;}
 if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a).filter(k=>k!=='Nodes').sort(),Object.keys(b).filter(k=>k!=='Nodes').sort(),label);for(const key of Object.keys(a))if(key!=='Nodes')compare(a[key],b[key],label+'.'+key);return;}
 assert.equal(a,b,label);
}
for(const [key,entry]of Object.entries(manifest)){
 await fs.access(path.join(dist,entry.image??entry.script));entries++;
 if(key.endsWith('.mdx')){const b=await fs.readFile(path.join(root,'public/assets/imba/resources',key));const original=parseMDX(b.buffer.slice(b.byteOffset,b.byteOffset+b.length)),actual=await data(key);compare(original,actual,key);for(const t of actual.Textures)if(t.Image)assert(manifest[t.Image.replaceAll('\\','/').toLowerCase()],key+' texture '+t.Image);models++;}
}
let images=0,inlineImages=0;
for(const texture of resourceReport.textures){
 const entry=manifest[texture.path];let bytes;
 if(entry.image)bytes=await fs.readFile(path.join(dist,entry.image));
 else{const uri=await data(texture.path);assert(uri.startsWith('data:image/webp;base64,'));bytes=Buffer.from(uri.slice('data:image/webp;base64,'.length),'base64');assert(bytes.length<=16384);inlineImages++;}
 assert.equal(bytes.length,texture.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),texture.sha256);images++;
}
const nav=await data('navigation'),wpm=await fs.readFile(path.join(root,'public/assets/imba/pathing.wpm'));assert.equal(nav.width,wpm.readUInt32LE(8));assert.equal(nav.height,wpm.readUInt32LE(12));assert.deepEqual(Buffer.from(nav.cells),wpm.subarray(16));
const map=await data('map'),shadow=await data('shadow');assert.equal(shadow.length,map.shadow.width*map.shadow.height);
const sourceMap=JSON.parse(await fs.readFile(path.join(root,'public/assets/imba/map.json')));
compare(sourceMap.corners,await data('corners'),'map corners');
for(const placement of sourceMap.placements){delete placement.sourceLine;delete placement.editorId;}
compare(sourceMap.placements,await data('placements'),'map placements');
const assets=JSON.parse(await fs.readFile(path.join(root,'src/classic/battle/assets.json')));let audio=0;
for(const p of Object.values(assets.audio)){const a=await data(p),samples=a.blocks.reduce((n,b)=>n+b.length,0);assert(a.rate===16000&&samples>1000);assert(a.blocks.some(b=>b.some(v=>v!==0)));audio++;}
const html=await fs.readFile(path.join(dist,'index.html'),'utf8');assert(!/<script(?![^>]*src=)|type="module"|\bon\w+=|https?:\/\//.test(html));assert(html.includes('viewport-fit=cover'));
for(const f of filenames.filter(f=>f.endsWith('.js'))){const source=await fs.readFile(f,'utf8');for(const m of source.matchAll(/"base64":"([A-Za-z0-9+/=]+)"/g)){const n=Buffer.from(m[1],'base64').length;maxBase64=Math.max(maxBase64,n);assert(n<=102400);}}
const checks={result:'PASS',files:filenames.length,limitFiles:200,resourceEntries:entries,bundles:loadedBundles.size,modelsCompared:models,typedScalarsCompared:scalars,maxAnimationFloatError:maxFloatError,maxBase64Bytes:maxBase64,imagesByteChecked:images,inlineImages,audioEntries:audio,navigation:'byte-identical walkability grid',shadow:'dimensions checked',webCapabilities:'no network/eval/worker/WASM; classic scripts',sha256:createHash('sha256').update(await fs.readFile(path.join(dist,'app.js'))).digest('hex')};
const reportPath=path.resolve(root,process.argv[2]??'minitool/generated/asset-check.json');
await fs.mkdir(path.dirname(reportPath),{recursive:true});
await fs.writeFile(reportPath,JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
