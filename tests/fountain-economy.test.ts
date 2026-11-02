import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {BattleSimulation,STEP,type NavigationPort} from '../src/classic/battle/simulation';
import {STARTING_GOLD,ITEMS} from '../src/classic/battle/economy';
import {HEROES,type HeroId} from '../src/classic/battle/definitions';
import {MapNavigation,distance} from '../src/classic/battle/navigation';
import {SkillEffects} from '../src/classic/battle/skill-effects';

const flat:NavigationPort={nearest:p=>({x:p.x,y:p.y}),findPath:(_,p)=>[{...p}],lineFree:()=>true,isFree:()=>true};
const run=(sim:BattleSimulation,seconds:number)=>{for(let i=0;i<Math.round(seconds/STEP);i++)sim.step();};
function isolated(){const sim=new BattleSimulation(flat);sim.start('juggernaut');sim.units=[sim.hero];sim.nextWave=Infinity;Object.assign(sim.hero,{x:0,y:0,order:'hold'});return sim;}

test('every hero starts with 200 gold at its own reachable fountain and can leave by a real WPM route',()=>{
  const map=JSON.parse(readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8'));
  const nav=new MapNavigation(map,readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url)));
  for(const id of Object.keys(HEROES)as HeroId[]){
    const sim=new BattleSimulation(nav);sim.start(id);assert.equal(sim.gold,200);assert.equal(sim.rivalGold,200);
    for(const u of [sim.hero,sim.unit('rival')!]){assert.ok(sim.inFountain(u));assert.ok(nav.isFree(u));assert.deepEqual({x:u.x,y:u.y},sim.fountainSpawn(u.team));assert.equal(u.hp,u.maxHp);}
  }
  const sim=new BattleSimulation(nav);sim.start('juggernaut');const h=sim.hero,r=sim.unit('rival')!,tower=sim.unit('tower-0')!;sim.units=[h,r,tower];sim.nextWave=Infinity;
  const destination=nav.nearest({x:-1280,y:-1480});assert.ok(sim.move(destination));const enemyStart={x:r.x,y:r.y};
  for(let i=0;i<60*70&&distance(h,destination)>12;i++){sim.step();assert.ok(nav.isFree(h));assert.ok(nav.isFree(r));}
  assert.ok(distance(h,destination)<12);assert.ok(distance(r,enemyStart)>1000,'enemy leaves its fountain to join battle');
});

test('passive gold is exactly one per simulated second, independent of frame size, pause, death and reset',()=>{
  const sim=isolated();sim.step(.99);assert.equal(sim.gold,200);sim.step(.01);assert.equal(sim.gold,201);assert.equal(sim.rivalGold,201);
  sim.step(2.4);assert.equal(sim.gold,203);assert.equal(sim.passiveGoldEarned,3);assert.equal(sim.goldEarned,0);
  sim.paused=true;sim.step(100);assert.equal(sim.gold,203);assert.equal(sim.time,3.4);sim.paused=false;
  sim.hero.hp=0;sim.hero.respawnAt=100;sim.step(.6);assert.equal(sim.gold,204);assert.equal(sim.rivalGold,204);
  sim.phase='won';sim.step(100);assert.equal(sim.gold,204);sim.phase='choose';sim.step(100);assert.equal(sim.gold,204);
  sim.start('axe');assert.equal(sim.gold,200);assert.equal(sim.rivalGold,200);assert.equal(sim.passiveGoldEarned,0);sim.units=[];run(sim,10);assert.equal(sim.gold,210);assert.equal(sim.rivalGold,210);
});

test('tango purchases charge exact cost, stack in one slot and can refill a full inventory atomically',()=>{
  const sim=isolated();assert.ok(sim.buy('tango'));assert.equal(sim.gold,110);assert.equal(sim.itemCharges.tango,3);
  assert.ok(sim.buy('tango'));assert.equal(sim.gold,20);assert.deepEqual(sim.inventory,['tango']);assert.equal(sim.itemCharges.tango,6);
  assert.equal(sim.buy('tango'),false);assert.equal(sim.itemCharges.tango,6);assert.equal(sim.gold,20);
  sim.gold=10000;for(const item of ITEMS.filter(i=>!i.consumable).slice(0,5))assert.ok(sim.buy(item.id));assert.equal(sim.inventory.length,6);
  const before=sim.gold;assert.ok(sim.buy('tango'));assert.equal(sim.gold,before-90);assert.equal(sim.itemCharges.tango,9);assert.equal(sim.inventory.length,6);assert.equal(sim.buy('orbSlow'),false);
  sim.paused=true;assert.equal(sim.buy('tango'),false);sim.paused=false;sim.hero.hp=0;assert.equal(sim.buy('tango'),false);assert.equal(sim.itemCharges.tango,9);
});

