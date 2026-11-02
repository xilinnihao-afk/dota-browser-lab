import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BattleSimulation,STEP,type NavigationPort} from '../src/classic/battle/simulation';
import {MapNavigation,distance} from '../src/classic/battle/navigation';
import {HEROES,type HeroId} from '../src/classic/battle/definitions';
const flat:NavigationPort={nearest:p=>({...p}),findPath:(_,p)=>[{...p}],lineFree:()=>true,isFree:()=>true};
function run(sim:BattleSimulation,seconds:number){for(let i=0;i<Math.ceil(seconds/STEP);i++)sim.step();}
function duel(hero:HeroId){const sim=new BattleSimulation(flat);sim.start(hero);const h=sim.hero,e=sim.unit('rival')!;h.x=h.y=0;e.x=hero==='maiden'?400:100;e.y=0;e.id='target';e.maxHp=e.hp=5000;e.speed=e.damage=0;e.cooldowns.q=100;sim.units=[h,e];return{sim,h,e};}
for(const hero of ['juggernaut','maiden']as const)test(hero+': rapid repeated attack clicks preserve damage and cadence',()=>{
  const once=duel(hero),spam=duel(hero);once.sim.attack('target');spam.sim.attack('target');
  for(let i=0;i<150;i++){once.sim.step();if(i%3===0)spam.sim.attack('target');spam.sim.step();}
  assert.ok(once.e.hp<once.e.maxHp-once.h.damage);assert.equal(spam.e.hp,once.e.hp);assert.equal(spam.h.attackAt,once.h.attackAt);assert.deepEqual(spam.h.pendingHit,once.h.pendingHit);
});
test('repeated attack clicks retain a distant chase path',()=>{
  const{sim,h,e}=duel('juggernaut');e.x=1600;sim.attack(e.id);sim.step();const path=h.path;sim.attack(e.id);assert.equal(h.path,path);run(sim,3);assert.ok(h.x>1000);
});
test('changing target cancels the old windup but allows a fresh hit without the spent cooldown',()=>{
  const{sim,h,e}=duel('juggernaut'),other={...structuredClone(e),id:'other',y:80};sim.units.push(other);sim.attack(e.id);run(sim,.1);assert.ok(h.pendingHit);sim.attack(other.id);run(sim,.4);assert.equal(e.hp,e.maxHp);assert.ok(other.hp<other.maxHp);
});
test('attack clicks cannot accelerate already committed attacks',()=>{
  const{sim,h,e}=duel('juggernaut'),other={...structuredClone(e),id:'other',y:60};sim.units.push(other);sim.attack(e.id);run(sim,.4);const attackAt=h.attackAt;sim.attack(other.id);run(sim,.3);assert.equal(h.attackAt,attackAt);assert.equal(other.hp,other.maxHp);
});
test('normal walking during windup cannot make committed melee and ranged attacks silently miss',()=>{
  for(const id of ['juggernaut','maiden']as const){const{sim,h,e}=duel(id);e.x=h.range+e.radius-1;sim.attack(e.id);sim.step();assert.ok(h.pendingHit);for(let i=0;i<24;i++){e.x+=384*STEP;sim.step();}if(id==='maiden')assert.ok(sim.projectiles.length,'ranged windup must release a projectile');run(sim,.8);assert.ok(e.hp<e.maxHp,id+' hits the retreating target');}
});
test('teleporting beyond hit leeway still escapes an uncommitted melee attack with feedback',()=>{
  const{sim,h,e}=duel('juggernaut');sim.attack(e.id);run(sim,.1);assert.ok(h.pendingHit);e.x=2000;run(sim,.3);assert.equal(e.hp,e.maxHp);assert.match(sim.message,/脱离攻击距离/);
});
test('enemy hero cannot acquire an unseen player across the map',()=>{
  const sim=new BattleSimulation(flat);sim.start('juggernaut');const h=sim.hero,r=sim.unit('rival')!;sim.units=[h,r];sim.stop();const before=distance(r,h);run(sim,2);assert.equal(r.targetId,null);assert.equal(distance(r,h),before);assert.equal(r.action,'idle');
});
test('enemy hero changes from nearby creeps to the approaching player and deals damage',()=>{
  const sim=new BattleSimulation(flat);sim.start('juggernaut');const h=sim.hero,r=sim.unit('rival')!,creep=sim.units.find(u=>u.team===0&&u.kind==='melee')!;r.x=r.y=0;h.x=-4000;h.y=0;creep.x=100;creep.y=0;creep.speed=0;sim.units=[h,r,creep];sim.stop();run(sim,.5);assert.ok(creep.hp<creep.maxHp);h.x=250;run(sim,1.5);assert.equal(r.targetId,h.id);assert.ok(h.hp<h.maxHp);
});
test('enemy hero pushes the allied tower when player is absent, and resumes after respawn',()=>{
  const sim=new BattleSimulation(flat);sim.start('juggernaut');const h=sim.hero,r=sim.unit('rival')!,tower=sim.unit('tower-0')!;h.hp=0;h.respawnAt=100;r.x=tower.x+180;r.y=tower.y;sim.units=[h,r,tower];run(sim,.5);assert.equal(r.targetId,tower.id);assert.ok(tower.hp<tower.maxHp);r.hp=0;r.respawnAt=sim.time+.1;run(sim,.7);assert.ok(r.hp>0);assert.equal(r.targetId,tower.id);assert.equal(r.order,'attack');
});
test('all heroes move 20 percent faster while keeping their relative speeds',()=>{
  for(const[id,oldSpeed]of [['juggernaut',320],['axe',300],['maiden',290]]as const){const sim=new BattleSimulation(flat);sim.start(id);sim.units=[sim.hero];const start={...sim.hero};sim.steer({x:1,y:0});run(sim,1);assert.ok(Math.abs(distance(start,sim.hero)-oldSpeed*1.2)<.001);assert.equal(HEROES[id].speed,oldSpeed*1.2);}
});
test('AI engages a visible player across original WPM without leaving walkable terrain',()=>{
  const map=JSON.parse(readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8')),nav=new MapNavigation(map,readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url))),sim=new BattleSimulation(nav);sim.start('juggernaut');const h=sim.hero,r=sim.unit('rival')!;sim.units=[h,r];Object.assign(h,nav.nearest({x:-500,y:-750}));Object.assign(r,nav.nearest({x:-300,y:-600}));assert.ok(sim.canSee(r,h));sim.stop();let hit=false;
  for(let i=0;i<60*30&&!hit;i++){sim.step();assert.ok(nav.isFree(r));hit=sim.drainEvents().some(e=>e.kind==='damage'&&e.source==='rival'&&e.target==='hero');}assert.ok(hit,'enemy hero must seek and actually attack across the river');
});
