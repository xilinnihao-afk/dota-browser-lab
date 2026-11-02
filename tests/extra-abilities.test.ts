import test from 'node:test';
import assert from 'node:assert/strict';
import {ExtraAbilities,type AbilityContext} from '../src/classic/battle/extra-abilities';
import {HEROES,type HeroId,type SkillSlot} from '../src/classic/battle/definitions';
import {BattleSimulation,type CombatUnit,type NavigationPort,type CombatEvent} from '../src/classic/battle/simulation';
import {distance,type Point} from '../src/classic/battle/navigation';

const flat:NavigationPort={nearest:p=>({...p}),findPath:(_,p)=>[{...p}],lineFree:()=>true,isFree:()=>true};
function arena(id:HeroId,n=3,nav:NavigationPort=flat){
  const sim=new BattleSimulation(nav);sim.start(id);
  const u=sim.hero;Object.assign(u,{x:0,y:0,hp:2000,maxHp:2000,level:3});
  const template=sim.unit('rival')!;
  const enemies=Array.from({length:n},(_,i):CombatUnit=>({...structuredClone(template),id:`enemy-${i}`,x:150+i*100,y:0,hp:2000,maxHp:2000,mana:200,maxMana:400,radius:25}));
  const ally:CombatUnit={...structuredClone(enemies[0]??template),id:'ally',team:0,x:160,y:5};
  const building:CombatUnit={...structuredClone(enemies[0]??template),id:'building',kind:'tower',x:165,y:0};
  const corpse:CombatUnit={...structuredClone(enemies[0]??template),id:'corpse',x:100,y:0,hp:0};
  const units=[u,...enemies,ally,building,corpse],events:CombatEvent[]=[],hits:{source:string;target:string;amount:number}[]=[];
  const abilities=new ExtraAbilities();
  const ctx:AbilityContext={now:0,units,navigation:nav,unit:id=>units.find(v=>v.id===id),
    hurt(v,amount,source){if(v.hp<=0||v.invulnerableUntil>ctx.now||v.returning)return 0;const dealt=Math.min(v.hp,amount*(v.guardUntil>ctx.now?.5:1));v.hp-=dealt;hits.push({source:source.id,target:v.id,amount:dealt});return dealt;},
    slow(v,factor,duration){v.slowFactor=v.slowUntil>ctx.now?Math.min(v.slowFactor,factor):factor;v.slowUntil=Math.max(v.slowUntil,ctx.now+duration);},
    emit(kind,p,extra={}){events.push({id:events.length+1,kind,x:p.x,y:p.y,...extra});}
  };
  const cast=(slot:SkillSlot,target?:Point|string)=>abilities.cast(HEROES[id].skills[slot],u,target,ctx);
  const advance=(seconds:number)=>{const until=ctx.now+seconds;while(ctx.now<until-1e-8){const dt=Math.min(.02,until-ctx.now);ctx.now+=dt;abilities.update(dt,ctx);}};
  const safe=()=>{assert.equal(ally.hp,2000,'allies are unharmed');assert.equal(building.hp,2000,'buildings are not spell targets');assert.equal(corpse.hp,0,'corpses stay dead');assert.ok(events.every(e=>e.source&&e.target),'effects identify their source and target');};
  return {abilities,ctx,u,enemies,ally,building,corpse,hits,events,cast,advance,safe};
}

test('enemy mage loses mana only on a successful empowered hit; void uses missing mana locally',()=>{
  const a=arena('antimage');const v=a.enemies[0],far=a.enemies[2];far.x=1400;
  a.cast('q');a.abilities.onAttack(a.u,v,0,a.ctx);assert.equal(v.mana,200);
  a.abilities.onAttack(a.u,v,50,a.ctx);assert.equal(v.mana,160);assert.equal(v.hp,1960);
  a.cast('r',v.id);assert.equal(v.hp,1623);assert.equal(a.enemies[1].hp,1663);assert.equal(far.hp,2000);
  a.advance(6.01);a.abilities.onAttack(a.u,v,50,a.ctx);assert.equal(v.mana,160);a.safe();
});

