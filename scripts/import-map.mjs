import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import MapParser from 'mdx-m3-viewer/dist/cjs/parsers/w3x/map.js';
import Archive from 'mdx-m3-viewer/dist/cjs/parsers/mpq/archive.js';
import TerrainParser from 'mdx-m3-viewer/dist/cjs/parsers/w3x/w3e/file.js';
import DoodadParser from 'mdx-m3-viewer/dist/cjs/parsers/w3x/doo/file.js';
import ObjectParser from 'mdx-m3-viewer/dist/cjs/parsers/w3x/w3u/file.js';
import DoodadObjectParser from 'mdx-m3-viewer/dist/cjs/parsers/w3x/w3d/file.js';
import {MappedData} from 'mdx-m3-viewer/dist/cjs/utils/mappeddata.js';
import Variations from 'mdx-m3-viewer/dist/cjs/viewer/handlers/w3x/variations.js';
import {parseMDX,decodeBLP,getBLPImageData} from 'war3-model';
import {PNG} from 'pngjs';
import {rampTopology} from './lib/ramps.mjs';
import {staticUnits} from './lib/jass-static.mjs';

const exec=promisify(execFile), project=path.resolve(import.meta.dirname,'..');
const supplied=process.argv[2];if(!supplied)throw new Error('Usage: npm run map:import -- /path/to/map.w3x');
const out=path.join(project,'public/assets/imba'),cache=path.join(project,'.local/classic-cache');
await fs.mkdir(out,{recursive:true});await fs.mkdir(cache,{recursive:true});
const source=await fs.readFile(supplied),map=new MapParser.default();map.load(new Uint8Array(source),true);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const normal=p=>{p=p.replaceAll('\\','/').toLowerCase();if(p.startsWith('/')||p.includes(':')||p.split('/').includes('..'))throw new Error('Unsafe asset path');return p;};
const embedded=p=>map.get(p.replaceAll('/','\\'));
const exists=async p=>{try{return await fs.readFile(p);}catch{return null;}};
const jobs=new Map(),manifest={},missing=[];
let tilesetArchive;
async function resource(input){
  const p=normal(input);if(jobs.has(p))return jobs.get(p);
  const promise=(async()=>{
    let data,origin;
    const local=embedded(p)??(p.endsWith('.mdx')?embedded(p.replace(/\.mdx$/,'.mdl')):null);
    if(local){data=Buffer.from(local.arrayBuffer());origin='map';}
    else if(tilesetArchive?.get(p.replaceAll('/','\\'))){data=Buffer.from(tilesetArchive.get(p.replaceAll('/','\\')).arrayBuffer());origin='classic-tileset:'+terrain.tileset.toLowerCase()+'.mpq';}
    else {
      data=await exists(path.join(cache,p))??await exists(path.join(project,'public/assets/original',p));
      origin='classic-reference';
      if(!data){
        const url='https://www.hiveworkshop.com/data/static_assets/mpq/tft/'+p;
        let last;
        for(let attempt=0;attempt<3;attempt++)try{const r=await exec('curl',['-fLsS','--connect-timeout','6','--max-time','22',url],{encoding:'buffer',maxBuffer:15*1024*1024});data=r.stdout;break;}catch(e){last=e;}
        if(!data)throw new Error(`Missing ${p}: ${String(last?.message).slice(0,180)}`);
        await fs.mkdir(path.dirname(path.join(cache,p)),{recursive:true});await fs.writeFile(path.join(cache,p),data);
      }
    }
    const magic=data.subarray(0,4).toString('latin1');
    if(p.endsWith('.mdx')&&magic!=='MDLX')throw new Error('Invalid MDX '+p);
    if(p.endsWith('.blp')&&magic!=='BLP1')throw new Error('Invalid classic BLP '+p);
    const dest=path.join(out,'resources',p);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,data);
    manifest[p]={origin,bytes:data.length,sha256:sha(data)};
    return data;
  })();jobs.set(p,promise);return promise;
}
async function batch(items,fn,concurrency=8){let cursor=0;await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<items.length){const item=items[cursor++];await fn(item);}}));}
async function table(p){
  if(!embedded(p)&&!await exists(path.join(cache,normal(p)))){
    const seed=await exists(path.join('/tmp/dota-native-research',normal(p)));if(seed){await fs.mkdir(path.dirname(path.join(cache,normal(p))),{recursive:true});await fs.writeFile(path.join(cache,normal(p)),seed);}
  }
  return new MappedData((await resource(p)).toString('utf8').replace(/\r\n?/g,'\n'));
}
console.log('Reading terrain, doodads and source object tables…');
const terrain=new TerrainParser.default();terrain.load(embedded('war3map.w3e').arrayBuffer());
tilesetArchive=new Archive.default();tilesetArchive.load(new Uint8Array(await resource(terrain.tileset.toLowerCase()+'.mpq')),true);
const doodads=new DoodadParser.default();doodads.load(embedded('war3map.doo').arrayBuffer(),126);
const [groundTable,cliffTable,waterTable,doodadTable,destTable,unitTable,doodadMeta,destMeta]=await Promise.all([
  'terrainart/terrain.slk','terrainart/clifftypes.slk','terrainart/water.slk','doodads/doodads.slk','units/destructabledata.slk','units/unitui.slk','doodads/doodadmetadata.slk','units/destructablemetadata.slk'
].map(table));
const splatTable=await table('splats/ubersplatdata.slk');
for(const [name,P,target,meta] of [['war3map.w3b',ObjectParser,destTable,destMeta],['war3map.w3d',DoodadObjectParser,doodadTable,doodadMeta]]){
  const file=embedded(name);if(!file)continue;const parser=new P.default();parser.load(file.arrayBuffer());
  for(const obj of [...parser.originalTable.objects,...parser.customTable.objects]){
    const id=obj.newId.replaceAll('\0','')||obj.oldId;
    if(!target.map[id])target.map[id]={map:{...target.getRow(obj.oldId)?.map}};
    for(const mod of obj.modifications){let field=meta.getRow(mod.id)?.map.field;if(!field)continue;
      if(field.toLowerCase().endsWith('vert'))continue;
      // Doodad vertex colors have one column per variation.
      if(['vertR','vertG','vertB'].includes(field))field+=String(mod.levelOrVariation).padStart(2,'0');
      target.map[id].map[field.toLowerCase()]=String(mod.value);
    }
  }
}
for(const race of ['human','orc','nightelf','undead','neutral','campaign']){const p=`units/${race}unitfunc.txt`;if(embedded(p))unitTable.load((await resource(p)).toString('utf8').replace(/\r\n?/g,'\n'));}
if(embedded('units/unitdata.slk'))unitTable.load((await resource('units/unitdata.slk')).toString('utf8'));
const tiles=terrain.groundTilesets.map(id=>{const row=groundTable.getRow(id).map;return {id,path:normal(row.dir+'/'+row.file+'.blp')};});
tiles.push({id:'blight',path:'terrainart/blight/felwood_blight.blp'});
const cliffs=terrain.cliffTilesets.map(id=>{const row=cliffTable.getRow(id).map;return {id,path:normal(row.texdir+'/'+row.texfile+'.blp'),modelDir:row.cliffmodeldir,ground:terrain.groundTilesets.indexOf(row.groundtile)};});
const water=waterTable.getRow(terrain.tileset+'Sha').map;
const waterPaths=Array.from({length:Number(water.numtex)},(_,i)=>normal(water.texfile+String(i).padStart(2,'0')+'.blp'));
const [width,height]=terrain.mapSize;
const corners=terrain.corners.flat().map(c=>[(c.groundHeight+c.layerHeight-2)*128,c.waterHeight*128,c.groundTexture,c.groundVariation,c.layerHeight,c.cliffTexture,c.cliffVariation,c.ramp?1:0,c.blight?1:0,c.water?1:0,c.groundHeight*128,c.boundary?1:0]);
const topology=rampTopology(corners,width,height),rampTiles=topology.entrances;
for(const i of topology.raised)corners[i][0]+=64;
const rampCells=new Set(),rampInstances=[];
// Only the sixteen native transition shapes with a rising ramp edge are valid.
await batch([...new Set(topology.candidates.map(c=>c.path))],resource);
for(const c of topology.candidates){
  if(c.cells.some(i=>rampCells.has(i)))continue;
  rampInstances.push(c);c.cells.forEach(i=>rampCells.add(i));
}
const cliffInstances=[],entrances=new Set(rampTiles);
for(let y=1;y<height-2;y++)for(let x=1;x<width-2;x++){
  if(rampCells.has(y*(width-1)+x)||entrances.has(y*(width-1)+x))continue;
  const cc=[terrain.corners[y][x],terrain.corners[y+1][x],terrain.corners[y+1][x+1],terrain.corners[y][x+1]];
  const base=Math.min(...cc.map(c=>c.layerHeight)),shape=cc.map(c=>String.fromCharCode(65+c.layerHeight-base)).join('');
  if(shape==='AAAA')continue;
  const type=cc[0].cliffTexture===15?1:cc[0].cliffTexture,def=cliffs[type],dir=def.modelDir;
  cliffInstances.push({x,y,base:(base-2)*128,type,path:normal(`doodads/terrain/${dir}/${dir}${shape}${Variations.default(dir,shape,cc[0].cliffVariation)}.mdx`)});
}
const placements=[],excluded=[];
for(const d of doodads.doodads){
  const row=doodadTable.map[d.id]?.map??destTable.map[d.id]?.map;
  if(!row){missing.push({id:d.id,reason:'unknown-object'});continue;}
  if(row.useclickhelper==='1'||d.flags===0){excluded.push({id:d.id,editorId:d.editorId,reason:row.useclickhelper==='1'?'editor-helper':'hidden-flag'});continue;}
  let file=row.file?.replace(/\.(mdl|mdx)$/i,'');
  if(!file||file==='_'){excluded.push({id:d.id,reason:'no-visual-model'});continue;}
  const variation=Number(row.numvar)>1&&!/\.(mdl|mdx)$/i.test(row.file)?Math.min(d.variation,Number(row.numvar)-1):'';
  let model=normal(file+variation+'.mdx');if(!embedded(model)&&embedded(file+'.mdx'))model=normal(file+'.mdx');
  const suffix=String(d.variation+1).padStart(2,'0');
  const color=['r','g','b'].map(c=>Number(row['color'+c]??row['vert'+c+suffix]??255)/255);
  const replacements={};if(Number(row.texid)>0&&row.texfile&&row.texfile!=='_')replacements[row.texid]=normal(row.texfile.replace(/\.blp$/i,'')+'.blp');
  placements.push({kind:'doodad',id:d.id,editorId:d.editorId,model,position:[...d.location],angle:d.angle,scale:[...d.scale],color,team:0,replacements,sequence:d.life===0?'Death':'Stand',flags:d.flags});
}
const script=Buffer.from(embedded('war3map.j').arrayBuffer()).toString('utf8'),initial=staticUnits(script);
for(const u of initial.units){
  const row=unitTable.map[u.id]?.map;
  if(!row?.file||row.file==='_'){excluded.push({id:u.id,sourceLine:u.sourceLine,reason:'no-unit-model'});continue;}
  const file=row.file.split(',')[0].replace(/\.(mdl|mdx)$/i,'')+'.mdx';
  const declaredTeam=Number(row.teamcolor),team=declaredTeam>=0?declaredTeam:u.team;
  const splat=splatTable.map[row.ubersplat]?.map;
  placements.push({...u,kind:'unit',model:normal(file),scale:u.scale.map(s=>s*Number(row.modelscale??1)),color:u.color.map((v,i)=>v*Number(row[['red','green','blue'][i]]??255)/255),team:Math.min(team,12),replacements:{},sequence:row.animprops?'Stand '+row.animprops.replaceAll(',',' '):'Stand',moveHeight:Number(row.moveheight??0),splat:splat?.file?{path:normal(splat.dir+'/'+splat.file+'.blp'),scale:Number(splat.scale)}:undefined});
}
const dnc=script.match(/SetDayNightModels\(\s*"([^"]+)"\s*,\s*"([^"]+)"/);
if(!dnc)throw new Error('Source map does not declare day/night models');
const lighting={terrain:normal(dnc[1].replaceAll('\\\\','/').replace(/\.mdl$/i,'.mdx')),unit:normal(dnc[2].replaceAll('\\\\','/').replace(/\.mdl$/i,'.mdx')),initialHour:Number(script.match(/SetFloatGameState\(GAME_STATE_TIME_OF_DAY,\s*([\d.]+)/)?.[1]??6),timeScale:Number(script.match(/SetTimeOfDayScale\(\s*([\d.]+)/)?.[1]??1)};
console.log(`Source: ${width-1} × ${height-1} tiles, ${doodads.doodads.length} doodads, ${initial.units.length} static units, ${cliffInstances.length} cliff tiles.`);
await batch([...new Set([...tiles.map(t=>t.path),...cliffs.map(t=>t.path),...waterPaths,'war3mapMap.blp','replaceabletextures/shadows/shadow.blp'])],async p=>{await resource(p);});
const models=[...new Set([...placements.map(p=>p.model),...cliffInstances.map(c=>c.path),...rampInstances.map(c=>c.path),lighting.terrain,lighting.unit])],modelInfo={};let done=0;
await batch(models,async p=>{
  try{
    const data=await resource(p),m=parseMDX(new Uint8Array(data).buffer);
    if(m.Version!==800)throw new Error(`Unsupported MDX version ${m.Version}`);
    modelInfo[p]={textures:m.Textures.map(t=>({path:t.Image?normal(t.Image):'',replaceable:t.ReplaceableId,flags:t.Flags})),sequences:m.Sequences.map(s=>s.Name),particles:m.ParticleEmitters2.length,textureAnimations:m.TextureAnims.length};
  }catch(e){missing.push({path:p,reason:String(e.message)});}
  done++;if(done%25===0)console.log(`Models ${done}/${models.length}`);
});
const replaceable={1:'teamcolor/teamcolor00',2:'teamglow/teamglow00',31:'lordaerontree/lordaeronsummertree',32:'ashenvaletree/ashentree',33:'barrenstree/barrenstree',34:'northrendtree/northtree',35:'outlandmushrooms/mushroomtree',36:'ruinstree/ruinstree',37:'undergroundtree/undergroundtree'};
const deps=new Set();
for(const p of placements)if(p.splat)deps.add(p.splat.path);
for(const p of placements){const model=modelInfo[p.model];if(!model)continue;
  for(const t of model.textures){let file=t.path;if(!file){if(p.replacements[t.replaceable])file=p.replacements[t.replaceable];else if(t.replaceable===1||t.replaceable===2)file=`replaceabletextures/${t.replaceable===1?'teamcolor/teamcolor':'teamglow/teamglow'}${String(p.team).padStart(2,'0')}.blp`;else if(replaceable[t.replaceable])file='replaceabletextures/'+replaceable[t.replaceable]+'.blp';}
    if(file)deps.add(file);else missing.push({path:p.model,reason:`unmapped ReplaceableId ${t.replaceable}`});
  }
}
done=0;await batch([...deps],async p=>{try{await resource(p);}catch(e){missing.push({path:p,reason:e.message});}done++;if(done%40===0)console.log(`Textures ${done}/${deps.size}`);});
for(const tile of tiles){const blp=decodeBLP(new Uint8Array(await resource(tile.path)).buffer);tile.width=blp.width;tile.height=blp.height;}
const mini=getBLPImageData(decodeBLP(new Uint8Array(await resource('war3mapMap.blp')).buffer),0);
await fs.writeFile(path.join(out,'minimap.png'),PNG.sync.write({width:mini.width,height:mini.height,data:Buffer.from(mini.data)}));
const report={source:{name:map.name.replace(/\|c[\da-f]{8}|\|r/gi,''),file:path.basename(supplied),bytes:source.length,sha256:sha(source)},width,height,offset:[...terrain.centerOffset],tiles,cliffs,water:{paths:waterPaths,height:Number(water.height)*128,rate:Number(water.texrate),parameters:water,baseColor:[0,0,1,1]},corners,cliffInstances,rampTiles,rampInstances,rampCells:[...rampCells],raisedRampCorners:topology.raised,lighting,placements,modelInfo,resources:Object.keys(manifest),stats:{sourceDoodads:doodads.doodads.length,visibleDoodads:placements.filter(p=>p.kind==='doodad').length,units:placements.filter(p=>p.kind==='unit').length,cliffs:cliffInstances.length,ramps:rampTiles.length,rampTransitions:rampInstances.length},excluded,missing,script:{created:initial.created,removed:initial.removed,unresolved:initial.unresolved}};
if(embedded('war3map.shd')){await resource('war3map.shd');report.shadow={path:'war3map.shd',width:(width-1)*4,height:(height-1)*4};report.resources=Object.keys(manifest);}
await fs.writeFile(path.join(out,'map.json'),JSON.stringify(report));
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({source:report.source,files:manifest},null,2));
await fs.mkdir(path.join(project,'artifacts/imba'),{recursive:true});
await fs.writeFile(path.join(project,'artifacts/imba/import-report.json'),JSON.stringify({...report,corners:undefined,placements:undefined,modelInfo:undefined,resources:undefined,cliffInstances:undefined,rampTiles:undefined,tiles:report.tiles},null,2));
await fs.writeFile(path.join(project,'artifacts/imba/asset-manifest.json'),JSON.stringify({source:report.source,files:manifest},null,2));
console.log(JSON.stringify({stats:report.stats,assets:Object.keys(manifest).length,bytes:Object.values(manifest).reduce((n,a)=>n+a.bytes,0),missing,scriptUnresolved:initial.unresolved.length},null,2));
