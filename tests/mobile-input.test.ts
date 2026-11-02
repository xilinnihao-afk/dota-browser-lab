import test from 'node:test';
import assert from 'node:assert/strict';
import {stickVector,screenToWorld,touchAimPoint,touchTarget,TouchPointer,type TouchTarget} from '../src/classic/battle/mobile-input';
import {renderProfile} from '../src/classic/battle/mobile-profile';
import {BattleSimulation} from '../src/classic/battle/simulation';

const hero:TouchTarget={id:'hero',team:0,hp:100,x:0,y:0,radius:30,kind:'hero'};
const enemy=(id:string,x:number,y:number,extra:Partial<TouchTarget>={}):TouchTarget=>({id,x,y,hp:100,team:1,radius:30,kind:'hero',...extra});
test('resting thumb does not drift; diagonal and over-range drags have equal speed',()=>{
  assert.equal(stickVector(3,2),null);assert.equal(stickVector(0,0),null);
  for(const [x,y] of [[25,0],[30,30],[600,-300]]){const v=stickVector(x,y)!;assert.ok(Math.abs(Math.hypot(v.x,v.y)-1)<1e-9);}
  assert.equal(stickVector(NaN,0),null);
});
test('screen-up follows the camera heading, including a rotated camera',()=>{
  assert.deepEqual(screenToWorld({x:0,y:-1},{x:1,y:0}),{x:0,y:1});
  const v=screenToWorld({x:1,y:0},{x:0,y:2});assert.deepEqual(v,{x:0,y:1});
  const p=touchAimPoint(hero,{x:72,y:0},900,{x:0,y:1});assert.ok(Math.abs(p.x)<1e-8&&p.y>899&&p.y<900);
});
test('point drags clamp to range, while directional skills use full range',()=>{
  assert.ok(touchAimPoint(hero,{x:10,y:0},900,{x:1,y:0}).x<150);
  assert.ok(touchAimPoint(hero,{x:10,y:0},900,{x:1,y:0},true).x>899);
  for(const range of [220,650,900,5000]){const p=touchAimPoint(hero,{x:800,y:-300},range,{x:1,y:0});assert.ok(Math.hypot(p.x,p.y)<range);}
});
test('auto attack excludes allies, dead, unseen, returning, invulnerable and distant targets',()=>{
  const units=[enemy('ally',5,0,{team:0}),enemy('dead',5,0,{hp:0}),enemy('return',8,0,{returning:true}),enemy('immune',9,0,{invulnerableUntil:12}),enemy('hidden',10,0),enemy('far',2000,0),enemy('valid',250,0)];
  assert.equal(touchTarget(hero,units,{range:900,now:10,visible:u=>u.id!=='hidden'})?.id,'valid');
});
test('tap preserves a selected target; dragging overrides it with the aimed direction',()=>{
  const units=[enemy('near',100,0),enemy('selected',250,0),enemy('aimed',0,350)];
  assert.equal(touchTarget(hero,units,{range:700,now:0,selected:'selected'})?.id,'selected');
  assert.equal(touchTarget(hero,units,{range:700,now:0,selected:'selected',direction:{x:0,y:1}})?.id,'aimed');
  assert.equal(touchTarget(hero,units,{range:700,now:0,direction:{x:0,y:-1}}),undefined);
});
test('targeted abilities reject structures; attack can select them',()=>{
  const units=[enemy('tower',90,0,{kind:'tower'})];
  assert.equal(touchTarget(hero,units,{range:700,now:0,skill:true}),undefined);
  assert.equal(touchTarget(hero,units,{range:700,now:0})?.id,'tower');
});
test('touch-selected targets drive real attacks and enemy spells through the battle rules',()=>{
  const sim=new BattleSimulation({nearest:p=>({...p}),findPath:(_,p)=>[{...p}],lineFree:()=>true,isFree:()=>true});sim.start('maiden');
  const h=sim.hero,target=sim.units.find(u=>u.team===1&&u.kind==='melee')!;h.x=h.y=0;target.x=250;target.y=0;sim.units=[h,target];
  const picked=touchTarget(h,sim.units,{range:900,now:sim.time,visible:u=>sim.canSee(h,u)})!;
  assert.ok(sim.attack(picked.id));const before=target.hp;for(let i=0;i<60;i++)sim.step();assert.ok(target.hp<before);
  const aimed=touchTarget(h,sim.units,{range:700,now:sim.time,skill:true,direction:{x:1,y:0}})!;
  assert.ok(sim.cast('w',aimed.id));assert.ok(target.rootUntil>=sim.time+2);assert.equal(h.cooldowns.w,sim.time+9);
  const mana=h.mana;assert.equal(sim.cast('w',aimed.id),false);assert.equal(h.mana,mana);
  sim.steer(screenToWorld({x:-1,y:0},{x:1,y:0}));for(let i=0;i<10;i++)sim.step();assert.ok(h.x<0);sim.steer(null);const stopped=h.x;sim.step();assert.equal(h.x,stopped);
});
test('two thumbs have independent ownership; wrong pointer, cancel and reuse cannot stick',()=>{
  const movement=new TouchPointer(),skill=new TouchPointer();
  assert.ok(movement.claim(1));assert.ok(skill.claim(2));assert.equal(movement.claim(2),false);
  assert.equal(movement.release(2),false);assert.ok(movement.owns(1));assert.ok(skill.release(2));assert.ok(movement.owns(1));
  movement.clear();assert.equal(movement.id,null);assert.ok(movement.claim(3));assert.equal(movement.release(1),false);assert.ok(movement.release(3));
});
test('mobile resolution and smooth frame caps reduce load without changing desktop defaults',()=>{
  assert.deepEqual(renderProfile(false,'auto',2),{pixelRatio:1.5,fps:60});
  assert.deepEqual(renderProfile(false,'smooth',2),{pixelRatio:1.5,fps:60});
  assert.deepEqual(renderProfile(true,'auto',3),{pixelRatio:1.1,fps:60});
  assert.deepEqual(renderProfile(true,'smooth',3),{pixelRatio:.85,fps:30});
  assert.equal(renderProfile(true,'high',1).pixelRatio,1);
});
