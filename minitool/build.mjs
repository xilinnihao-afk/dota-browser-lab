import fs from 'node:fs/promises';
import path from 'node:path';
import {build,transform} from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
const root=path.resolve(import.meta.dirname,'..'),mini=path.join(root,'minitool'),out=path.join(mini,'dist');
const read=p=>fs.readFile(p,'utf8');
function swap(s,a,b){if(!s.includes(a))throw Error('Missing source integration: '+a.slice(0,100));return s.replace(a,b);}
function between(s,a,b,r){const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<0)throw Error('Missing source section '+a);return s.slice(0,i)+r+s.slice(j);}
const runtime=name=>JSON.stringify(path.join(mini,'runtime',name));
const plugin={name:'dota-offline',setup(ctx){
 ctx.onLoad({filter:/\/three\/build\/three\.(?:core|module)\.js$/},async args=>{
  let s=await read(args.path);const ast=ts.createSourceFile(args.path,s,ts.ScriptTarget.Latest,true),edits=[];
  for(const node of ast.statements)if(ts.isClassDeclaration(node)&&['WebXRManager','FileLoader','ImageBitmapLoader'].includes(node.name?.text)){
   const name=node.name.text,body=name==='WebXRManager'?`class WebXRManager extends EventDispatcher{constructor(){super();this.enabled=false;this.isPresenting=false;}setAnimationLoop(){}dispose(){}getSession(){return null;}getCamera(c){return c;}updateCamera(){}hasDepthSensing(){return false;}getEnvironmentBlendMode(){return 'opaque';}getDepthTexture(){return null;}}`:`class ${name} extends Loader{load(){throw Error('仅支持包内图片和模型数据');}}`;
   edits.push([node.getStart(ast),node.end,body]);
  }
  for(const[a,b,t]of edits.reverse())s=s.slice(0,a)+t+s.slice(b);return{contents:s,loader:'js'};
 });
 ctx.onLoad({filter:/\/controls\/OrbitControls\.js$/},async args=>{
  let s=await read(args.path);
  s='import {gameControlPoint,gameRect} from '+JSON.stringify(path.join(root,'src/classic/viewport.ts'))+';\n'+s;
  s=s.replace(/event\.(client|page)(X|Y)/g,(_,kind,axis)=>`gameControlPoint(event,'${kind}').${axis.toLowerCase()}`);
  s=swap(s,'this.domElement.getBoundingClientRect()','gameRect(this.domElement)');
  return{contents:s,loader:'js'};
 });
 ctx.onLoad({filter:/\/src\/classic\/.*\.ts$/},async args=>{
  let s=await read(args.path);const name=path.basename(args.path);
  if(name==='assets.ts'){
   s=s.replace("import {TGALoader} from 'three/addons/loaders/TGALoader.js';",'').replace("import { decodeBLP, getBLPImageData, parseMDX, type model } from 'war3-model';","import type {model} from 'war3-model';\nimport {loadData,imagePath} from "+runtime('resources.ts')+';');
   s=between(s,'async function binary(', 'export function loadTexture',`export function loadModel(path:string):Promise<model.Model>{path=normalizeAssetPath(path);if(!models.has(path))models.set(path,loadData(path).then(m=>{m.Nodes=[];for(const key of ['Bones','Helpers','Attachments','EventObjects','ParticleEmitters','ParticleEmitters2','Lights','RibbonEmitters','CollisionShapes'])for(const node of m[key]||[])if(node.ObjectId!==undefined)m.Nodes[node.ObjectId]=node;return m;}));return models.get(path)!;}
async function pixelsFromImage(path:string):Promise<{data:Uint8ClampedArray;width:number;height:number}>{const source=await imagePath(path);return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);resolve(ctx.getImageData(0,0,canvas.width,canvas.height));}catch(e){reject(e);}};img.onerror=()=>reject(Error('贴图读取失败：'+path));img.src=source;});}
`);
   s=between(s,"textures.set(key, binary(",'    const texture =',`textures.set(key, pixelsFromImage(path).then(pixels => {\n`);
   s=s.replace('texture.anisotropy = 4','texture.anisotropy = 1');
   s+=`\nexport function lowerTextureBudget(){for(const task of textures.values())void task.then(t=>{const img=t.image;if(img.width<=128&&img.height<=128||t.name==='minitool/terrain-atlas.webp')return;const width=Math.max(1,img.width>>1),height=Math.max(1,img.height>>1),data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++)data[(y*width+x)*4+c]=(img.data as Uint8Array)[((y*2)*img.width+x*2)*4+c];t.dispose();t.image={data,width,height};t.needsUpdate=true;}).catch(()=>{});}\n`;
  }
  if(name==='map-terrain.ts'){
   s='import {loadData} from '+runtime('resources.ts')+';\n'+s;
   s=between(s,'if(map.shadow){const response=', '    if(bytes.length',"if(map.shadow){const bytes=new Uint8Array(await loadData('shadow'));\n");
   s=swap(s,'const textures=await Promise.all(map.tiles.map(t=>loadTexture(t.path)));',"const atlas=await loadTexture('minitool/terrain-atlas.webp');");
   s=swap(s,'${Math.floor(y/16)},${t},${Number(alpha)}','${Math.floor(y/16)},0,${Number(alpha)}');
   s=swap(s,'b.uv.push((col+(dx===0?.008:.992))/columns,(row+(dy===0?.992:.008))/4);','b.uv.push(((t%4)+(col+(dx===0?.008:.992))/columns)/4,(Math.floor(t/4)+(row+(dy===0?.992:.008))/4)/4);');
   s=swap(s,'map:textures[t]','map:atlas');
  }
  if(name==='controller.ts'){
   s='import {loadNavigation} from '+runtime('resources.ts')+';\n'+s;
   s=between(s,'  const response=await fetch(', '  const nav=', '');s=swap(s,'await response.arrayBuffer()','await loadNavigation()');
  }
  if(name==='audio.ts'){
   s='import {loadData,pcmBuffer} from '+runtime('resources.ts')+';\n'+s;
   s=between(s,'    const response=await fetch(', '  }));',`    return [id,await loadData(path)]as const;\n`);
   s=swap(s,'context.decodeAudioData(data.slice(0))','Promise.resolve(pcmBuffer(context,data))');
   s=s.replace('ctx.createStereoPanner()','typeof ctx.createStereoPanner===\'function\'?ctx.createStereoPanner():ctx.createGain()').replace('pan.pan.value=panning',"if('pan'in pan)pan.pan.value=panning");
  }
  if(name==='mobile-profile.ts'){
   s=swap(s,"return 'auto';","return 'auto';");
   s=between(s,'  const cap=', '\n}\nexport function loadMobileQuality',`  const cap=quality==='smooth'?1:1.25;const pixels=quality==='smooth'?1000000:2000000;
  return {pixelRatio:Math.min(deviceRatio,cap,Math.sqrt(pixels/Math.max(1,gameViewport.width*gameViewport.height))),fps:30};`);
  }
  if(['mobile-profile.ts','mobile-controls.ts'].includes(name))s='import {storage} from '+runtime('platform.ts')+';\n'+s.replaceAll('localStorage.','storage.');
  if(name==='loading-screen.ts')s=swap(s,'document.body.append(root)',"document.getElementById('minitool-stage')!.append(root)");
  if(name==='hud.ts')s=s.replace(/<a href="\?scene=1[^`]*?<\/a>/,'');
  if(name==='map-main.ts'){
   s='import {lowerTextureBudget} from "./assets";\nimport {loadMap} from '+runtime('resources.ts')+';\nimport {createRenderBudget,fallback} from '+runtime('render.ts')+';\n'+s;
   s=swap(s,"const playMode=query.has('play')||(!query.has('scene')&&!query.has('view')&&!query.has('capture'));",'const playMode=true;');
   s=s.replace('antialias:true',"antialias:false").replace("powerPreference:'high-performance'","powerPreference:'low-power'");
   s=swap(s,'let quality=loadMobileQuality()',"const budget=createRenderBudget(renderer,()=>applyQuality('smooth'));\nlet quality=loadMobileQuality()");
   s=swap(s,'quality=value;mobileRenderer=',"quality=value;budget.setLow(value==='smooth');if(value==='smooth')lowerTextureBudget();mobileRenderer=");
   s=swap(s,'if(mobileRenderer&&now-last<1000/frameLimit-1)return;',"if(document.hidden||budget.stopped)return;if(now-last<1000/frameLimit-1)return;budget.restore();");
   s=swap(s,'maxDelta=Math.max(maxDelta,elapsed*1000);','maxDelta=Math.max(maxDelta,elapsed*1000);if(!budget.observe(elapsed))return;');
   s=swap(s,'renderer.render(battle?.selectionScene??scene,camera);','budget.limit(battle?.selectionScene??scene,camera,controls.target);renderer.render(battle?.selectionScene??scene,camera);');
   s=between(s,'  const response=await fetch(', "  loading.set(10,",'  const map:MapData=await loadMap();\n');
   s=swap(s,"}catch(error){loading.fail(error);console.error(error);}","}catch(error){loading.fail(error);throw error;}");
   s=swap(s,'};renderer.setAnimationLoop(frame);',`};renderer.setAnimationLoop(frame);
  const suspend=()=>{if(document.hidden)renderer.setAnimationLoop(null);else if(!disposed&&!budget.stopped){last=performance.now();renderer.setAnimationLoop(frame);}};document.addEventListener('visibilitychange',suspend);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();renderer.setAnimationLoop(null);budget.stop();battle?.dispose();fallback('画面已暂停。点击重新进入可恢复游戏。');});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{fallback('图形环境已恢复，请点击重新进入。');});`);
   // Imports stay at module scope; all side effects run after native bootstrap
   // and inside the WebGL/error guard. No top-level await in the output.
   const ast=ts.createSourceFile(args.path,s,ts.ScriptTarget.Latest,true),imports=[],body=[];
   for(const stmt of ast.statements)(ts.isImportDeclaration(stmt)?imports:body).push(stmt.getFullText(ast));
   s=imports.join('\n')+'\nexport async function bootGame(){\n'+body.join('\n')+'\n}';
  }
  return{contents:s,loader:'ts'};
 });
}};
await fs.rm(out,{recursive:true,force:true});await fs.cp(path.join(mini,'public'),out,{recursive:true});
const result=await build({entryPoints:[path.join(mini,'entry.ts')],bundle:true,format:'iife',target:['chrome61','es2017'],outfile:path.join(out,'app.js'),minify:true,legalComments:'none',metafile:true,define:{'import.meta.env.BASE_URL':'"./"','import.meta.env.DEV':'false','import.meta.env':'{"BASE_URL":"./","DEV":false}'},plugins:[plugin]});
// Declarative Chrome 61 fallbacks for the existing responsive CSS.
let css=await read(path.join(out,'app.css')),tree=postcss.parse(css);
function splitArgs(value){const parts=[];let depth=0,start=0;for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&depth===0){parts.push(value.slice(start,i).trim());start=i+1;}}parts.push(value.slice(start).trim());return parts;}
function basic(value){value=value.replace(/(\d+(?:\.\d+)?)(?:dvh|svh|lvh)/g,'$1vh').replace(/env\(safe-area-inset-\w+(?:,[^)]*)?\)/g,'0px');let match;while((match=/\b(min|max|clamp)\(/.exec(value))){let depth=1,end=match.index+match[0].length;for(;end<value.length&&depth;end++){if(value[end]==='(')depth++;if(value[end]===')')depth--;}const a=splitArgs(value.slice(match.index+match[0].length,end-1));const fallback=match[1]==='clamp'?a[1]:(a.find(x=>/^\d.*(?:vw|vh|%)$/.test(x))??a[0]);value=value.slice(0,match.index)+fallback+value.slice(end);}return value;}
tree.walkRules(rule=>{if(rule.selector.includes(':has(')&&rule.selector.includes('ihca-feedback'))rule.remove();});
tree.walkDecls(d=>{
 const original=d.value,b=basic(original);if(b!==original)d.cloneBefore({value:b});
 d.value=original.replace(/env\(safe-area-inset-(top|bottom|left|right)(?:,\s*0px)?\)/g,(_,s)=>`var(--safe-area-inset-${s},env(safe-area-inset-${s},0px))`);
 if(d.prop==='inset'){const v=b.match(/(?:[^\s(]+\([^)]*\)|[^\s]+)/g)||[];if(v.length<=4)for(const [i,p]of ['top','right','bottom','left'].entries())d.cloneBefore({prop:p,value:v[i]??v[i%2]??v[0]});}
 if(d.prop==='gap')d.cloneBefore({prop:'grid-gap'});
 if(d.prop==='place-items'){d.cloneBefore({prop:'align-items'});d.cloneBefore({prop:'justify-items'});}
});
css=tree.toString()+'\n'+await read(path.join(mini,'container.css'));
const logicalCss=postcss.parse(css);logicalCss.walkDecls(d=>{d.value=d.value.replace(/(-?\d*\.?\d+)(?:d|s|l)?v([wh])\b/g,(_,n,axis)=>`calc(var(--game-v${axis}) * ${n})`);});css=logicalCss.toString();
await fs.writeFile(path.join(out,'app.css'),(await transform(css,{loader:'css',target:'chrome61',minify:true})).code);
await fs.writeFile(path.join(out,'index.html'),'<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"><title>Dota · 经典战场</title><link id="minitool-styles" rel="stylesheet" href="./app.css"></head><body><div id="minitool-stage"><div id="app"></div><section id="minitool-recovery" hidden role="alert"><h2>暂时无法进入战场</h2><p></p><button id="minitool-retry">重新进入</button></section></div><script src="./app.js"></script></body></html>\n');
await fs.writeFile(path.join(mini,'generated/bundle.json'),JSON.stringify(result.metafile,null,2));
await fs.writeFile(path.join(out,'licenses.json'),JSON.stringify({three:{version:'0.180.0',license:await read(path.join(root,'node_modules/three/LICENSE'))},sourceMap:'IMBA 3.83d AI; source provenance retained in packaged map data'},null,2));
console.log('Built '+out);
