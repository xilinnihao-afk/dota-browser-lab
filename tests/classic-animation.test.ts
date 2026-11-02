import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Quaternion,Texture,Vector3} from 'three';
import {parseMDX,type model} from 'war3-model';
import {nodeMatrix,sampleTrack,type AnimationClock} from '../src/classic/animation.ts';
import {NativeModel} from '../src/classic/native-model.ts';

const clock:AnimationClock={frame:150,interval:[100,200],elapsed:0,globalSequences:[]};
const key=(Frame:number,values:number[])=>({Frame,Vector:new Float32Array(values)});

test('MDX tracks do not borrow keys from other clips; missing tracks use the property default',()=>{
  const track:model.AnimVector={LineType:1,Keys:[key(0,[0]),key(50,[.2]),key(250,[.8])]};
  assert.deepEqual(sampleTrack(track,clock,[1]),[1]);
  track.Keys.push(key(300,[.9]));
  assert.deepEqual(sampleTrack(track,{...clock,frame:250,interval:[200,300]},[0]),[Math.fround(.8)]);
});

test('global sequence zero uses global elapsed time, independently from the active clip',()=>{
  const track:model.AnimVector={GlobalSeqId:0,LineType:1,Keys:[key(0,[0]),key(1000,[10])]};
  assert.deepEqual(sampleTrack(track,{...clock,elapsed:1250,globalSequences:[1000]},[99]),[2.5]);
});

test('node rotation keeps its absolute pivot fixed and transforms geometry around it',()=>{
  const q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);
  const node:model.Node={Name:'pivot',ObjectId:0,Flags:256,PivotPoint:new Float32Array([10,20,30]),Rotation:{LineType:1,Keys:[key(100,q.toArray())]}};
  const transform=nodeMatrix(node,clock);
  assert.ok(new Vector3(10,20,30).applyMatrix4(transform).distanceTo(new Vector3(10,20,30))<1e-5);
  assert.ok(new Vector3(12,20,30).applyMatrix4(transform).distanceTo(new Vector3(10,22,30))<1e-5);
});

test('quaternion interpolation remains normalized and takes the shortest arc',()=>{
  const a=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI*.9);
  const b=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI*.9);
  const values=sampleTrack({LineType:1,Keys:[key(100,a.toArray()),key(200,b.toArray())]},clock,[0,0,0,1],true);
  const q=new Quaternion().fromArray(values);
  assert.ok(Math.abs(q.length()-1)<1e-6);
  assert.ok(new Vector3(1,0,0).applyQuaternion(q).distanceTo(new Vector3(-1,0,0))<1e-6);
});

const nativeFile=new URL('../public/assets/original/units/orc/heroblademaster/heroblademaster.mdx',import.meta.url);
test('real classic Blademaster animates without drift, supports seeking, and clamps Death', {skip:!existsSync(nativeFile)},()=>{
  const bytes=readFileSync(nativeFile),source=parseMDX(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const textures=source.Textures.map(()=>new Texture());
  const actor=NativeModel.fromParsed(source,textures);
  const surface=actor.surfaces.find(s=>s.source.Vertices.length/3>300)!;
  actor.setSequence('Walk');actor.seek(.25);
  const first=Array.from(surface.geometry.getAttribute('position').array);
  actor.seek(.75);const second=Array.from(surface.geometry.getAttribute('position').array);
  assert.ok(first.every(Number.isFinite)&&second.every(Number.isFinite));
  assert.ok(first.some((v,i)=>Math.abs(v-second[i])>10),'walk must move the original mesh');
  actor.seek(.25);assert.deepEqual(Array.from(surface.geometry.getAttribute('position').array),first,'seeking is repeatable and cannot accumulate skin deformation');
  actor.setSequence('Death');actor.update(20);const finalFrame=actor.frame;actor.update(20);
  assert.equal(finalFrame,actor.sequence.Interval[1]);assert.equal(actor.frame,finalFrame);
  actor.dispose();textures.forEach(texture=>texture.dispose());
});
