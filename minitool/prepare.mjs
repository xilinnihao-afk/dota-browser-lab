// Build-time conversion only. Ship semantic model fields and native image data,
// never original archives, model decoders, network loaders, or renamed binaries.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseMDX,decodeBLP,getBLPImageData} from 'war3-model';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';
import {PNG} from 'pngjs';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('./toolchain/package.json',import.meta.url))('sharp');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'minitool/public');
const source=path.join(root,'public/assets/imba/resources');
await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(path.join(out,'data'),{recursive:true});
await fs.mkdir(path.join(out,'images'),{recursive:true});
globalThis.ImageData=class {constructor(data,width,height){if(typeof data==='number'){this.width=data;this.height=width;this.data=new Uint8ClampedArray(data*width*4);}else{this.data=data;this.width=width;this.height=height;}}};
const norm=p=>p.replaceAll('\\','/').toLowerCase();
const assets=JSON.parse(await fs.readFile(path.join(root,'src/classic/battle/assets.json'),'utf8'));
const map=JSON.parse(await fs.readFile(path.join(root,'public/assets/imba/map.json'),'utf8'));
const needed=new Set(map.resources.map(norm));
for(const group of Object.values(assets))for(const p of Object.values(group))needed.add(norm(p));
for(const p of map.placements){needed.add(norm(p.model));for(const v of Object.values(p.replacements))needed.add(norm(v));if(p.splat)needed.add(norm(p.splat.path));}
for(const p of [...map.cliffInstances,...map.rampInstances])needed.add(norm(p.path));
for(const p of [...map.tiles,...map.cliffs])needed.add(norm(p.path));
map.water.paths.forEach(p=>needed.add(norm(p)));
needed.add(map.lighting.terrain);needed.add(map.lighting.unit);
['replaceabletextures/selection/selectioncirclelarge.blp','replaceabletextures/shadows/shadow.blp','textures/genericglow2c.blp'].forEach(p=>needed.add(p));
for(const team of [0,1,12])for(const kind of ['teamcolor','teamglow'])needed.add(`replaceabletextures/${kind}/${kind}${String(team).padStart(2,'0')}.blp`);
const models=new Map();
for(const p of [...needed].filter(p=>p.endsWith('.mdx'))){
 const b=await fs.readFile(path.join(source,p)),m=parseMDX(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
 if(m.Version!==800)throw Error('Unsupported model '+p);
 for(const t of m.Textures)if(t.Image)needed.add(norm(t.Image));
 // Nodes aliases Bones/Helpers/etc. Reconstruct aliases at load time.
 delete m.Nodes;models.set(p,m);
}
const manifest={},report={models:[],textures:[],audio:[],map:{},bundles:[],maxBase64Bytes:0};
const resourceGroups=new Map(),bundleTargetBytes=512*1024,inlineImageLimit=16*1024;
function typed(k,v){
 // Animation tracks share a schema across thousands of tiny keyframes. Store
 // field names/types once per track instead of repeating them for every key.
 if(v&&Array.isArray(v.Keys)&&v.Keys.length){const fields=Object.keys(v.Keys[0]),types=fields.map(k=>ArrayBuffer.isView(v.Keys[0][k])?v.Keys[0][k].constructor.name:null),rows=v.Keys.map(row=>fields.map(k=>ArrayBuffer.isView(row[k])?Array.from(row[k],x=>Number.isInteger(x)?x:Number(x.toPrecision(7))):row[k]));const result={...v};delete result.Keys;result.$keys={fields,types,rows};return result;}
 if(ArrayBuffer.isView(v)){const bytes=Buffer.from(v.buffer,v.byteOffset,v.byteLength);report.maxBase64Bytes=Math.max(report.maxBase64Bytes,bytes.length);if(bytes.length>102400)throw Error('Oversized geometry field: '+k);return {$type:v.constructor.name,base64:bytes.toString('base64')};}return v;
}
async function resource(key,data,group=key.endsWith('.mdx')?'models':key.endsWith('.wav')?'audio':'map'){
 const text='window.__dotaData('+JSON.stringify(key)+','+JSON.stringify(data,typed)+');\n',bytes=Buffer.byteLength(text);
 if(!resourceGroups.has(group))resourceGroups.set(group,[]);
 resourceGroups.get(group).push({key,text,bytes});return bytes;
}
async function writeBundles(){
 for(const [group,resources]of resourceGroups){
  let chunk=[],size=0,index=0;
  const flush=async()=>{if(!chunk.length)return;const text=chunk.map(r=>r.text).join(''),file=`data/${group}-${index++}-${createHash('sha256').update(text).digest('hex').slice(0,12)}.js`;await fs.writeFile(path.join(out,file),text);for(const r of chunk)manifest[r.key]={script:file};report.bundles.push({file,resources:chunk.length,bytes:size});chunk=[];size=0;};
  for(const r of resources){if(size+r.bytes>bundleTargetBytes)await flush();chunk.push(r);size+=r.bytes;}await flush();
 }
}
for(const [p,m]of models)report.models.push({path:p,bytes:await resource(p,m)});
function resize(image,max){const scale=Math.min(1,max/Math.max(image.width,image.height));if(scale===1)return image;const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale)),data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let count=0,alpha=0,r=0,g=0,b=0;for(let sy=Math.floor(y/scale);sy<Math.min(image.height,Math.ceil((y+1)/scale));sy++)for(let sx=Math.floor(x/scale);sx<Math.min(image.width,Math.ceil((x+1)/scale));sx++){const i=(sy*image.width+sx)*4,a=image.data[i+3];alpha+=a;r+=image.data[i]*a;g+=image.data[i+1]*a;b+=image.data[i+2]*a;count++;}const i=(y*width+x)*4;data[i]=alpha?r/alpha:0;data[i+1]=alpha?g/alpha:0;data[i+2]=alpha?b/alpha:0;data[i+3]=alpha/count;}return{data,width,height};}
for(const p of [...needed].filter(p=>/\.(blp|tga)$/.test(p)&&!p.startsWith('ui/console/')).sort()){
 const b=await fs.readFile(path.join(source,p)),buffer=b.buffer.slice(b.byteOffset,b.byteOffset+b.length);
 const decoded=p.endsWith('.tga')?new TGALoader().parse(buffer):getBLPImageData(decodeBLP(buffer),0);
 const img=resize(decoded,p.startsWith('terrainart/')?512:256),file='images/'+createHash('sha256').update(p).digest('hex').slice(0,16)+'.webp';
 const png=await sharp(Buffer.from(img.data),{raw:{width:img.width,height:img.height,channels:4}}).webp({quality:74,alphaQuality:90,effort:6}).toBuffer();await fs.writeFile(path.join(out,file),png);manifest[p]={image:file};report.textures.push({path:p,width:img.width,height:img.height,bytes:png.length,rgbaBytes:img.width*img.height*4,sha256:createHash('sha256').update(png).digest('hex')});
}
const atlasParts=[];for(let i=0;i<map.tiles.length;i++)atlasParts.push({input:await sharp(path.join(out,manifest[norm(map.tiles[i].path)].image)).resize(256,256,{fit:'fill'}).png().toBuffer(),left:(i%4)*256,top:Math.floor(i/4)*256});
await sharp({create:{width:1024,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(atlasParts).webp({quality:78,alphaQuality:90,effort:6}).toFile(path.join(out,'images/terrain-atlas.webp'));
manifest['minitool/terrain-atlas.webp']={image:'images/terrain-atlas.webp'};
// Only tiny images become data URLs, preserving their encoded bytes exactly.
// Larger images and the terrain atlas stay native files; no runtime unpacker.
for(const t of report.textures){
 if(t.bytes>inlineImageLimit)continue;
 const file=manifest[t.path].image,bytes=await fs.readFile(path.join(out,file));
 await resource(t.path,'data:image/webp;base64,'+bytes.toString('base64'),'images');
 await fs.unlink(path.join(out,file));t.inline=true;report.maxBase64Bytes=Math.max(report.maxBase64Bytes,bytes.length);
}
// WPM and SHD become explicit navigation/shadow grids, not opaque binary files.
const wpm=await fs.readFile(path.join(root,'public/assets/imba/pathing.wpm'));
await resource('navigation',{width:wpm.readUInt32LE(8),height:wpm.readUInt32LE(12),cells:Array.from(wpm.subarray(16))});
await resource('shadow',Array.from(await fs.readFile(path.join(source,map.shadow.path))));
// Keep only gameplay/render fields; remove importer inventories and diagnostics.
for(const key of ['modelInfo','resources','excluded','script'])delete map[key];
const placements=map.placements;delete map.placements;
const corners=map.corners;delete map.corners;
for(const p of placements){delete p.sourceLine;delete p.editorId;}
await resource('map',map);await resource('corners',corners);await resource('placements',placements);
report.map={placements:placements.length,corners:corners.length};
// WAV assets are short PCM effects. Resample to 16 kHz mono signed PCM and
// store explicit sample data consumed by AudioBuffer, without media URLs.
for(const p of [...new Set(Object.values(assets.audio))]){
 const b=await fs.readFile(path.join(source,p));let fmt,pcm;
 for(let i=12;i+8<=b.length;){const name=b.toString('ascii',i,i+4),n=b.readUInt32LE(i+4);if(name==='fmt ')fmt=b.subarray(i+8,i+8+n);if(name==='data')pcm=b.subarray(i+8,i+8+n);i+=8+n+(n%2);}
 if(!fmt||!pcm||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(14)!==16)throw Error('Expected PCM16 '+p);
 const rate=fmt.readUInt32LE(4),channels=fmt.readUInt16LE(2),target=16000,frames=pcm.length/(2*channels),samples=new Int16Array(Math.floor(frames*target/rate));
 for(let i=0;i<samples.length;i++){const f=i*rate/target,a=Math.floor(f),t=f-a;let v=0;for(let c=0;c<channels;c++)v+=pcm.readInt16LE((a*channels+c)*2)*(1-t)+pcm.readInt16LE((Math.min(frames-1,a+1)*channels+c)*2)*t;samples[i]=Math.round(v/channels);}
 // Long clips use explicit short sample blocks; no whole-file base64 blob.
 const blocks=[];for(let i=0;i<samples.length;i+=32000)blocks.push(samples.slice(i,i+32000));
 report.audio.push({path:p,samples:samples.length,rate:target,bytes:await resource(p,{rate:target,blocks})});
}
for(const folder of ['assets/presentation','assets/imba/resources/ui/derived'])await fs.cp(path.join(root,'public',folder),path.join(out,folder),{recursive:true});
for(const file of ['dota-heroes.jpg','dota-allstars.jpg'])await sharp(path.join(root,'public/assets/presentation',file)).resize({width:1000,withoutEnlargement:true}).jpeg({quality:72}).toFile(path.join(out,'assets/presentation',file));
await fs.mkdir(path.join(out,'assets/imba'),{recursive:true});await fs.copyFile(path.join(root,'public/assets/imba/minimap.png'),path.join(out,'assets/imba/minimap.png'));
await writeBundles();
await fs.writeFile(path.join(root,'minitool/generated/resources.json'),JSON.stringify(manifest));
await fs.writeFile(path.join(root,'minitool/generated/resources-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({models:report.models.length,textures:report.textures.length,inlinedImages:report.textures.filter(t=>t.inline).length,bundles:report.bundles.length,audio:report.audio.length,maxBase64Bytes:report.maxBase64Bytes,rgbaMiB:report.textures.reduce((n,t)=>n+t.rgbaBytes,0)/1048576}));