test('blink and leap resolve obstacles within their range and reject out-of-map nearest results',()=>{
  const nav:NavigationPort={...flat,isFree:p=>Math.abs(p.x)<=450&&Math.abs(p.y)<=450&&p.x!==300,nearest:p=>({x:Math.max(-450,Math.min(450,p.x===300?280:p.x)),y:Math.max(-450,Math.min(450,p.y))})};
  for(const id of ['antimage','mirana'] as const){const a=arena(id,1,nav);a.cast('w',{x:9999,y:0});assert.equal(a.u.x,450);assert.ok(nav.isFree(a.u));a.u.x=0;a.cast('w',{x:300,y:0});assert.equal(a.u.x,280);a.u.rootUntil=5;a.cast('w',{x:-400,y:0});assert.equal(a.u.x,280);}
  const a=arena('antimage',1,{...flat,nearest:()=>({x:4000,y:0}),isFree:()=>true});a.cast('w',{x:600,y:0});assert.equal(a.u.x,0,'nearest cannot extend a 900-unit blink to 4000');
});

test('drow ice arrows expire; gust silences and knocks back only enemies in its line',()=>{
  const a=arena('drow');const v=a.enemies[0];a.enemies[1].y=400;a.enemies[2].x=-200;
  a.cast('q');a.abilities.onAttack(a.u,v,50,a.ctx);assert.equal(v.slowFactor,.55);
  a.cast('w',{x:800,y:0});assert.equal(v.x,330);assert.ok(a.abilities.isSilenced(v,a.ctx.now));assert.equal(a.enemies[1].hp,2000);assert.equal(a.enemies[2].hp,2000);
  a.advance(6.1);assert.equal(a.abilities.isSilenced(v,a.ctx.now),false);const until=v.slowUntil;a.abilities.onAttack(a.u,v,50,a.ctx);assert.equal(v.slowUntil,until);a.safe();
});

test('multishot has three frontal rounds and stops immediately when the channel is cancelled',()=>{
  const a=arena('drow');a.enemies[1].x=-200;a.enemies[2].y=450;
  a.cast('r',{x:900,y:0});a.advance(1.25);assert.equal(a.enemies[0].hp,2000-85*3);assert.equal(a.enemies[1].hp,2000);assert.equal(a.enemies[2].hp,2000);assert.equal(a.abilities.isChanneling(a.u,a.ctx.now),false);a.safe();
  const b=arena('drow',1);b.cast('r',{x:900,y:0});b.advance(.1);b.abilities.cancel(b.u);b.advance(1.3);assert.equal(b.enemies[0].hp,1915);
});

test('lich shield halves incoming damage and pulses local slow, then ends at five seconds',()=>{
  const a=arena('lich');a.enemies[2].x=1000;a.cast('w');a.ctx.hurt(a.u,200,a.enemies[0]);assert.equal(a.u.hp,1900);a.advance(.1);assert.ok(a.enemies[0].slowUntil>a.ctx.now);assert.equal(a.enemies[2].slowUntil,0);
  a.cast('q',{x:150,y:0});assert.equal(a.enemies[0].hp,1831);assert.equal(a.enemies[2].hp,2000);
  a.advance(5);a.ctx.hurt(a.u,200,a.enemies[0]);assert.equal(a.u.hp,1700);a.safe();
});

test('chain frost bounces six times between local enemies but never repeatedly hits an isolated enemy',()=>{
  const a=arena('lich',2);a.cast('r',a.enemies[0].id);a.advance(2);assert.equal(a.hits.length,6);assert.deepEqual(a.hits.map(h=>h.target),['enemy-0','enemy-1','enemy-0','enemy-1','enemy-0','enemy-1']);a.safe();
  const b=arena('lich',2);b.enemies[1].x=1400;b.cast('r',b.enemies[0].id);b.advance(2);assert.equal(b.hits.length,1);assert.equal(b.enemies[1].hp,2000);
  const c=arena('lich',2);c.cast('r',c.enemies[0].id);c.enemies[0].x=3000;c.advance(.02);assert.equal(c.hits.length,0,'first target can escape before first impact');
});

