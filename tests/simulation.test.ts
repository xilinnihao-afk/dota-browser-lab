import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, walkableSurface } from '../src/game/map.ts';
import { Navigation } from '../src/game/navigation.ts';
import { Simulation, FIXED_STEP } from '../src/game/simulation.ts';

const advance=(sim:Simulation,seconds:number)=>{for(let i=0;i<Math.ceil(seconds/FIXED_STEP);i++)sim.step();};

test('deterministic map places obstacles outside the ford and hero spawn',()=>{
  assert.deepEqual(createMap(683),createMap(683));assert.notDeepEqual(createMap(683).obstacles,createMap(684).obstacles);
  const nav=new Navigation(createMap());assert.ok(nav.isFree(-1,15));assert.ok(nav.isFree(0,0));assert.equal(walkableSurface(20,0),false);
});
test('cross-bank path uses the ford and every segment is collision free',()=>{
  const nav=new Navigation(createMap()),start=nav.nearestFree({x:20,z:20}),goal=nav.nearestFree({x:20,z:-20});
  const path=nav.findPath(start,goal);assert.ok(path.length>1);let previous=start,nearFord=false;
  for(const p of path){assert.ok(nav.lineFree(previous,p));const steps=Math.ceil(Math.hypot(p.x-previous.x,p.z-previous.z)/.2);for(let i=0;i<=steps;i++){const t=i/steps,x=previous.x+(p.x-previous.x)*t,z=previous.z+(p.z-previous.z)*t;assert.ok(nav.isFree(x,z));if(Math.abs(z)<1) {nearFord=true;assert.ok(Math.abs(x)<7);}}previous=p;}
  assert.ok(nearFord);assert.ok(Math.hypot(previous.x-goal.x,previous.z-goal.z)<.01);
});
test('clicking an obstacle resolves to a reachable clear point',()=>{
  const map=createMap(),nav=new Navigation(map),tree=map.obstacles.find(o=>o.kind==='tree')!;
  const goal=nav.nearestFree(tree);assert.ok(nav.isFree(goal.x,goal.z));assert.ok(Math.hypot(goal.x-tree.x,goal.z-tree.z)>tree.radius);
  const path=nav.findPath({x:-1,z:15},tree);assert.ok(path.length);assert.ok(nav.isFree(path.at(-1)!.x,path.at(-1)!.z));
});
test('tree-gap regression: valid node centers cannot hide an obstructed edge',()=>{
  const sim=new Simulation(),start={x:24.1014226153,z:-31.552583396},goal={x:21.691495094,z:-37.223769967};
  sim.state.units.filter(u=>u.team==='enemy').forEach(u=>u.hp=0);sim.hero.x=start.x;sim.hero.z=start.z;
  const path=sim.navigation.findPath(start,goal);assert.ok(path.length);let previous=start;
  for(const point of path){assert.ok(sim.navigation.lineFree(previous,point),`blocked edge ${JSON.stringify([previous,point])}`);previous=point;}
  const resolved=sim.navigation.nearestFree(goal);
  sim.move(goal);advance(sim,50);assert.ok(Math.hypot(sim.hero.x-resolved.x,sim.hero.z-resolved.z)<.5);assert.equal(sim.hero.status,'idle');
});
test('hero crosses the ford without intersecting static obstacles',()=>{
  const sim=new Simulation();sim.state.units.filter(u=>u.team==='enemy').forEach(u=>u.hp=0);
  sim.move({x:1,z:-18});for(let i=0;i<300;i++){sim.step();assert.ok(sim.navigation.isFree(sim.hero.x,sim.hero.z,sim.hero.radius));}
  assert.ok(Math.hypot(sim.hero.x-1,sim.hero.z+18)<.4);
});
test('stop cancels an attack before contact and does not deal delayed damage',()=>{
  const sim=new Simulation(),guard=sim.getUnit('guard-1')!;sim.hero.x=guard.x;sim.hero.z=guard.z+2;sim.hero.facing=Math.PI;
  sim.attack(guard.id);sim.step();assert.equal(sim.hero.status,'windup');const hp=guard.hp;
  sim.stop();advance(sim,.4);assert.equal(guard.hp,hp);assert.equal(sim.hero.targetId,null);
});
test('moving cancels an uncommitted attack; committed hit is paid once',()=>{
  const sim=new Simulation(),guard=sim.getUnit('guard-1')!;sim.hero.x=guard.x;sim.hero.z=guard.z+2;sim.hero.facing=Math.PI;
  sim.attack(guard.id);advance(sim,.1);sim.move({x:1,z:12});advance(sim,.4);assert.equal(guard.hp,guard.maxHp);
  sim.hero.x=guard.x;sim.hero.z=guard.z+2;sim.hero.facing=Math.PI;sim.attack(guard.id);advance(sim,.4);assert.equal(guard.hp,guard.maxHp-sim.hero.damage);
  sim.stop();advance(sim,.3);assert.equal(guard.hp,guard.maxHp-sim.hero.damage);
});
test('a complete basic-attack route can defeat the guards and enemy tower',()=>{
  const sim=new Simulation();for(const id of ['guard-1','guard-2','guard-3','enemy-tower']){
    const target=sim.getUnit(id)!;sim.attack(id);let steps=0;while(target.hp>0&&sim.state.phase==='playing'&&steps++<1500)sim.step();
    assert.equal(target.hp,0,`${id} was not defeated: ${JSON.stringify({hero:sim.hero,target})}`);
  }
  assert.equal(sim.state.phase,'won');assert.equal(sim.state.kills,4);assert.equal(sim.state.gold,335);assert.ok(sim.hero.hp>0);
  const gold=sim.state.gold;advance(sim,10);assert.equal(sim.state.gold,gold);
});
test('pause freezes simulation; defeat, reset and subsequent commands work',()=>{
  const sim=new Simulation();sim.move({x:0,z:0});sim.togglePause();const snapshot=JSON.stringify(sim.state);advance(sim,2);assert.equal(JSON.stringify(sim.state),snapshot);sim.togglePause();advance(sim,.5);assert.notEqual(sim.hero.z,15);
  sim.hero.hp=1;sim.hero.x=3;sim.hero.z=-18;sim.stop();advance(sim,3);assert.equal(sim.state.phase,'lost');
  sim.reset();assert.equal(sim.state.phase,'playing');assert.equal(sim.hero.hp,760);assert.equal(sim.state.kills,0);assert.equal(sim.state.events.length,0);sim.move({x:0,z:10});advance(sim,2);assert.ok(sim.hero.z<11);
});
