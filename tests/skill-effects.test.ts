import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {HEROES,type HeroId,type SkillSlot} from '../src/classic/battle/definitions';
import {BattleSimulation,type NavigationPort} from '../src/classic/battle/simulation';
import {SkillEffects,PRESENTED_SKILLS,controlLabel} from '../src/classic/battle/skill-effects';

const flat:NavigationPort={nearest:p=>({...p}),findPath:(_,p)=>[{...p}],isFree:()=>true,lineFree:()=>true};
function arena(id:HeroId='earthshaker'){
  const sim=new BattleSimulation(flat);sim.start(id,'axe');const h=sim.hero,v=sim.unit('rival')!;
  Object.assign(h,{x:0,y:0,level:3,hp:5000,maxHp:5000,mana:2000,maxMana:2000,order:'hold'});
  Object.assign(v,{id:'enemy',x:150,y:0,hp:5000,maxHp:5000,damage:0,speed:0,order:'hold'});
  sim.units=[h,v];sim.nextWave=Infinity;sim.drainEvents();
  const scene=new THREE.Group(),fx=new SkillEffects(scene,(x,y)=>x*.03+y*.01);
  const paint=()=>{for(const e of sim.drainEvents())fx.event(e);fx.update(sim);};
  return {sim,h,v,fx,scene,paint};
}

test('all 36 real skills produce visible skill-specific geometry without changing combat state',()=>{
  const definitions=Object.values(HEROES).flatMap(h=>Object.values(h.skills).map(s=>s.id));
  assert.deepEqual([...PRESENTED_SKILLS].sort(),definitions.sort());
  for(const id of Object.keys(HEROES)as HeroId[])for(const slot of ['q','w','r']as SkillSlot[]){
    const a=arena(id),skill=HEROES[id].skills[slot],target=skill.target==='enemy'?a.v.id:skill.target==='point'?{x:a.v.x,y:a.v.y}:undefined;
    assert.ok(a.sim.cast(slot,target),id+'/'+slot);a.sim.step();
    const before=a.sim.units.map(u=>[u.x,u.y,u.hp,u.mana]);a.paint();
    assert.ok(a.fx.diagnostics.bySkill[skill.id]>0,skill.id+' must receive its own visual event');
    assert.ok(a.fx.diagnostics.instances>0,skill.id+' must have rendered instances');
    assert.deepEqual(a.sim.units.map(u=>[u.x,u.y,u.hp,u.mana]),before,'presentation cannot apply gameplay');
    assert.ok(a.fx.diagnostics.drawCalls<=8);assert.equal(a.fx.diagnostics.dropped,0);
    for(const mesh of a.fx.root.children as THREE.InstancedMesh[])for(const value of mesh.instanceMatrix.array.slice(0,mesh.count*16))assert.ok(Number.isFinite(value));
    a.fx.dispose();assert.equal(a.scene.children.length,0);
  }
});

test('fissure rises along its cast heading on terrain; echoes expand, pause and expire deterministically',()=>{
  const a=arena();assert.ok(a.sim.cast('q',{x:850,y:0}));a.sim.time=.3;a.paint();
  const rocks=a.fx.root.getObjectByName('skill-rock')as THREE.InstancedMesh;
  assert.ok(rocks.count>=15);const matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(let i=0;i<rocks.count;i++){rocks.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);assert.ok(point.x>=0&&point.x<=HEROES.earthshaker.skills.q.range);assert.ok(Math.abs(point.y)<HEROES.earthshaker.skills.q.radius);assert.ok(point.z>=point.x*.03+point.y*.01);}
  const frozen=Array.from(rocks.instanceMatrix.array);a.fx.update(a.sim);assert.deepEqual(Array.from(rocks.instanceMatrix.array),frozen);
  a.sim.time=3;a.fx.update(a.sim);assert.equal(a.fx.diagnostics.instances,0);
  assert.ok(a.sim.cast('r'));a.paint();assert.ok(a.v.stunUntil>a.sim.time);assert.equal(a.fx.diagnostics.controlMarkers,1);
  a.sim.time+=1.3;a.fx.update(a.sim);assert.equal(a.fx.diagnostics.controlMarkers,0);assert.equal(a.fx.diagnostics.transients,0);a.fx.dispose();
});

