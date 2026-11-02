import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BattleSimulation,STEP,RIVAL_MEMORY,type NavigationPort} from '../src/classic/battle/simulation';
import {distance,MapNavigation} from '../src/classic/battle/navigation';
import {MapVision} from '../src/classic/battle/vision';
import type {MapData,Placement} from '../src/classic/map-data';
const flat:NavigationPort={nearest:p=>({x:p.x,y:p.y}),findPath:(_,p)=>[{x:p.x,y:p.y}],lineFree:()=>true,isFree:()=>true};
function run(sim:BattleSimulation,seconds:number){for(let i=0;i<Math.ceil(seconds/STEP);i++)sim.step();}
function duel(nav=flat){const sim=new BattleSimulation(nav);sim.start('juggernaut');const h=sim.hero,r=sim.unit('rival')!;Object.assign(h,{x:700,y:0,order:'hold'});Object.assign(r,{x:0,y:0});sim.units=[h,r];sim.nextWave=Infinity;return{sim,h,r};}

test('close but occluded hero cannot be acquired, including generic auto-attack fallback',()=>{
  const{sim,h,r}=duel({...flat,lineVisible:()=>false});h.x=100;run(sim,2);assert.equal(r.targetId,null);assert.equal(r.x,0);assert.equal(h.hp,h.maxHp);assert.equal(r.pendingHit,null);
});
test('loss of sight follows the copied last-seen point, never the new hidden coordinates',()=>{
  let visible=true;const{sim,h,r}=duel({...flat,lineVisible:()=>visible});run(sim,.2);assert.equal(r.targetId,h.id);
  visible=false;Object.assign(h,{x:-900,y:800});run(sim,.6);
  assert.equal(r.targetId,null);assert.equal(r.order,'move');assert.deepEqual(r.destination,{x:700,y:0});assert.ok(r.x>200&&Math.abs(r.y)<.001);
  run(sim,RIVAL_MEMORY);assert.equal(r.targetId,null);assert.equal(sim.rivalPerception.lastSeen,null);const stopped={x:r.x,y:r.y};run(sim,2);assert.deepEqual({x:r.x,y:r.y},stopped);
  visible=true;h.x=r.x+180;h.y=r.y;run(sim,1.5);assert.equal(r.targetId,'hero');assert.ok(h.hp<h.maxHp);
});
test('vision loss during a melee windup cancels the unseen hit; respawn forgets old sightings',()=>{
  let visible=true;const{sim,h,r}=duel({...flat,lineVisible:()=>visible});h.x=100;r.cooldowns={q:100,w:100,r:100};sim.step();assert.ok(r.pendingHit);
  visible=false;run(sim,.4);assert.equal(h.hp,h.maxHp);assert.equal(r.pendingHit,null);
  r.hp=0;r.respawnAt=sim.time+STEP;sim.step();assert.equal(sim.rivalPerception.lastSeen,null);assert.equal(r.targetId,null);
});
test('rival pushes map objectives while the player stays hidden and leaves the fountain alone',()=>{
  const sim=new BattleSimulation(flat);sim.start('axe');const r=sim.unit('rival')!,h=sim.hero,tower=sim.unit('tower-0')!;
  Object.assign(h,sim.fountainSpawn(0));r.x=h.x+200;r.y=h.y;sim.units=[h,r,tower];sim.nextWave=Infinity;run(sim,.2);assert.equal(r.targetId,tower.id);assert.equal(sim.rivalPerception.playerVisible,false);
});

function emptyMap():MapData{return {width:17,height:17,offset:[0,0],placements:[],corners:Array.from({length:17*17},()=>[0,0,0,0,0,0,0,0,0,0,0,0])}as unknown as MapData;}
test('sight crosses water/pathing barriers but trees and buildings occlude it',()=>{
  const map=emptyMap(),a={x:200,y:500},b={x:900,y:500};assert.equal(new MapVision(map).lineVisible(a,b),true);
  const bytes=new Uint8Array(16+64*64),view=new DataView(bytes.buffer);bytes.set([77,80,51,87]);view.setUint32(8,64,true);view.setUint32(12,64,true);for(let y=0;y<64;y++)bytes[16+y*64+16]=2;
  const nav=new MapNavigation(map,bytes);assert.equal(nav.lineFree(a,b),false);assert.equal(nav.lineVisible(a,b),true);
  for(const model of ['doodads/terrain/lordaerontree/lordaerontree.mdx','buildings/human/farm/farm.mdx']){
    map.placements=[{kind:model.startsWith('buildings')?'unit':'doodad',id:'test',model,position:[550,500,0],scale:[1,1,1]}as Placement];
    const vision=new MapVision(map);assert.equal(vision.lineVisible(a,b),false);assert.equal(vision.lineVisible({x:200,y:850},{x:900,y:850}),true);
  }
});
test('terrain ridge blocks sight, an open same-height lane does not',()=>{
  const map=emptyMap();for(let y=0;y<17;y++)map.corners[y*17+4][0]=300;
  const vision=new MapVision(map);assert.equal(vision.lineVisible({x:200,y:500},{x:1000,y:500}),false);assert.equal(vision.lineVisible({x:1000,y:500},{x:1500,y:500}),true);
});

