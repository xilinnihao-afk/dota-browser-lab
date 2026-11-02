import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/game/simulation.ts';
import { createUnitVisual } from '../src/render/units.ts';

test('terminal death animation finishes even when rules time is frozen, respects pause and resets',()=>{
  const sim=new Simulation(),unit=sim.hero,visual=createUnitVisual(unit);
  const rig=visual.root.getObjectByName('articulated-body')!;
  unit.status='dead';unit.hp=0;unit.actionTime=0;
  for(let i=0;i<10;i++)visual.update(unit,1/60,15);
  const falling=rig.rotation.z;assert.ok(falling<-.2&&falling>-.8);
  for(let i=0;i<30;i++)visual.update(unit,0,15);
  assert.equal(rig.rotation.z,falling);
  for(let i=0;i<40;i++)visual.update(unit,1/60,15);
  assert.ok(rig.rotation.z<-1.4);assert.equal(unit.actionTime,0,'visual update must not modify game state');
  sim.reset();visual.update(sim.hero,1/60,0);assert.equal(rig.rotation.z,0);visual.dispose();
});