test('one tango heals exactly 115 over 16 seconds beyond natural regen; pause freezes it and damage does not cancel it',()=>{
  const sim=isolated();sim.buy('tango');const h=sim.hero;assert.equal(sim.useItem('tango'),false);assert.equal(sim.itemCharges.tango,3);
  h.hp=300;assert.ok(sim.useItem('tango'));assert.equal(h.hp,300);assert.equal(sim.itemCharges.tango,2);assert.equal(sim.useItem('tango'),false);
  run(sim,8);assert.ok(Math.abs(h.hp-(300+8*1.5+115/2))<1e-6);h.hp-=30;
  sim.paused=true;const before={hp:h.hp,time:sim.time,remaining:sim.itemRecoveryRemaining()};run(sim,5);assert.deepEqual({hp:h.hp,time:sim.time,remaining:sim.itemRecoveryRemaining()},before);sim.paused=false;
  run(sim,8);assert.ok(Math.abs(h.hp-(300-30+16*1.5+115))<1e-6);assert.equal(sim.itemRecoveryRemaining(),0);
  const hp=h.hp;run(sim,1);assert.ok(Math.abs(h.hp-hp-1.5)<1e-6);assert.equal(sim.itemCharges.tango,2);
  h.hp=h.maxHp-1;assert.ok(sim.useItem('tango'));run(sim,16);assert.equal(h.hp,h.maxHp);
});

test('tango blocks invalid use, clears healing on death, preserves unused charges through respawn, and empties its last slot',()=>{
  const sim=isolated(),h=sim.hero;sim.buy('tango');h.hp=300;
  h.stunUntil=10;assert.equal(sim.useItem('tango'),false);h.stunUntil=0;h.tauntUntil=10;assert.equal(sim.useItem('tango'),false);h.tauntUntil=0;
  sim.paused=true;assert.equal(sim.useItem('tango'),false);sim.paused=false;assert.equal(sim.useItem('claws'),false);assert.equal(sim.itemCharges.tango,3);
  assert.ok(sim.useItem('tango'));h.hp=0;h.respawnAt=sim.time+1;run(sim,.5);assert.equal(h.hp,0);assert.equal(sim.itemRecoveryRemaining(),0);run(sim,.6);assert.equal(h.hp,h.maxHp);assert.equal(sim.itemCharges.tango,2);
  Object.assign(h,{x:0,y:0,hp:300,order:'hold'});assert.ok(sim.useItem('tango'));run(sim,16);assert.ok(sim.useItem('tango'));assert.equal(sim.itemCharges.tango,undefined);assert.equal(sim.inventory.includes('tango'),false);assert.ok(sim.itemRecoveryRemaining()>0);
  sim.start('axe');assert.deepEqual(sim.itemCharges,{});assert.deepEqual(sim.rivalItemCharges,{});assert.equal(sim.itemRecoveryRemaining(),0);assert.equal(sim.gold,STARTING_GOLD);
});

test('selling a partially used stack refunds only half the unused charges, without creating gold',()=>{
  const sim=isolated();sim.buy('tango');sim.buy('tango');sim.hero.hp=300;sim.useItem('tango');assert.equal(sim.itemCharges.tango,5);assert.equal(sim.sellValue('tango'),75);
  assert.ok(sim.sell('tango'));assert.equal(sim.gold,95);assert.equal(sim.itemCharges.tango,undefined);assert.equal(sim.sell('tango'),false);assert.equal(sim.gold,95);assert.ok(sim.itemRecoveryRemaining()>0);
});

test('enemy buys and uses tango from its own wallet without consuming player stock or abandoning its fountain policy',()=>{
  const sim=new BattleSimulation(flat);sim.start('juggernaut','axe');const h=sim.hero,r=sim.unit('rival')!;sim.units=[h,r];sim.nextWave=Infinity;
  Object.assign(r,{x:0,y:0,hp:r.maxHp*.6});sim.buy('tango');sim.step();
  assert.equal(sim.rivalGold,110);assert.equal(sim.rivalItemCharges.tango,2);assert.ok(sim.itemRecoveryRemaining(r)>0);assert.equal(sim.itemCharges.tango,3);assert.equal(sim.gold,110);assert.equal(sim.itemRecoveryRemaining(h),0);
  r.hp=50;sim.step();assert.equal(sim.rivalMode,'retreat');assert.ok(sim.itemRecoveryRemaining(r)>0);
});

test('tango visuals follow actual regeneration, freeze during pause, and disappear at expiry or death',()=>{
  const sim=isolated();sim.buy('tango');sim.hero.hp=300;sim.useItem('tango');const fx=new SkillEffects(new THREE.Group(),()=>0);fx.update(sim);assert.ok(fx.diagnostics.instances>0);
  sim.paused=true;const matrices=fx.root.children.map(c=>Array.from((c as THREE.InstancedMesh).instanceMatrix.array));sim.step();fx.update(sim);assert.deepEqual(fx.root.children.map(c=>Array.from((c as THREE.InstancedMesh).instanceMatrix.array)),matrices);
  sim.paused=false;run(sim,16);fx.update(sim);assert.equal(fx.diagnostics.instances,0);sim.useItem('tango');sim.hero.hp=0;fx.update(sim);assert.equal(fx.diagnostics.instances,0);fx.dispose();
});
