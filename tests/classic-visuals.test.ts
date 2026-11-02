import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {parseMDX,type model} from 'war3-model';
import {NativeParticles,particleEnvelope,particleCell} from '../src/classic/particles';
import {textureAnimationMatrix} from '../src/classic/texture-animation';
import {NativeModel} from '../src/classic/native-model';
import {sampleDayNight} from '../src/classic/map-lighting';
import {bakeWorld,disposeBaked,ParticleBatches} from '../src/classic/batching';
import type {AnimationClock} from '../src/classic/animation';
// @ts-expect-error Offline build-time ESM format helper.
import {rampTopology} from '../scripts/lib/ramps.mjs';
const key=(Frame:number,Vector:number[])=>({Frame,Vector:new Float32Array(Vector)});
const clock:AnimationClock={frame:0,interval:[0,10000],elapsed:0,globalSequences:[]};
function emitter(extra:Partial<model.ParticleEmitter2>={}):model.ParticleEmitter2{return {Name:'test',ObjectId:0,Flags:32768,PivotPoint:new Float32Array([1,2,3]),FrameFlags:1,LifeSpan:1,EmissionRate:30,Speed:10,Gravity:20,Width:4,Length:4,Latitude:12,Variation:.2,Time:.5,ParticleScaling:new Float32Array([2,4,0]),SegmentColor:[new Float32Array([1,0,0]),new Float32Array([0,1,0]),new Float32Array([0,0,1])],Alpha:new Uint8Array([0,255,0]),...extra};}
function advance(p:NativeParticles,seconds:number,step=1/60,root=new THREE.Group()){
  root.updateMatrixWorld();for(let t=step;t<seconds+1e-8;t+=step)p.update(step,{...clock,frame:t*1000,elapsed:t*1000},new THREE.Matrix4(),root);
}
test('PRE2 fixed steps produce the same pooled particles at 30 and 60 Hz, reset is deterministic',()=>{
  const a=new NativeParticles(emitter(),[],42),b=new NativeParticles(emitter(),[],42);advance(a,2,1/30);advance(b,2);
  const state=(p:NativeParticles)=>p.particles.map(v=>[v.age,...v.position.toArray(),...v.velocity.toArray()]);
  assert.deepEqual(state(a),state(b));assert.equal(a.particles.length,30);assert.equal(a.dropped,0);
  const snapshot=state(a);a.reset();advance(a,2,1/30);assert.deepEqual(state(a),snapshot);
  a.update(0,{...clock,frame:2000,elapsed:2000},new THREE.Matrix4(),new THREE.Group());assert.deepEqual(state(a),snapshot,'pause must not emit or advance');a.dispose();b.dispose();
});
test('native world particles remain in world space; ModelSpace particles follow their emitter',()=>{
  const a=new NativeParticles(emitter({Width:0,Length:0,Speed:0,Gravity:0}),[]),root=new THREE.Group();root.position.set(100,200,300);advance(a,.1,1/60,root);
  assert.deepEqual(a.particles[0].position.toArray(),[101,202,303]);root.position.x=200;root.updateMatrixWorld();a.update(0,clock,new THREE.Matrix4(),root);
  assert.equal(a.particles[0].position.x,101);
  const b=new NativeParticles(emitter({Flags:32768|524288,Width:0,Length:0,Speed:0,Gravity:0}),[]);advance(b,.1,1/60,root);assert.deepEqual(b.particles[0].position.toArray(),[1,2,3]);
  a.dispose();b.dispose();
});
test('PRE2 source segment split, alpha, scale and texture-sheet interval boundaries',()=>{
  const e=emitter(),middle=particleEnvelope(e,.5);assert.equal(middle.scale,4);assert.deepEqual(middle.color,[0,1,0,1]);
  assert.deepEqual(particleEnvelope(e,1).color,[0,0,1,0]);assert.equal(particleCell([2,6,2],.625,8),3);assert.equal(particleCell([7,7,1],.5,4),3);
});
test('invisible emitters stop emission while existing particles expire; head+tail share particle life',()=>{
  const source=emitter({FrameFlags:3,Visibility:{LineType:0,Keys:[key(0,[1]),key(500,[0])]}}),p=new NativeParticles(source,[]);advance(p,.4);assert.equal(p.mesh.geometry.drawRange.count,p.particles.length*12);advance(p,2);assert.equal(p.particles.length,0);p.dispose();
});
test('squirt emission is triggered by keys, not every render frame',()=>{
  const p=new NativeParticles(emitter({Squirt:true,LifeSpan:2,EmissionRate:{LineType:0,Keys:[key(0,[5]),key(500,[7])]}}),[]);advance(p,1);assert.equal(p.particles.length,12);p.dispose();
});
test('UV transforms use original origin and keep cached texture matrices untouched',()=>{
  const texture=new THREE.Texture(),before=texture.matrix.clone();const a={Translation:{LineType:1,Keys:[key(0,[0,0,0]),key(1000,[1,2,0])]},Scaling:{LineType:0,Keys:[key(0,[2,3,1])]} } as model.TVertexAnim;
  const matrix=textureAnimationMatrix(a,{...clock,frame:500});const point=new THREE.Vector3(.25,.5,1).applyMatrix3(matrix);assert.deepEqual(point.toArray(),[1,2.5,1]);assert.ok(texture.matrix.equals(before));texture.dispose();
});
test('baked distant batches preserve every face, transform, instance color and source texture',()=>{
  const root=new THREE.Group(),geometry=new THREE.PlaneGeometry(2,2),material=new THREE.MeshLambertMaterial({map:new THREE.Texture()});const mesh=new THREE.InstancedMesh(geometry,material,2);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(10,20,30));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(40,50,60));mesh.setColorAt(0,new THREE.Color(1,0,0));mesh.setColorAt(1,new THREE.Color(0,1,0));root.add(mesh);
  const far=bakeWorld(root),baked=far.children[0]as THREE.Mesh;assert.equal(far.children.length,1);assert.equal(baked.geometry.index!.count,12);assert.equal(baked.geometry.getAttribute('position').getX(0),9);assert.equal(baked.geometry.getAttribute('position').getZ(4),60);assert.equal(baked.geometry.getAttribute('color').getY(4),1);assert.equal((baked.material as THREE.MeshLambertMaterial).map,material.map);
  disposeBaked(far);geometry.dispose();material.map!.dispose();material.dispose();mesh.dispose();
});
test('particle batching preserves active quads, and empties when source effects disappear',()=>{
  const p=new NativeParticles(emitter(),[]);advance(p,.2);const batch=new ParticleBatches();batch.update([p.mesh]);assert.equal((batch.root.children[0]as THREE.Mesh).geometry.drawRange.count,p.mesh.geometry.drawRange.count);batch.update([]);assert.equal(batch.root.children[0].visible,false);batch.dispose();p.dispose();
});
test('ramp entrance raises low corners once and identifies a two-cell native transition',()=>{
  const width=4,height=3,corners=Array.from({length:width*height},(_,i)=>{const x=i%width,y=Math.floor(i/width),level=y===2?3:2;return[(level-2)*128,0,0,0,level,0,0,x>0?1:0,0,0,0,0];});
  const result=rampTopology(corners,width,height);assert.equal(new Set(result.raised).size,result.raised.length);assert.ok(result.candidates.some((c:{path:string})=>c.path.endsWith('clifftransabhl0.mdx')));assert.equal(result.entrances.length,2);
});
const mapPath=new URL('../public/assets/imba/map.json',import.meta.url),available=existsSync(mapPath);
function original(path:string){const b=readFileSync(new URL('../public/assets/imba/resources/'+path,import.meta.url));return parseMDX(new Uint8Array(b).buffer);}
test('all real native ramp endpoints match the corrected W3E surface; no duplicate coverage',{skip:!available},()=>{
  const map=JSON.parse(readFileSync(mapPath,'utf8'));const covered:number[]=[];for(const c of map.rampInstances){covered.push(...c.cells);const mdx=original(c.path);
    for(const [dx,dy]of [[0,0],[0,c.sy],[c.sx,c.sy],[c.sx,0]]){const zs:number[]=[];for(const g of mdx.Geosets)for(let i=0;i<g.Vertices.length;i+=3)if(Math.abs(g.Vertices[i]-(dx-c.sx)*128)<.1&&Math.abs(g.Vertices[i+1]-dy*128)<.1)zs.push(g.Vertices[i+2]);const corner=map.corners[(c.y+dy)*map.width+c.x+dx];assert.ok(Math.abs(Math.max(...zs)-(corner[0]-corner[10]-c.base))<.1,c.path+' endpoint');}
  }assert.equal(new Set(covered).size,covered.length);assert.ok(map.rampInstances.length>0);
});
test('source DNC has distinct day/night and terrain/unit ambient, finite native direction',{skip:!available},()=>{
  const map=JSON.parse(readFileSync(mapPath,'utf8')),terrain=original(map.lighting.terrain),unit=original(map.lighting.unit);const day=sampleDayNight(terrain,12),night=sampleDayNight(terrain,0);assert.notDeepEqual(day.ambient.toArray(),night.ambient.toArray());assert.ok(sampleDayNight(unit,12).ambient.r>day.ambient.r);assert.ok(Math.abs(day.direction.length()-1)<1e-6);assert.ok(day.direction.z>0);
});
test('original waterfall changes UV phase, emits PRE2, and sequence reset clears particles',{skip:!available},()=>{
  const source=original('war3mapimported/waterfall_blue.mdx'),textures=source.Textures.map(()=>new THREE.Texture()),actor=NativeModel.fromParsed(source,textures),camera=new THREE.PerspectiveCamera();camera.position.set(0,-1000,1000);camera.lookAt(0,0,0);camera.updateMatrixWorld();actor.prewarm(2,camera,42);assert.ok(actor.particles.some(p=>p.particles.length>0));
  const layer=actor.surfaces.flatMap(s=>s.layers).find(l=>l.uvMatrix)!;const matrix=layer.uvMatrix!.clone();actor.update(.25,camera);assert.ok(!matrix.equals(layer.uvMatrix!));assert.ok(textures.every(t=>t.matrix.equals(new THREE.Matrix3())));actor.setSequence('Stand');assert.ok(actor.particles.every(p=>!p.particles.length));actor.dispose();textures.forEach(t=>t.dispose());
});
test('matrix-group skinning keeps all five equal-weight bones and the original vertex offset',()=>{
  const source={Info:{Name:'five-bone group'},GlobalSequences:[],Sequences:[],Textures:[],TextureAnims:[],GeosetAnims:[],RibbonEmitters:[],ParticleEmitters2:[],
    Nodes:Array.from({length:5},(_,i)=>({Name:'bone'+i,ObjectId:i,Flags:0,PivotPoint:new Float32Array(3),Translation:{LineType:0,Keys:[key(0,[i+1,0,0])]}})),
    Materials:[{Layers:[{TextureID:0,Alpha:1,FilterMode:0}]}],Geosets:[{Vertices:new Float32Array([1,2,3,1,3,3,2,2,3]),Normals:new Float32Array([0,0,1,0,0,1,0,0,1]),TVertices:[new Float32Array(6)],Faces:new Uint16Array([0,1,2]),Groups:[[0,1,2,3,4]],VertexGroup:new Uint8Array(3),MaterialID:0}]} as unknown as model.Model;
  const texture=new THREE.Texture(),actor=NativeModel.fromParsed(source,[texture]);actor.update(0);const positions=actor.surfaces[0].geometry.getAttribute('position');assert.equal(positions.getX(0),4);assert.equal(positions.getY(0),2);assert.equal(positions.getZ(0),3);actor.dispose();texture.dispose();
});
test('cached constant child still follows an animated parent and sequence changes invalidate local transforms',()=>{
  const source={Info:{Name:'parent animation'},GlobalSequences:[],Textures:[],TextureAnims:[],GeosetAnims:[],RibbonEmitters:[],ParticleEmitters2:[],
    Sequences:[{Name:'Stand',Interval:new Uint32Array([0,1000])},{Name:'Other',Interval:new Uint32Array([2000,3000])}],
    Nodes:[{Name:'parent',ObjectId:0,Flags:0,PivotPoint:new Float32Array(3),Translation:{LineType:1,Keys:[key(0,[0,0,0]),key(1000,[10,0,0]),key(2000,[40,0,0])]}},{Name:'child',ObjectId:1,Parent:0,Flags:0,PivotPoint:new Float32Array(3),Translation:{LineType:0,Keys:[key(0,[0,2,0]),key(2000,[0,8,0])]}}],
    Materials:[{Layers:[{TextureID:0,Alpha:1,FilterMode:0}]}],Geosets:[{Vertices:new Float32Array([1,2,3,1,3,3,2,2,3]),Normals:new Float32Array([0,0,1,0,0,1,0,0,1]),TVertices:[new Float32Array(6)],Faces:new Uint16Array([0,1,2]),Groups:[[1]],VertexGroup:new Uint8Array(3),MaterialID:0}]} as unknown as model.Model;
  const texture=new THREE.Texture(),actor=NativeModel.fromParsed(source,[texture]);actor.seek(.5);const p=actor.surfaces[0].geometry.getAttribute('position');assert.equal(p.getX(0),6);assert.equal(p.getY(0),4);actor.setSequence('Other');actor.update(0);assert.equal(p.getX(0),41);assert.equal(p.getY(0),10);actor.dispose();texture.dispose();
});
test('paused PRE2 buffers stay unchanged, but camera rotation rebuilds billboard vertices',()=>{
  const p=new NativeParticles(emitter(),[]),root=new THREE.Group(),camera=new THREE.PerspectiveCamera();camera.position.set(0,-100,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();advance(p,.2);p.update(0,clock,new THREE.Matrix4(),root,camera);const attribute=p.mesh.geometry.getAttribute('position')as THREE.BufferAttribute,version=attribute.version;p.update(0,clock,new THREE.Matrix4(),root,camera);assert.equal(attribute.version,version);camera.position.set(100,0,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();p.update(0,clock,new THREE.Matrix4(),root,camera);assert.ok(attribute.version>version);p.dispose();
});
test('GPU group texture produces the same original mesh positions as CPU skinning across poses',{skip:!available},()=>{
  const source=original('buildings/nightelf/ancientprotector/ancientprotector.mdx'),textures=source.Textures.map(()=>new THREE.Texture()),cpu=NativeModel.fromParsed(source,textures),gpu=NativeModel.fromParsed(source,textures);gpu.enableGpuSkinning();
  for(const phase of [.1,.5,.9]){cpu.seek(phase);gpu.seek(phase);for(let s=0;s<cpu.surfaces.length;s++){
    if(!cpu.surfaces[s].layers.some(l=>l.mesh.visible))continue;
    const reference=cpu.surfaces[s].geometry.getAttribute('position'),surface=gpu.surfaces[s],data=gpu.boneTexture!.image.data as Float32Array,indices=surface.geometry.getAttribute('nativeGroup'),positions=surface.geometry.getAttribute('position');
    for(let i=0;i<reference.count;i++){const lookup=surface.groupTexture!.image,lookupData=lookup.data as Float32Array,transform=new THREE.Matrix4();transform.elements.fill(0);let members=0;
      for(let slot=0;slot<lookup.width*4;slot++){const index=lookupData[indices.getX(i)*lookup.width*4+slot];if(index<0)break;members++;for(let k=0;k<16;k++)transform.elements[k]+=data[index*16+k];}transform.elements.forEach((_,k)=>transform.elements[k]/=members);
      const actual=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(transform),expected=new THREE.Vector3().fromBufferAttribute(reference,i);assert.ok(actual.distanceTo(expected)<.002,`surface ${s}, vertex ${i}, phase ${phase}`);}
  }}cpu.dispose();gpu.dispose();textures.forEach(t=>t.dispose());
});
test('shared track samples keep placements, billboards and independently sought clocks isolated',{skip:!available},()=>{
  const source=original('buildings/nightelf/ancientprotector/ancientprotector.mdx'),isolatedSource=original('buildings/nightelf/ancientprotector/ancientprotector.mdx');
  const textures=source.Textures.map(()=>new THREE.Texture()),first=NativeModel.fromParsed(source,textures),second=NativeModel.fromParsed(source,textures),reference=NativeModel.fromParsed(isolatedSource,textures);
  const camera=new THREE.PerspectiveCamera();camera.up.set(0,0,1);camera.position.set(300,-700,500);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  second.root.position.set(100,50,0);second.root.rotation.z=Math.PI/4;reference.root.position.copy(second.root.position);reference.root.rotation.copy(second.root.rotation);
  first.seek(.2);first.update(0,camera);second.seek(.2);second.update(0,camera);reference.seek(.2);reference.update(0,camera);
  assert.ok(second.poseCacheHits>0);
  const compare=()=>{for(const [id,matrix]of second.matrices){const expected=reference.matrices.get(id)!;assert.ok(matrix.elements.every((v,i)=>Math.abs(v-expected.elements[i])<1e-6),`node ${id}`);}};
  compare();const before=second.matrices.get(0)!.clone();first.seek(.8);first.update(0,camera);assert.ok(second.matrices.get(0)!.equals(before));second.update(.1,camera);reference.update(.1,camera);compare();
  first.dispose();second.dispose();reference.dispose();textures.forEach(t=>t.dispose());
});
