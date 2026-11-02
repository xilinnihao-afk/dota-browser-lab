import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BattleSimulation,STEP,type NavigationPort} from '../src/classic/battle/simulation';
import {ITEMS,STARTING_GOLD,armorMultiplier} from '../src/classic/battle/economy';
import {CAMPS,isBattlePlacement} from '../src/classic/battle/world';
import {MapNavigation,distance} from '../src/classic/battle/navigation';
import type {HeroId} from '../src/classic/battle/definitions';
const flat:NavigationPort={nearest:p=>({...p}),findPath:(_,p)=>[{...p}],lineFree:()=>true,isFree:()=>true};
function run(sim:BattleSimulation,seconds:number){for(let i=0;i<Math.ceil(seconds/STEP);i++)sim.step();}
function arena(hero:HeroId='juggernaut'){
  const sim=new BattleSimulation(flat);sim.start(hero);const h=sim.hero,e=sim.units.find(u=>u.team===1&&u.kind==='melee')!;h.x=h.y=0;e.x=100;e.y=0;e.damage=0;e.speed=0;e.maxHp=e.hp=1000;sim.units=[h,e];sim.events=[];return{sim,h,e};
}
test('purchases are atomic: exact price, unique items, funds, six slots, pause and death checks',()=>{
  const{sim,h}=arena();assert.ok(sim.buy('claws'));assert.equal(sim.gold,STARTING_GOLD-150);assert.equal(h.damage,65);assert.equal(sim.buy('claws'),false);assert.equal(sim.buy('orbFrost'),false);assert.equal(sim.buy('missing'),false);assert.equal(sim.gold,STARTING_GOLD-150);
  sim.gold=10000;for(const item of ITEMS.filter(i=>i.id!=='claws').slice(0,5))assert.ok(sim.buy(item.id));assert.equal(sim.inventory.length,6);const gold=sim.gold;assert.equal(sim.buy('orbFrost'),false);assert.equal(sim.gold,gold);
  sim.paused=true;assert.equal(sim.sell('claws'),false);sim.paused=false;h.hp=0;assert.equal(sim.sell('claws'),false);
});
test('selling equipment removes stats and half-price refund cannot generate gold or heal',()=>{
  const{sim,h}=arena();sim.gold=500;assert.ok(sim.buy('vitality'));assert.equal(h.maxHp,1020);h.hp=900;assert.ok(sim.sell('vitality'));assert.equal(h.maxHp,820);assert.equal(h.hp,820);assert.equal(sim.gold,375);assert.equal(sim.sell('vitality'),false);assert.equal(sim.gold,375);
  sim.buy('armor');assert.equal(h.armor,5);sim.sell('armor');assert.equal(h.armor,0);sim.start('axe');assert.equal(sim.gold,STARTING_GOLD);assert.deepEqual(sim.inventory,[]);assert.equal(sim.activeOrb,null);
});
test('physical armor reduces attacks; lifesteal uses actual damage and does not work on towers',()=>{
  const{sim,h,e}=arena();sim.gold=450;assert.ok(sim.buy('vampire'));h.hp=300;e.armor=5;sim.attack(e.id);run(sim,.4);const dealt=h.damage*armorMultiplier(5);assert.ok(Math.abs(e.hp-(1000-dealt))<.001);assert.ok(Math.abs(h.hp-(300+.4*1.5+dealt*.18))<.001);
  const tower=arena();tower.sim.gold=450;assert.ok(tower.sim.buy('vampire'));tower.h.hp=300;tower.e.kind='tower';tower.sim.attack(tower.e.id);run(tower.sim,.4);assert.ok(Math.abs(tower.h.hp-300.6)<.001);
});
test('slow and frost orbs affect only attacks, with per-target freeze cooldown and one active orb',()=>{
  const{sim,h,e}=arena();sim.gold=2000;sim.buy('orbSlow');sim.buy('orbFrost');assert.equal(sim.activeOrb,'frost');sim.attack(e.id);run(sim,.4);assert.ok(e.rootUntil>sim.time&&e.stunUntil>sim.time);const ready=e.frostReadyAt;run(sim,1.1);assert.equal(e.frostReadyAt,ready);assert.ok(e.slowUntil>sim.time);assert.ok(e.rootUntil<sim.time);
  assert.ok(sim.equipOrb('orbSlow'));assert.equal(sim.activeOrb,'slow');sim.sell('orbSlow');assert.equal(sim.activeOrb,null);sim.equipOrb('orbFrost');assert.equal(sim.activeOrb,'frost');assert.equal(sim.equipOrb('missing'),false);assert.ok(h.hp>0);
});
test('splash damages nearby enemies only once, not allies or other towers',()=>{
  const{sim,h,e}=arena();const nearby={...structuredClone(e),id:'nearby',x:180,y:60},ally={...structuredClone(e),id:'ally',team:0 as const,x:160,y:80},tower={...structuredClone(e),id:'tower-extra',kind:'tower' as const,x:180,y:90};sim.units.push(nearby,ally,tower);sim.gold=500;assert.ok(sim.buy('orbSplash'));sim.attack(e.id);run(sim,.4);assert.ok(Math.abs(nearby.hp-(1000-h.damage*.45))<.001);assert.equal(ally.hp,1000);assert.equal(tower.hp,1000);assert.equal(e.hp,1000-h.damage);
});
test('ranged shots snapshot their orb; selling before impact does not rewrite the launched attack',()=>{
  const{sim,e}=arena('maiden');e.x=450;sim.gold=350;assert.ok(sim.buy('orbSlow'));sim.attack(e.id);run(sim,.34);assert.equal(sim.projectiles[0].orb,'slow');sim.sell('orbSlow');run(sim,.4);assert.ok(e.slowUntil>sim.time);assert.equal(e.slowFactor,.65);
});
test('neutral kills award gold and XP once, clear camps respawn, and neutral deaths do not end the match',()=>{
  const definition={...CAMPS[1],x:0,y:0,count:1,hp:1,damage:0,respawn:1};const sim=new BattleSimulation(flat,[definition]);sim.start('juggernaut');const h=sim.hero,e=sim.units.find(u=>u.kind==='neutral')!;h.x=-100;h.y=0;sim.units=[h,e];sim.attack(e.id);run(sim,.5);assert.equal(sim.gold,STARTING_GOLD+definition.gold);assert.equal(h.xp,definition.xp);assert.equal(sim.neutralKills,1);assert.equal(sim.phase,'playing');const gold=sim.gold;sim.stop();h.x=-2000;run(sim,2);assert.equal(sim.gold,gold+2);assert.equal(sim.goldEarned,definition.gold);assert.equal(sim.units.filter(u=>u.kind==='neutral'&&u.hp>0).length,1);
});
test('neutrals leash home, ignore damage during return, and cannot be pulled indefinitely',()=>{
  const sim=new BattleSimulation(flat,[{...CAMPS[1],x:0,y:0,count:1}]);sim.start('maiden');const h=sim.hero,e=sim.units.find(u=>u.kind==='neutral')!;sim.units=[h,e];e.x=700;e.y=0;e.hp=100;e.targetId=h.id;h.x=1400;h.y=0;sim.step();assert.equal(e.returning,true);assert.equal(e.targetId,null);assert.ok(e.x<700);sim.projectiles.push({id:999,source:h.id,target:e.id,team:0,x:e.x,y:e.y,damage:999,speed:1000,life:1});sim.step();assert.ok(e.hp>100);sim.stop();run(sim,4);assert.equal(e.returning,false);assert.ok(distance(e,e.home!)<15);assert.equal(e.hp,e.maxHp);
});
test('tower attacks launch original projectile styles, hit units and emit impact events',()=>{
  const sim=new BattleSimulation(flat);sim.start('axe');const h=sim.hero,tower=sim.unit('tower-1')!;h.x=tower.x-500;h.y=tower.y;h.order='hold';sim.units=[h,tower];run(sim,.34);assert.equal(sim.projectiles[0].style,'spirit');assert.ok(sim.events.some(e=>e.kind==='attack'&&e.source===tower.id));run(sim,.7);assert.ok(h.hp<h.maxHp);assert.ok(sim.events.some(e=>e.kind==='impact'&&e.effect==='impact'));
});
test('source camp centres remain reachable on original WPM and boss, both bases and all towers replace scenery',()=>{
  const map=JSON.parse(readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8')),nav=new MapNavigation(map,readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url)));const start=nav.nearest({x:-1280,y:-1480});
  for(const camp of CAMPS){const end=nav.nearest(camp),path=nav.findPath(start,end);assert.ok(path.length>0,camp.name);let previous=start;for(const p of path){assert.ok(nav.lineFree(previous,p));previous=p;}assert.ok(distance(previous,end)<1);}
  assert.equal(map.placements.filter(isBattlePlacement).length,25);
});
test('heroes actually traverse all camp routes without stalling at WPM tree corners',()=>{
  const map=JSON.parse(readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8')),nav=new MapNavigation(map,readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url)));
  assert.equal(nav.lineFree({x:-791.5315653678268,y:-1741.4728381738719},{x:-608,y:-1824}),false,'previous sampled shortcut clipped a tree footprint');
  for(const camp of CAMPS){const sim=new BattleSimulation(nav);sim.start('juggernaut');sim.units=[sim.hero];assert.ok(sim.move(camp));for(let i=0;i<60*60&&sim.hero.order==='move';i++){sim.step();assert.ok(nav.isFree(sim.hero));}assert.ok(distance(sim.hero,nav.nearest(camp))<12,camp.name+' must be reached, not just return an initial path');}
});
