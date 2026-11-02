import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BattleSimulation,STEP,type NavigationPort} from '../src/classic/battle/simulation';
import {HEROES,type HeroId} from '../src/classic/battle/definitions';
import {itemById,STARTING_GOLD} from '../src/classic/battle/economy';
import {MapNavigation,distance} from '../src/classic/battle/navigation';

const flat:NavigationPort={nearest:p=>({x:p.x,y:p.y}),findPath:(_,p)=>[{x:p.x,y:p.y}],isFree:()=>true,lineFree:()=>true};
const run=(sim:BattleSimulation,seconds:number)=>{for(let i=0;i<Math.ceil(seconds/STEP);i++)sim.step();};
function duel(player:HeroId='juggernaut',rival:HeroId='axe',nav:NavigationPort=flat){
  const sim=new BattleSimulation(nav);sim.start(player,rival);const h=sim.hero,r=sim.unit('rival')!;
  Object.assign(h,nav.nearest({x:180,y:0}),{order:'hold'});Object.assign(r,nav.nearest({x:0,y:0}));
  sim.units=[h,r];sim.nextWave=Infinity;return {sim,h,r};
}

test('rival uses his own paid skills and cooldowns; no free generic area damage',()=>{
  const {sim,h,r}=duel();sim.rivalGold=0;sim.step();
  assert.ok(r.cooldowns.q>sim.time);assert.ok(h.tauntUntil>sim.time);
  assert.equal(r.mana,r.maxMana-45);
  assert.ok(sim.events.some(e=>e.kind==='spell'&&e.source==='rival'&&e.effect==='stomp'));
  const hp=h.hp;run(sim,2);assert.ok(h.hp<hp);assert.ok(r.cooldowns.w>sim.time);
  assert.equal(sim.gold,STARTING_GOLD+sim.passiveGoldEarned);
});
test('rival cannot cast without mana or while controlled, and roots reject movement skills before charging',()=>{
  const {sim,h,r}=duel('axe','antimage');r.mana=0;
  assert.equal(sim.castFor(r,'q'),false);assert.deepEqual(r.cooldowns,{q:0,w:0,r:0});
  r.mana=r.maxMana;r.rootUntil=5;const before=r.mana;
  assert.equal(sim.castFor(r,'w',{x:400,y:0}),false);assert.equal(r.mana,before);assert.equal(r.cooldowns.w,0);
  r.rootUntil=0;r.stunUntil=5;assert.equal(sim.castFor(r,'q'),false);
  r.stunUntil=0;r.level=3;h.invulnerableUntil=5;
  assert.equal(sim.castFor(r,'r',h.id),false);assert.equal(r.mana,before);
});
test('enemy healing ward restores its own team and does not heal the opposing player',()=>{
  const {sim,h,r}=duel('axe','juggernaut');r.id='healer';r.hp=400;h.hp=400;h.damage=r.damage=0;h.speed=r.speed=0;
  assert.ok(sim.castFor(r,'w'));run(sim,1);
  assert.ok(r.hp>450);assert.ok(h.hp<403);
});
test('rival earns kill gold and experience, buys with its own wallet, and retains equipment through death',()=>{
  const sim=new BattleSimulation(flat);sim.start('juggernaut','axe');const r=sim.unit('rival')!,h=sim.hero;
  const template=sim.units.find(u=>u.team===0&&u.kind==='melee')!;h.x=-5000;h.y=-5000;h.order='hold';r.x=r.y=0;
  const creeps=Array.from({length:6},(_,i)=>({...structuredClone(template),id:'reward-'+i,x:80+i,y:0,hp:10,damage:0,speed:0}));
  sim.units=[h,r,...creeps];sim.nextWave=Infinity;assert.ok(sim.castFor(r,'w'));
  assert.equal(sim.rivalGoldEarned,6*38);assert.equal(r.level,3);assert.equal(sim.gold,STARTING_GOLD);assert.equal(h.xp,0);
  run(sim,2);assert.ok(sim.rivalInventory.length>=2);
  const spent=sim.rivalInventory.reduce((sum,id)=>sum+itemById(id)!.cost,0);
  assert.equal(sim.rivalGold,STARTING_GOLD+6*38+sim.passiveGoldEarned-spent);assert.equal(new Set(sim.rivalInventory).size,sim.rivalInventory.length);
  assert.ok(r.damage>HEROES.axe.damage+16);assert.ok(r.armor>0);
  const inventory=[...sim.rivalInventory],gold=sim.rivalGold;r.hp=0;r.respawnAt=sim.time+STEP;sim.step();
  assert.deepEqual(sim.rivalInventory,inventory);assert.equal(sim.rivalGold,gold);assert.equal(r.level,3);assert.ok(sim.inFountain(r));
  sim.start('maiden','axe');assert.equal(sim.rivalGold,STARTING_GOLD);assert.deepEqual(sim.rivalInventory,[]);assert.equal(sim.unit('rival')!.level,1);
});
test('low health or low mana commits to a reachable fountain, waits for both supplies, then resumes pushing',()=>{
  const map=JSON.parse(readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8'));
  const nav=new MapNavigation(map,readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url)));
  for(const resource of ['health','mana']){
    const sim=new BattleSimulation(nav);sim.start('juggernaut','axe');const h=sim.hero,r=sim.unit('rival')!,tower=sim.unit('tower-0')!;
    Object.assign(r,nav.nearest({x:650,y:220}));Object.assign(h,sim.fountainSpawn(0),{order:'hold'});sim.units=[h,r,tower];sim.nextWave=Infinity;sim.rivalGold=0;
    r.hp=resource==='health'?60:r.maxHp;r.mana=resource==='mana'?0:r.maxMana;
    sim.step();assert.equal(sim.rivalMode,'retreat');assert.equal(r.targetId,null);
    for(let i=0;i<60*90&&!sim.inFountain(r);i++){sim.step();assert.ok(nav.isFree(r));assert.equal(r.targetId,null);}
    assert.ok(sim.inFountain(r),'AI must complete the original WPM route, not merely issue an order');
    sim.step();assert.equal(sim.rivalMode,'recover');assert.equal(r.targetId,null);
    for(let i=0;i<60*30&&sim.rivalMode==='recover';i++)sim.step();
    assert.ok(r.hp/r.maxHp>=.9&&r.mana/r.maxMana>=.82);assert.equal(sim.rivalMode,'push');assert.equal(r.targetId,tower.id);
  }
});
test('channel survives idle collision separation and movement explicitly cancels it',()=>{
  const {sim,h,r}=duel('furion','axe');sim.units=[h];h.x=h.y=0;
  const ally={...structuredClone(r),id:'friend',team:0 as const,x:0,y:0,damage:0,speed:0};sim.units.push(ally);
  assert.ok(sim.cast('w',{x:700,y:0}));run(sim,2.2);assert.ok(distance(h,{x:700,y:0})<1);
  h.cooldowns.w=0;assert.ok(sim.cast('w',{x:1400,y:0}));assert.ok(sim.move({x:700,y:200}));run(sim,3);assert.ok(h.x<800);
});
test('all twelve rivals spend legal mana on useful skill casts in a visible encounter',()=>{
  for(const id of Object.keys(HEROES)as HeroId[]){
    const {sim,h,r}=duel('axe',id);sim.rivalGold=0;h.maxHp=h.hp=5000;h.damage=0;h.mana=0;
    r.level=3;r.hp=r.maxHp;r.mana=r.maxMana;
    const start=r.mana;run(sim,2.5);
    assert.ok(r.castSerial>0,id+' should use a useful ability');
    assert.ok(r.mana<start,id+' must actually pay for spells');
    assert.ok(Object.values(r.cooldowns).some(at=>at>sim.time),id+' must honor cooldowns');
  }
});

test('rival walks sideways out of a visible launched arrow; a rooted rival still takes the hit',()=>{
  for(const rooted of [false,true]){
    const {sim,h,r}=duel('mirana','axe');sim.rivalGold=0;
    h.x=-600;h.y=0;r.cooldowns={q:Infinity,w:Infinity,r:Infinity};
    if(rooted)r.rootUntil=2;
    assert.ok(sim.cast('q',{x:r.x,y:r.y}));const initial={x:r.x,y:r.y,hp:r.hp};
    sim.step();
    if(!rooted)assert.equal(sim.rivalMode,'evade','real hazard must reach the AI movement decision');
    run(sim,.9);
    if(rooted){assert.ok(r.hp<initial.hp);assert.ok(r.stunUntil>sim.time);}
    else{assert.equal(r.hp,initial.hp);assert.ok(Math.abs(r.y)>60,'dodge must use actual sideways movement');assert.ok(distance(initial,r)<=r.speed*sim.time+1,'dodge must respect normal walking speed');}
  }
});