function march(nav=flat){const sim=new BattleSimulation(nav);sim.start('axe');const h=sim.hero,c=sim.units.find(u=>u.team===0&&u.kind==='melee')!,tower=sim.unit('tower-1')!;
  Object.assign(h,{x:200,y:0,order:'hold'});Object.assign(c,{x:0,y:0});Object.assign(tower,{x:1800,y:0,damage:0});sim.units=[h,c,tower];sim.nextWave=Infinity;return{sim,h,c,tower};}
test('creep passes a stationary hero on one side, progresses without backtracking or overlap',()=>{
  const{sim,h,c}=march();let min=Infinity,side=0,changes=0;for(let i=0;i<360;i++){
    const old={x:c.x,y:c.y};sim.step();assert.ok(c.x>=old.x-.00001);min=Math.min(min,distance(c,h));
    const dy=Math.sign(c.y-old.y);if(dy&&side&&side!==dy)changes++;if(dy)side=dy;
  }
  assert.ok(c.x>1400);assert.ok(min>=c.radius+h.radius);assert.ok(changes<=1,'one sidestep and one return, no sorting back and forth');
});
test('a blocked narrow queue waits, then advances as soon as its blocker moves',()=>{
  const nav={...flat,lineFree:(a:{y:number},b:{y:number})=>Math.abs(a.y)<8&&Math.abs(b.y)<8};const{sim,h,c}=march(nav);
  run(sim,2);assert.ok(c.x<150);const before=c.x;run(sim,1);assert.ok(c.x>=before-.001);h.y=200;run(sim,3);assert.ok(c.x>800);assert.ok(Math.abs(c.y)<8);
});
test('unobstructed march retains its route instead of restarting A* every 0.8 seconds',()=>{
  let requests=0;const{sim,h,c}=march({...flat,findPath:(_,p)=>{requests++;return[{x:p.x,y:p.y}];}});h.y=1000;run(sim,5);assert.ok(c.x>1200);assert.equal(requests,1);
});
test('whole creep waves cross the original river route without leaving WPM or oscillating in place',()=>{
  const map=JSON.parse(readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8')),nav=new MapNavigation(map,readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url))),sim=new BattleSimulation(nav);sim.start('axe');
  const creeps=sim.units.filter(u=>u.team===0&&(u.kind==='melee'||u.kind==='ranged')),tower=sim.unit('tower-1')!;tower.damage=0;sim.units=[...creeps,tower];sim.nextWave=Infinity;
  for(let i=0;i<60*30;i++){sim.step();for(const c of creeps)assert.ok(nav.isFree(c));}
  for(const c of creeps)assert.ok(distance(c,tower)<=c.range+tower.radius+100,c.id+' must reach the enemy defence');
});
test('one hero death emits exactly one identity-bearing kill event; corpse hits add none',()=>{
  for(const id of ['juggernaut','axe','maiden']as const){const sim=new BattleSimulation(flat);sim.start(id);const h=sim.hero,r=sim.unit('rival')!;sim.rivalGold=0;r.cooldowns={q:100,w:100,r:100};Object.assign(h,{x:0,y:0,hp:1,order:'hold'});Object.assign(r,{x:100,y:0,damage:500});sim.units=[h,r];sim.nextWave=Infinity;run(sim,1);
    const deaths=sim.drainEvents().filter(e=>e.kind==='kill'&&e.target==='hero');assert.equal(deaths.length,1);assert.equal(deaths[0].heroId,id);run(sim,1);assert.equal(sim.drainEvents().filter(e=>e.kind==='kill').length,0);
  }
});
