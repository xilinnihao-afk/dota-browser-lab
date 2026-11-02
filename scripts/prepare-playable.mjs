import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseMDX,decodeBLP,getBLPImageData} from 'war3-model';
import {PNG} from 'pngjs';
import MapParser from 'mdx-m3-viewer/dist/cjs/parsers/w3x/map.js';
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile),check=process.argv.includes('--check');
const catalog=JSON.parse(await fs.readFile(path.join(root,'src/classic/battle/assets.json'),'utf8'));
const destination=path.join(root,'public/assets/imba/resources'),record=path.join(root,'artifacts/imba-playable/assets.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),normal=p=>p.replaceAll('\\','/').toLowerCase();
const read=async p=>{try{return await fs.readFile(p);}catch{return null;}};
if(check){
  const manifest=JSON.parse(await fs.readFile(record,'utf8'));const scene=JSON.parse(await fs.readFile(path.join(root,'public/assets/imba/map.json'),'utf8'));if(manifest.source.sha256!==scene.source.sha256)throw new Error('Playable resources do not match the imported map');
  for(const section of ['models','effects','missiles','icons','audio','ui','selectionModels'])for(const p of Object.values(catalog[section]??{}))if(!manifest.files[normal(p)])throw new Error('Catalog asset missing from manifest: '+p);
  for(const name of ['minimap','portrait','info','inventory','commands','top'])if(!manifest.files[`ui/derived/${name}.png`])throw new Error('Missing console crop '+name);
  for(const [p,r]of Object.entries(manifest.files)){const b=await fs.readFile(path.join(destination,p));if(hash(b)!==r.sha256)throw new Error('Asset hash mismatch '+p);}
  const w=await fs.readFile(path.join(root,'public/assets/imba/pathing.wpm'));if(hash(w)!==manifest.pathing.sha256)throw new Error('Pathing hash mismatch');
  console.log(`Verified ${Object.keys(manifest.files).length} playable assets and original ${manifest.pathing.width} × ${manifest.pathing.height} WPM.`);
}else{
  const input=process.argv[2];if(!input)throw new Error('Usage: npm run play:prepare -- /path/to/map.w3x');
  const bytes=await fs.readFile(input),map=new MapParser.default();map.load(new Uint8Array(bytes),true);
  const files={},jobs=new Map(),textures=new Set(['replaceabletextures/selection/selectioncirclelarge.blp',...Object.values(catalog.icons),...Object.values(catalog.ui??{})]);
  const get=p=>{p=normal(p);if(jobs.has(p))return jobs.get(p);const job=(async()=>{
    const embedded=map.get(p.replaceAll('/','\\'));let b=embedded?Buffer.from(embedded.arrayBuffer()):await read(path.join(destination,p))??await read(path.join(root,'.local/classic-cache',p))??await read(path.join(root,'public/assets/original',p));
    const origin=embedded?'map':'classic-reference';
    if(!b){console.log('Fetch '+p);const r=await exec('curl',['-fLsS','--retry','2','--connect-timeout','8','--max-time','35','https://www.hiveworkshop.com/data/static_assets/mpq/tft/'+p],{encoding:'buffer',maxBuffer:15*1024*1024});b=r.stdout;}
    if(p.endsWith('.mdx')){if(b.toString('ascii',0,4)!=='MDLX')throw new Error('Invalid MDX '+p);const m=parseMDX(new Uint8Array(b).buffer);if(m.Version!==800)throw new Error('Unsupported MDX '+p);for(const t of m.Textures){if(t.Image)textures.add(normal(t.Image));else if(t.ReplaceableId===1||t.ReplaceableId===2)for(const team of ['00','01','06','12'])textures.add(`replaceabletextures/${t.ReplaceableId===1?'teamcolor/teamcolor':'teamglow/teamglow'}${team}.blp`);else throw new Error('Unmapped replaceable '+p+': '+t.ReplaceableId);}}
    if(p.endsWith('.wav')&&(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'))throw new Error('Invalid WAV '+p);
    if(p.endsWith('.blp'))getBLPImageData(decodeBLP(new Uint8Array(b).buffer),0);
    await fs.mkdir(path.dirname(path.join(destination,p)),{recursive:true});await fs.writeFile(path.join(destination,p),b);
    if(!embedded){const cache=path.join(root,'.local/classic-cache',p);await fs.mkdir(path.dirname(cache),{recursive:true});await fs.writeFile(cache,b);}
    files[p]={origin,bytes:b.length,sha256:hash(b)};return b;
  })();jobs.set(p,job);return job;};
  const batch=async paths=>{let n=0;await Promise.all(Array.from({length:6},async()=>{while(n<paths.length)await get(paths[n++]);}));};
  await batch([...new Set([...Object.values(catalog.models),...Object.values(catalog.selectionModels??{}),...Object.values(catalog.effects),...Object.values(catalog.missiles??{}),...Object.values(catalog.audio??{})])]);await batch([...textures]);
  // Preserve the original console artwork; crop its semantic panels so the
  // classic arrangement can fit widescreen. All lower panels share one source
  // baseline so the Undead bone frame remains continuous across panel edges.
  const consoleImage=new PNG({width:1600,height:512});let consoleX=0;
  for(const p of Object.values(catalog.ui)){const decoded=getBLPImageData(decodeBLP(new Uint8Array(await get(p)).buffer),0),tile=new PNG({width:decoded.width,height:decoded.height});tile.data=Buffer.from(decoded.data);tile.bitblt(consoleImage,0,0,tile.width,tile.height,consoleX,0);consoleX+=tile.width;}
  for(const[name,x,y,width,height]of [['minimap',0,160,420,352],['portrait',420,160,195,352],['info',615,160,409,352],['inventory',1024,160,165,352],['commands',1189,160,411,352],['top',0,0,1600,96]]){
    const crop=new PNG({width,height});consoleImage.bitblt(crop,x,y,width,height,0,0);const b=PNG.sync.write(crop),p=`ui/derived/${name}.png`;await fs.mkdir(path.dirname(path.join(destination,p)),{recursive:true});await fs.writeFile(path.join(destination,p),b);files[p]={origin:'derived-classic-console',bytes:b.length,sha256:hash(b)};
  }
  const w=Buffer.from(map.get('war3map.wpm').arrayBuffer());if(w.toString('ascii',0,4)!=='MP3W'||w.length!==16+w.readUInt32LE(8)*w.readUInt32LE(12))throw new Error('Invalid WPM');
  await fs.writeFile(path.join(root,'public/assets/imba/pathing.wpm'),w);
  const manifest={source:{file:path.basename(input),sha256:hash(bytes)},pathing:{width:w.readUInt32LE(8),height:w.readUInt32LE(12),sha256:hash(w)},files};
  await fs.mkdir(path.dirname(record),{recursive:true});await fs.writeFile(record,JSON.stringify(manifest,null,2));
  console.log(`Prepared ${Object.keys(files).length} original assets, ${Object.values(files).reduce((n,r)=>n+r.bytes,0)} bytes; source WPM preserved.`);
}
