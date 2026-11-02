import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {build} from 'esbuild';

const manifest={a:{script:'shared.js'},b:{script:'shared.js'},picture:{script:'images.js'},large:{image:'large.webp'}};
for(let i=0;i<6;i++)manifest['other'+i]={script:'other'+i+'.js'};
const built=await build({stdin:{contents:(await fs.readFile(new URL('./runtime/resources.ts',import.meta.url),'utf8')).replace("import manifest from '../generated/resources.json';",'const manifest='+JSON.stringify(manifest)+';'),loader:'ts',resolveDir:import.meta.dirname},bundle:true,write:false,format:'iife',globalName:'Runtime',target:['chrome61','es2017']});
function setup(){
 const live=[],requests=[],timers=new Map();let timerId=0;
 const context=vm.createContext({window:{},atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),document:{
  createElement:()=>({remove(){const i=live.indexOf(this);if(i>=0)live.splice(i,1);}}),
  head:{appendChild(script){live.push(script);requests.push(script.src);}},
 }});
 vm.runInContext(built.outputFiles[0].text,context);
 const complete=(file,values)=>{const script=live.find(s=>s.src==='./'+file);assert(script,file);for(const [key,value]of Object.entries(values))context.window.__dotaData(key,value);script.onload();};
 return {api:context.Runtime,live,requests,timers,complete,context};
}
test('shared bundle loads once; concurrent and later consumers keep the same decoded data',async()=>{
 const h=setup(),a=h.api.loadData('a'),again=h.api.loadData('a'),b=h.api.loadData('b');
 assert.equal(a,again);assert.deepEqual(h.requests,['./shared.js']);
 h.complete('shared.js',{a:{$type:'Uint8Array',base64:'AQID'},b:{ok:true}});
 assert.deepEqual(Array.from(await a),[1,2,3]);assert.equal((await b).ok,true);
 assert.equal(await h.api.loadData('a'),await a);assert.equal(h.requests.length,1);assert.equal(h.live.length,0);
});
test('unrequested bundle members remain available without executing the script again',async()=>{
 const h=setup(),a=h.api.loadData('a');h.complete('shared.js',{a:1,b:2});assert.equal(await a,1);
 assert.equal(await h.api.loadData('b'),2);assert.equal(h.requests.length,1);
});
test('caps physical script requests at four and drains the queue',async()=>{
 const h=setup(),jobs=Array.from({length:6},(_,i)=>h.api.loadData('other'+i));
 assert.equal(h.live.length,4);assert.equal(h.requests.length,4);
 for(let i=0;i<6;i++){h.complete('other'+i+'.js',{['other'+i]:i});assert(h.live.length<=4);}
 assert.deepEqual(await Promise.all(jobs),[0,1,2,3,4,5]);assert.equal(h.timers.size,0);
});
test('failed bundles reject every consumer and retry without stale partial data',async()=>{
 const h=setup(),a=h.api.loadData('a'),b=h.api.loadData('b');
 const rejected=Promise.all([assert.rejects(a,/读取失败/),assert.rejects(b,/读取失败/)]);
 h.context.window.__dotaData('a','stale');h.live[0].onerror();await rejected;
 const retry=h.api.loadData('a');h.complete('shared.js',{a:'fresh',b:2});assert.equal(await retry,'fresh');assert.equal(h.requests.length,2);
});
test('missing callbacks invalidate the bundle and allow a complete retry',async()=>{
 const h=setup(),first=h.api.loadData('a'),rejected=assert.rejects(first,/格式错误/);
 h.complete('shared.js',{a:1});await rejected;
 const retry=h.api.loadData('b');h.complete('shared.js',{a:2,b:3});assert.equal(await retry,3);assert.equal(await h.api.loadData('a'),2);
});
test('timeout releases its slot, clears partial records and permits retry',async()=>{
 const h=setup(),first=h.api.loadData('a'),rejected=assert.rejects(first,/超时/);
 h.context.window.__dotaData('a','stale');[...h.timers.values()][0]();await rejected;assert.equal(h.live.length,0);
 const retry=h.api.loadData('a');h.complete('shared.js',{a:'fresh',b:2});assert.equal(await retry,'fresh');
});
test('image sources support bundled data URLs and native files; unknown keys fail',async()=>{
 const h=setup(),picture=h.api.imagePath('picture');h.complete('images.js',{picture:'data:image/webp;base64,AQID'});
 assert.equal(await picture,'data:image/webp;base64,AQID');assert.equal(await h.api.imagePath('large'),'./large.webp');
 await assert.rejects(h.api.loadData('missing'),/缺少包内资源/);await assert.rejects(h.api.imagePath('missing'),/缺少贴图/);
 const bad=h.api.imagePath('a');h.complete('shared.js',{a:{},b:2});await assert.rejects(bad,/缺少贴图/);
});