test('pudge hook hits the first living enemy in flight and pulls to legal terrain',()=>{
  const a=arena('pudge');a.enemies[0].x=600;a.enemies[1].x=850;a.enemies[2].y=400;
  a.cast('q',{x:1000,y:0});a.advance(.1);assert.equal(a.enemies[0].hp,2000,'a hook must travel before impact');a.advance(.5);
  assert.equal(a.enemies[0].hp,1811);assert.ok(distance(a.u,a.enemies[0])<220);assert.equal(a.enemies[1].hp,2000);a.safe();
  const b=arena('pudge',1);b.enemies[0].x=600;b.cast('q',{x:1000,y:0});b.advance(.1);b.enemies[0].y=400;b.advance(1);assert.equal(b.enemies[0].hp,2000,'lateral movement dodges the hook');
});

test('rot hurts nearby enemies and its owner without self-killing, and stops on death',()=>{
  const a=arena('pudge');a.u.hp=5;a.enemies[2].x=1000;a.cast('w');a.advance(5.2);assert.equal(a.u.hp,1);assert.ok(a.enemies[0].hp<1700);assert.equal(a.enemies[2].hp,2000);const hp=a.enemies[0].hp;a.advance(1);assert.equal(a.enemies[0].hp,hp);a.safe();
  const b=arena('pudge',1);b.cast('w');b.u.hp=0;b.advance(.5);assert.equal(b.enemies[0].hp,2000);
});

test('dismember drains only its victim, heals only the caster and releases its control when interrupted',()=>{
  const a=arena('pudge',2);a.u.hp=1000;a.ally.hp=1000;const v=a.enemies[0];a.cast('r',v.id);assert.ok(a.abilities.isChanneling(a.u,0));a.advance(.5);assert.ok(v.hp<2000);assert.ok(a.u.hp>1000);assert.equal(a.ally.hp,1000);assert.equal(a.enemies[1].hp,2000);
  const hp=v.hp;a.abilities.cancel(a.u);assert.ok(v.stunUntil<=a.ctx.now);a.advance(2);assert.equal(v.hp,hp);
  const b=arena('pudge',1);b.cast('r',b.enemies[0].id);b.enemies[0].stunUntil=8;b.abilities.cancel(b.u);assert.equal(b.enemies[0].stunUntil,8,'unrelated longer stuns survive cancellation');
  const c=arena('pudge',1);c.cast('r',c.enemies[0].id);c.u.stunUntil=2;c.advance(.02);assert.equal(c.abilities.isChanneling(c.u,c.ctx.now),false);assert.equal(c.enemies[0].hp,2000);
});

test('lina delayed stun can be dodged, dragon slave pierces its line, and laguna is single-target',()=>{
  const a=arena('lina');a.enemies[2].y=500;a.cast('w',{x:150,y:0});a.advance(.5);assert.equal(a.enemies[0].hp,2000);a.enemies[0].y=600;a.advance(.12);assert.equal(a.enemies[0].hp,2000);assert.equal(a.enemies[1].hp,1820);assert.ok(a.enemies[1].stunUntil>a.ctx.now);
  a.cast('q',{x:950,y:0});assert.equal(a.enemies[1].hp,1631);assert.equal(a.enemies[2].hp,2000);
  a.cast('r',a.enemies[1].id);assert.equal(a.enemies[1].hp,1211);a.safe();
});

test('mirana arrow can be dodged and rewards long-range hits with a longer stun; starfall is local',()=>{
  const near=arena('mirana',1),far=arena('mirana',1);near.enemies[0].x=300;far.enemies[0].x=1000;
  near.cast('q',{x:1200,y:0});far.cast('q',{x:1200,y:0});near.advance(.7);far.advance(.7);assert.equal(near.enemies[0].hp,1851);assert.equal(far.enemies[0].hp,1851);assert.ok(far.enemies[0].stunUntil-far.ctx.now>near.enemies[0].stunUntil-near.ctx.now);
  const a=arena('mirana');a.enemies[2].x=1000;a.cast('r');assert.equal(a.enemies[0].hp,1754);assert.equal(a.enemies[2].hp,2000);a.safe();
});