test('stun markers follow victims and end immediately on death or expiry, with correct Chinese labels',()=>{
  const a=arena();a.v.stunUntil=2;a.fx.update(a.sim);assert.equal(controlLabel(a.v,0),'眩晕');assert.equal(a.fx.diagnostics.controlMarkers,1);
  const stars=a.fx.root.getObjectByName('skill-star')as THREE.InstancedMesh,before=new THREE.Matrix4(),after=new THREE.Matrix4();stars.getMatrixAt(0,before);
  a.v.x+=200;a.fx.update(a.sim);stars.getMatrixAt(0,after);assert.ok(Math.abs(after.elements[12]-before.elements[12]-200)<.001);
  a.v.hp=0;a.fx.update(a.sim);assert.equal(a.fx.diagnostics.controlMarkers,0);assert.equal(stars.count,0);assert.equal(controlLabel(a.v,0),'');
  a.v.hp=100;a.v.rootUntil=3;assert.equal(controlLabel(a.v,0,true),'妖术');a.sim.time=4;a.fx.update(a.sim);assert.equal(a.fx.diagnostics.instances,0);a.fx.dispose();
});

test('a cancelled channel loses its beacon; consumed buffs and missiles do not leave ghost effects',()=>{
  const a=arena('furion');assert.ok(a.sim.cast('w',{x:600,y:0}));a.paint();assert.ok(a.fx.diagnostics.persistent>0);
  const copies=a.sim.extraAbilities.visuals(0);copies[0].point!.x=9999;assert.equal(a.sim.extraAbilities.visuals(0)[0].point!.x,600,'snapshots must not mutate a pending teleport');
  a.sim.stop();a.fx.update(a.sim);assert.equal(a.fx.diagnostics.persistent,0);assert.equal(a.fx.diagnostics.instances,0);a.fx.dispose();
  const b=arena('earthshaker');b.sim.cast('w');b.paint();assert.ok(b.fx.diagnostics.persistent>0);
  b.sim.attack(b.v.id);for(let i=0;i<65;i++)b.sim.step();b.paint();assert.equal(b.sim.extraAbilities.visuals(b.sim.time).filter(v=>v.kind==='enchant').length,0);
  assert.ok(b.fx.diagnostics.bySkill.enchant>=2);b.fx.clear();assert.equal(b.fx.diagnostics.instances,0);b.fx.dispose();
});

test('earthshaker enchanted hit stuns nearby enemies once and interrupts their channel, never allies',()=>{
  const a=arena();a.v.heroId='furion';a.v.mana=1000;
  const ally={...structuredClone(a.v),id:'friend',team:0 as const,x:170};a.sim.units.push(ally);
  assert.ok(a.sim.castFor(a.v,'w',{x:800,y:0}));assert.ok(a.sim.extraAbilities.isChanneling(a.v,0));
  assert.ok(a.sim.cast('w'));a.sim.attack(a.v.id);for(let i=0;i<65;i++)a.sim.step();
  assert.ok(a.v.stunUntil>a.sim.time);assert.equal(a.sim.extraAbilities.isChanneling(a.v,a.sim.time),false);assert.equal(ally.stunUntil,0);
  const until=a.v.stunUntil;for(let i=0;i<100;i++)a.sim.step();assert.equal(a.v.stunUntil,until,'ordinary later attacks cannot repeat a consumed stun');a.fx.dispose();
});

test('effect pressure stays within fixed batches, reset clears all geometry and rejected casts emit nothing',()=>{
  const a=arena();a.h.mana=0;assert.equal(a.sim.cast('r'),false);a.paint();assert.equal(a.fx.diagnostics.casts,0);
  for(let i=0;i<200;i++)a.fx.event({id:i,kind:'ability',effect:'echo',stage:'cast',time:0,x:i,y:0,radius:550});
  a.sim.time=.4;a.fx.update(a.sim);assert.ok(a.fx.diagnostics.transients<=64);assert.ok(a.fx.diagnostics.drawCalls<=8);assert.ok(a.fx.diagnostics.instances<=3200);
  a.fx.clear();assert.equal(a.fx.diagnostics.instances,0);assert.equal(a.fx.diagnostics.transients,0);assert.deepEqual(a.fx.diagnostics.bySkill,{});a.fx.dispose();
});
