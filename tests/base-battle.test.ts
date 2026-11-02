import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BattleSimulation,STEP,type NavigationPort} from '../src/classic/battle/simulation';
import {MapNavigation,distance} from '../src/classic/battle/navigation';
import {STRUCTURES,FOUNTAINS,FOUNTAIN_RADIUS,isStructure} from '../src/classic/battle/structures';
const flat:NavigationPort={nearest:p=>({...p}),findPath:(_,p)=>[{...p}],lineFree:()=>true,isFree:()=>true};
function run(sim:BattleSimulation,seconds:number){for(let i=0;i<Math.ceil(seconds/STEP);i++)sim.step();}
const map=JSON.parse(readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8'));
const nav=new MapNavigation(map,readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url)));

test('all 22 defence towers and both bases use original source IDs, coordinates, scale and facing',()=>{
  assert.equal(STRUCTURES.filter(s=>s.kind==='tower').length,22);assert.equal(STRUCTURES.filter(s=>s.kind==='base').length,2);
  for(const s of STRUCTURES){const p=map.placements.find((p:any)=>p.kind==='unit'&&p.id===s.sourceId&&p.position[0]===s.x&&p.position[1]===s.y);assert.ok(p,s.id);assert.equal(p.angle,s.facing);assert.equal(p.scale[0],s.scale);assert.equal(p.team,s.team===0?0:6);}
  const sim=new BattleSimulation(flat);sim.start('juggernaut');assert.equal(sim.units.filter(isStructure).length,24);
});
test('every tower acquires, launches an original missile and damages an opposing hero without moving',()=>{
  for(const def of STRUCTURES.filter(s=>s.kind==='tower')){const sim=new BattleSimulation(flat);sim.start('juggernaut');const h=sim.hero,t=sim.unit(def.id)!;h.team=t.team===0?1:0;h.x=t.x+480;h.y=t.y;h.order='hold';sim.units=[h,t];sim.nextWave=Infinity;run(sim,.4);assert.ok(sim.projectiles.some(p=>p.source===t.id&&p.style===(t.team===0?'rock':'spirit')),def.id);run(sim,.6);assert.ok(h.hp<h.maxHp,def.id);assert.equal(t.x,def.x);assert.equal(t.y,def.y);}
});
test('destroying a tower advances the objective and never ends the match',()=>{
  const sim=new BattleSimulation(flat);sim.start('axe');const h=sim.hero,t=sim.unit('tower-1')!;h.x=t.x-180;h.y=t.y;t.hp=1;sim.units=sim.units.filter(u=>isStructure(u)||u.id==='hero');sim.attack(t.id);run(sim,.4);assert.equal(t.hp,0);assert.equal(sim.phase,'playing');assert.equal(sim.objective(0,h)?.tier,2);assert.equal(sim.unit('base-1')!.hp,4500);assert.equal(sim.events.filter(e=>e.kind==='result').length,0);
});
test('first destroyed base decides the outcome once, even when both receive lethal projectiles that step',()=>{
  for(const team of [0,1]as const){const sim=new BattleSimulation(flat);sim.start('maiden');for(const side of [team,1-team]){const base=sim.unit('base-'+side)!;base.hp=1;sim.projectiles.push({id:900+side,source:side===0?'rival':'hero',target:base.id,team:side===0?1:0,x:base.x,y:base.y,damage:100,speed:1000,life:1});}sim.step();assert.equal(sim.phase,team===0?'lost':'won');assert.ok(sim.unit('base-'+(1-team))!.hp>0);assert.equal(sim.events.filter(e=>e.kind==='result').length,1);}
});
test('both teams regenerate health and mana only at their own fountain and never beyond maxima',()=>{
  for(const team of [0,1]as const){const sim=new BattleSimulation(flat);sim.start('maiden');const h=sim.hero;h.team=team;h.order='hold';sim.units=[h];sim.nextWave=Infinity;Object.assign(h,sim.fountainSpawn(team),{hp:100,mana:0});assert.ok(sim.inFountain(h));run(sim,1);assert.ok(h.hp>190);assert.ok(h.mana>40);Object.assign(h,sim.fountainSpawn(1-team),{hp:100,mana:0});assert.equal(sim.inFountain(h),false);run(sim,1);assert.ok(h.hp<103);assert.ok(h.mana<7);Object.assign(h,sim.fountainSpawn(team));run(sim,20);assert.equal(h.hp,h.maxHp);assert.equal(h.mana,h.maxMana);}
});
test('both heroes respawn at their own reachable fountain with equipment and level preserved, old orders cleared',()=>{
  const sim=new BattleSimulation(nav);sim.start('axe');sim.buy('claws');const h=sim.hero,r=sim.unit('rival')!;sim.units=[h,r];sim.nextWave=Infinity;
  for(const u of [h,r])Object.assign(u,{hp:0,respawnAt:STEP,rootUntil:100,slowUntil:100,tauntUntil:100,pendingHit:{id:'hero',at:100},destination:{x:0,y:0},level:3});sim.step();
  for(const u of [h,r]){assert.ok(nav.isFree(u));assert.ok(distance(u,FOUNTAINS[u.team===0?0:1])<=FOUNTAIN_RADIUS);assert.equal(u.hp,u.maxHp);assert.equal(u.mana,u.maxMana);assert.equal(u.level,3);assert.equal(u.pendingHit,null);assert.equal(u.destination,null);assert.equal(u.rootUntil,0);}
  assert.deepEqual(sim.inventory,['claws']);assert.ok(h.damage>49);assert.equal(sim.events.filter(e=>e.kind==='respawn').length,2);
  assert.match(sim.message,/已在近卫泉水复活/);assert.equal(sim.selectedId,'hero');
});
test('fountain restoration continues during a stun while actions remain disabled',()=>{
  const sim=new BattleSimulation(flat);sim.start('maiden');const h=sim.hero;sim.units=[h];sim.nextWave=Infinity;Object.assign(h,sim.fountainSpawn(0),{hp:100,mana:0,stunUntil:2});sim.steer({x:1,y:0});const start={x:h.x,y:h.y};run(sim,1);assert.ok(sim.inFountain(h));assert.ok(h.hp>190);assert.ok(h.mana>40);assert.deepEqual({x:h.x,y:h.y},start);assert.equal(h.pendingHit,null);
});
test('return to fountain follows original WPM end to end and restores a damaged hero',()=>{
  const sim=new BattleSimulation(nav);sim.start('maiden');sim.units=[sim.hero];sim.nextWave=Infinity;Object.assign(sim.hero,nav.nearest({x:-1280,y:-1480}));sim.hero.hp=50;sim.hero.mana=0;assert.ok(sim.recover());
  for(let i=0;i<60*50&&!sim.inFountain(sim.hero);i++){sim.step();assert.ok(nav.isFree(sim.hero));}assert.ok(sim.inFountain(sim.hero));run(sim,20);assert.equal(sim.hero.hp,sim.hero.maxHp);assert.equal(sim.hero.mana,sim.hero.maxMana);
  for(const team of [0,1]as const){const start=sim.fountainSpawn(team),base=sim.unit('base-'+team)??STRUCTURES.find(s=>s.id==='base-'+team)!;const path=nav.findPath(start,base);assert.ok(path.length);let prev=start;for(const p of path){assert.ok(nav.lineFree(prev,p));prev=p;}}
});
test('AI attacks the opposing base after towers fall and can finish the match',()=>{
  const sim=new BattleSimulation(flat);sim.start('juggernaut');const r=sim.unit('rival')!,b=sim.unit('base-0')!,h=sim.hero;h.hp=0;h.respawnAt=100;b.hp=20;r.x=b.x+180;r.y=b.y;sim.units=[h,r,b];run(sim,.5);assert.equal(sim.phase,'lost');assert.equal(b.hp,0);
});
test('hero attack effects are emitted on release/contact and maiden frost visuals do not grant an unpurchased orb',()=>{
  for(const id of ['juggernaut','axe','maiden']as const){const sim=new BattleSimulation(flat);sim.start(id);const h=sim.hero,target=sim.units.find(u=>u.kind==='melee'&&u.team===1)!;h.x=h.y=0;target.x=id==='maiden'?400:100;target.y=0;target.speed=0;sim.units=[h,target];sim.nextWave=Infinity;sim.events=[];sim.attack(target.id);run(sim,.2);assert.equal(sim.events.filter(e=>e.kind==='attack').length,0);run(sim,.2);const expected=id==='juggernaut'?'blade':id==='axe'?'axe':'frost';assert.ok(sim.events.some(e=>e.kind==='attack'&&e.source==='hero'&&e.effect===expected));if(id==='maiden')assert.equal(sim.projectiles[0].style,'frost');run(sim,.6);assert.ok(sim.events.some(e=>e.kind==='impact'&&e.source==='hero'&&e.effect===expected));assert.equal(target.slowUntil,0);}
});