test('furion teleport waits two seconds, respects cancellation and terrain; sprout roots without damage',()=>{
  const a=arena('furion',1);a.cast('q',a.enemies[0].id);assert.equal(a.enemies[0].rootUntil,3);assert.equal(a.enemies[0].hp,2000);
  a.cast('w',{x:3000,y:0});a.advance(1.9);assert.equal(a.u.x,0);a.advance(.12);assert.equal(a.u.x,3000);assert.equal(a.abilities.isChanneling(a.u,a.ctx.now),false);
  a.cast('w',{x:0,y:0});a.advance(1);a.abilities.cancel(a.u);a.advance(2);assert.equal(a.u.x,3000);
  const b=arena('furion',1);b.cast('w',{x:3000,y:0});b.u.stunUntil=1;b.advance(2.1);assert.equal(b.u.x,0);
});

test('wrath visits at most six distinct local enemies, never an isolated global target',()=>{
  const a=arena('furion',8);a.enemies.forEach((v,i)=>{v.x=300+i*350;});a.enemies[7].x=6000;
  a.cast('r',a.enemies[0].id);a.advance(2.5);assert.equal(a.hits.length,6);assert.equal(new Set(a.hits.map(h=>h.target)).size,6);assert.equal(a.enemies[6].hp,2000);assert.equal(a.enemies[7].hp,2000);a.safe();
});

test('earthshaker fissure controls a line; enchant is consumed once including a killing blow; echo scales with enemy count',()=>{
  const a=arena('earthshaker');a.enemies[2].y=500;a.cast('q',{x:900,y:0});assert.ok(a.enemies[0].stunUntil>0);assert.equal(a.enemies[2].hp,2000);a.cast('w');a.enemies[0].hp=0;a.abilities.onAttack(a.u,a.enemies[0],50,a.ctx);const hp=a.enemies[1].hp;assert.ok(hp<1836);a.abilities.onAttack(a.u,a.enemies[1],50,a.ctx);assert.equal(a.enemies[1].hp,hp);a.safe();
  const solo=arena('earthshaker',1),crowd=arena('earthshaker',4);solo.cast('r');crowd.cast('r');assert.ok(crowd.enemies[0].hp<solo.enemies[0].hp);crowd.safe();
});

test('shaman shock is frontal, hex interrupts channeling, and serpent wards attack only live local enemies until expiry',()=>{
  const a=arena('shaman');a.enemies[1].x=-200;a.enemies[2].y=500;a.cast('q',{x:800,y:0});assert.equal(a.enemies[0].hp,1821);assert.equal(a.enemies[1].hp,2000);assert.equal(a.enemies[2].hp,2000);
  const v=a.enemies[0];a.abilities.cast(HEROES.furion.skills.w,v,{x:2000,y:0},a.ctx);assert.ok(a.abilities.isChanneling(v,0));a.cast('w',v.id);assert.equal(v.stunUntil,3);assert.ok(a.abilities.isSilenced(v,0));assert.equal(a.abilities.isChanneling(v,0),false);
  a.enemies[1].x=1800;a.enemies[2].x=2000;a.cast('r',{x:100,y:0});a.advance(.1);assert.ok(v.hp<1821);assert.equal(a.enemies[1].hp,2000);assert.equal(a.enemies[2].hp,2000);a.advance(8);const hp=v.hp;a.advance(1);assert.equal(v.hp,hp);a.safe();
});

test('all targeted extras ignore allies, structures, corpses and missing targets; reset clears every pending ability',()=>{
  for(const id of ['antimage','lich','pudge','lina','furion','shaman'] as const){const a=arena(id,1);for(const slot of ['q','w','r'] as const)if(HEROES[id].skills[slot].target==='enemy')for(const target of [a.ally.id,a.building.id,a.corpse.id,'missing'])a.cast(slot,target);a.advance(3);assert.equal(a.hits.length,0);a.safe();}
  const a=arena('pudge',1);a.cast('q',{x:1000,y:0});a.cast('w');a.cast('r',a.enemies[0].id);a.abilities.clear();a.advance(6);assert.equal(a.hits.length,0);assert.equal(a.enemies[0].stunUntil,0);assert.equal(a.abilities.isChanneling(a.u,a.ctx.now),false);
  const b=arena('lina',1);b.cast('w',b.enemies[0]);b.abilities.clear();b.advance(1);assert.equal(b.enemies[0].hp,2000);
});

