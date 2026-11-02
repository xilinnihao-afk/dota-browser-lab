import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parseMDX,decodeBLP,getBLPImageData} from 'war3-model';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';

const root=path.resolve(import.meta.dirname,'../public/assets/imba');
const map=JSON.parse(await fs.readFile(path.join(root,'map.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const pinned=JSON.parse(await fs.readFile(path.resolve(import.meta.dirname,'../artifacts/imba/asset-manifest.json'),'utf8'));
assert.deepEqual(manifest,pinned,'Generated files must match recorded asset manifest');
assert.equal(map.source.sha256,manifest.source.sha256);
assert.equal(map.corners.length,map.width*map.height);
assert.equal(map.stats.visibleDoodads+map.excluded.filter(p=>p.editorId!==undefined).length,map.stats.sourceDoodads);
const models=new Map();let textures=0,total=0;
for(const [name,entry] of Object.entries(manifest.files)){
  const data=await fs.readFile(path.join(root,'resources',name));total+=data.length;
  assert.equal(data.length,entry.bytes,name+' byte count');assert.equal(crypto.createHash('sha256').update(data).digest('hex'),entry.sha256,name+' hash');
  const array=new Uint8Array(data).buffer;
  if(name.endsWith('.mdx')){const m=parseMDX(array);assert.equal(m.Version,800);models.set(name,m);for(const g of m.Geosets){assert.equal(g.Vertices.length%3,0);for(const i of g.Faces)assert.ok(i<g.Vertices.length/3,name+' index');}}
  if(name.endsWith('.blp')){const image=getBLPImageData(decodeBLP(array),0);assert.ok(image.width>0&&image.height>0);textures++;}
  if(name.endsWith('.tga')){const t=new TGALoader().parse(array);assert.ok(t.width>0&&t.height>0);textures++;}
}
const normalized=p=>p.replaceAll('\\','/').toLowerCase();
const defaults={31:'lordaerontree/lordaeronsummertree',32:'ashenvaletree/ashentree',33:'barrenstree/barrenstree',34:'northrendtree/northtree',35:'outlandmushrooms/mushroomtree',36:'ruinstree/ruinstree',37:'undergroundtree/undergroundtree'};
for(const p of map.placements){
  assert.ok([...p.position,...p.scale,p.angle,...p.color].every(Number.isFinite),p.id+' transform');
  assert.ok(models.has(p.model),p.model+' installed');
  for(const t of models.get(p.model).Textures){
    let resource=t.Image?normalized(t.Image):p.replacements[t.ReplaceableId];
    if(!resource&&(t.ReplaceableId===1||t.ReplaceableId===2))resource=`replaceabletextures/${t.ReplaceableId===1?'teamcolor/teamcolor':'teamglow/teamglow'}${String(p.team).padStart(2,'0')}.blp`;
    if(!resource&&defaults[t.ReplaceableId])resource='replaceabletextures/'+defaults[t.ReplaceableId]+'.blp';
    assert.ok(manifest.files[resource],p.id+' texture closure: '+resource);
  }
  if(p.splat)assert.ok(manifest.files[p.splat.path]);
}
for(const p of [map.lighting.terrain,map.lighting.unit])assert.ok(models.has(p),p);
assert.equal(new Set(map.rampCells).size,map.rampInstances.length*2);
for(const c of [...map.cliffInstances,...map.rampInstances])assert.ok(models.has(c.path));
assert.equal(map.missing.length,0,JSON.stringify(map.missing));
console.log(`Verified ${Object.keys(manifest.files).length} assets (${total} bytes), ${models.size} MDX, ${textures} textures; ${map.stats.visibleDoodads}/${map.stats.sourceDoodads} visible doodads, ${map.stats.units} static units, ${map.stats.cliffs} cliffs. ${map.excluded.length} source records intentionally excluded.`);