test('the live simulation dispatches all new skills with costs and interrupts teleport through the normal move command',()=>{
  for(const id of ['antimage','drow','lich','pudge','lina','mirana','furion','earthshaker','shaman'] as const)for(const slot of ['q','w','r'] as const){
    const sim=new BattleSimulation(flat);sim.start(id);const u=sim.hero,v=sim.unit('rival')!;sim.units=[u,v];Object.assign(u,{x:0,y:0,level:3,mana:2000,maxMana:2000});Object.assign(v,{x:150,y:0,hp:2000,maxHp:2000});
    const skill=HEROES[id].skills[slot],target=skill.target==='enemy'?v.id:skill.target==='point'?{x:150,y:0}:undefined;
    assert.equal(sim.cast(slot,target),true,`${id}/${slot} dispatches`);assert.equal(u.mana,2000-skill.mana);assert.equal(u.cooldowns[slot],skill.cooldown);sim.step();assert.ok(sim.drainEvents().some(e=>e.kind==='spell'||e.kind==='impact'),`${id}/${slot} emits visible effects`);
  }
  const sim=new BattleSimulation(flat);sim.start('furion');const u=sim.hero;sim.units=[u];u.x=u.y=0;assert.ok(sim.cast('w',{x:700,y:0}));for(let i=0;i<48;i++)sim.step();assert.equal(u.x,0);assert.ok(sim.move({x:-200,y:0}));for(let i=0;i<132;i++)sim.step();assert.ok(Math.abs(u.x+200)<12,'normal movement cancels a pending teleport and arrives within movement tolerance');
});

test('hazards are immutable snapshots of released missiles and delayed strike warnings, never planned targets',()=>{
  const a=arena('mirana',1);a.enemies[0].y=600;
  assert.deepEqual(a.abilities.hazards(a.ctx.now),[]);
  a.cast('q',{x:1200,y:0});const initial=a.abilities.hazards(0);assert.equal(initial.length,1);assert.ok(Object.isFrozen(initial));assert.ok(Object.isFrozen(initial[0]));
  const missile=initial[0];assert.equal(missile.kind,'missile');if(missile.kind!=='missile')throw new Error('expected missile');
  assert.equal(missile.source,a.u.id);assert.equal(missile.x,0);assert.equal(missile.speed,1500);assert.equal(missile.remaining,1200);assert.ok(Object.isFrozen(missile.direction));
  a.advance(.1);const next=a.abilities.hazards(a.ctx.now)[0];assert.ok(next.x>100);assert.equal(missile.x,0,'old snapshots do not change with simulation state');
  a.advance(.8);assert.deepEqual(a.abilities.hazards(a.ctx.now),[]);
  const b=arena('lina',1);b.cast('w',{x:350,y:200});const area=b.abilities.hazards(0)[0];assert.deepEqual(area,{source:b.u.id,kind:'area',x:350,y:200,radius:250,impactAt:.6,expiresAt:.6});
  assert.deepEqual(b.abilities.hazards(.6),[]);b.abilities.clear();assert.deepEqual(b.abilities.hazards(0),[]);
  const c=arena('pudge',1);c.cast('q',{x:1000,y:0});c.advance(.1);assert.deepEqual(c.abilities.hazards(c.ctx.now),[],'an impacted hook stops being a hazard immediately');
});

test('warning and control visuals match their lifetimes; serpent wards create exactly four models for eight seconds',()=>{
  const lina=arena('lina',1);lina.cast('w',{x:150,y:0});assert.equal(lina.events.find(e=>e.effect==='ward')?.duration,.6);
  const furion=arena('furion',1);furion.cast('q',furion.enemies[0].id);assert.equal(furion.events.find(e=>e.effect==='ward')?.duration,3);furion.events.length=0;furion.cast('w',{x:500,y:0});assert.equal(furion.events.find(e=>e.effect==='ward')?.duration,2);
  const shaman=arena('shaman',1);shaman.cast('r',{x:150,y:0});let models=shaman.events.filter(e=>e.effect==='ward');assert.equal(models.length,4);assert.ok(models.every(e=>e.duration===8));assert.equal(new Set(models.map(e=>`${e.x},${e.y}`)).size,4);
  shaman.advance(8.2);models=shaman.events.filter(e=>e.effect==='ward');assert.equal(models.length,4,'firing does not create extra overlapping ward models');assert.ok(shaman.events.some(e=>e.kind==='attack'));assert.ok(shaman.events.some(e=>e.kind==='impact'));
});
