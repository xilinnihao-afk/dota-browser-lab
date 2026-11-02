import test from 'node:test';
import assert from 'node:assert/strict';
import {HEROES,type HeroId,type SkillSlot} from '../src/classic/battle/definitions';
import {distance} from '../src/classic/battle/navigation';
import type {CombatUnit,NavigationPort} from '../src/classic/battle/simulation';
import type {AbilityHazard} from '../src/classic/battle/extra-abilities';
import {chooseRivalSkill,evasiveDestination,hazardEvasionDestination,shouldRecover} from '../src/classic/battle/rival-tactics';

const flat:NavigationPort={nearest:p=>({...p}),findPath:(_,p)=>[{...p}],lineFree:()=>true,isFree:()=>true};
function unit(id:HeroId='axe',patch:Partial<CombatUnit>={}):CombatUnit {
  const h=HEROES[id];
  return {
    x:0,y:0,id:'rival',model:id,heroId:id,name:h.name,team:1,kind:'hero',hp:h.hp,maxHp:h.hp,mana:h.mana,maxMana:h.mana,
    damage:h.damage,range:h.range,speed:h.speed,attackPeriod:h.attackPeriod,radius:32,scale:1,level:3,xp:0,facing:0,
    action:'idle',actionSerial:0,actionUntil:0,order:'idle',destination:null,targetId:null,path:[],repathAt:0,attackAt:0,pendingHit:null,
    deadAt:-1,respawnAt:0,rootUntil:0,slowUntil:0,tauntUntil:0,tauntId:null,guardUntil:0,invulnerableUntil:0,spinUntil:0,stormUntil:0,nextPulse:0,
    cooldowns:{q:0,w:0,r:0},castSerial:0,spell:'',armor:0,slowFactor:.5,stunUntil:0,frostReadyAt:0,...patch
  };
}
function enemy(patch:Partial<CombatUnit>={}){return unit('juggernaut',{id:'enemy',team:0,x:150,...patch});}

test('low health or mana starts recovery; committed return waits for both resources',()=>{
  const u=unit();assert.equal(shouldRecover(u,false),false);
  u.hp=u.maxHp*.32;assert.equal(shouldRecover(u,false),true);
  u.hp=u.maxHp;u.mana=u.maxMana*.18;assert.equal(shouldRecover(u,false),true);
  u.hp=u.maxHp*.89;u.mana=u.maxMana*.9;assert.equal(shouldRecover(u,true),true);assert.equal(shouldRecover(u,false),false);
  u.hp=u.maxHp*.9;u.mana=u.maxMana*.81;assert.equal(shouldRecover(u,true),true);
  u.mana=u.maxMana*.82;assert.equal(shouldRecover(u,true),false);
  u.hp=0;assert.equal(shouldRecover(u,true),false);
  Object.assign(u,{hp:u.maxHp,maxMana:0,mana:0});assert.equal(shouldRecover(u,false),false);
});

test('evasion walks clear of a visible blade storm or freezing field without mutating state',()=>{
  for(const aura of ['spinUntil','stormUntil']as const){
    const u=unit(),e=enemy({[aura]:10,x:100}),before=structuredClone([u,e]);
    const p=evasiveDestination(u,[e],flat,1);assert.ok(p);
    assert.ok(distance(p,e)>(aura==='spinUntil'?285:500)+u.radius);assert.ok(distance(p,u)<=660);
    assert.deepEqual([u,e],before);
  }
});
test('only visible threats influence evasion, including supplied line-of-sight occlusion',()=>{
  const u=unit(),e=enemy({spinUntil:10});
  assert.equal(evasiveDestination(u,[],flat,1),undefined);
  assert.equal(evasiveDestination(u,[e],{...flat,lineVisible:()=>false},1),undefined);
  assert.equal(evasiveDestination(u,[{...e,team:1}],flat,1),undefined);
});
test('evasion preserves the imminent attack and respects movement control effects',()=>{
  for(const patch of [{pendingHit:{id:'enemy',at:1.1}},{rootUntil:3},{stunUntil:3},{tauntUntil:3},{invulnerableUntil:3},{stormUntil:3}]){
    assert.equal(evasiveDestination(unit('maiden',patch),[enemy({spinUntil:10})],flat,1),undefined);
  }
});
test('ranged heroes create space from melee pursuers without retreating from ordinary ranged fire',()=>{
  const u=unit('maiden'),e=enemy({x:200});
  const p=evasiveDestination(u,[e],flat,1);assert.ok(p);assert.ok(distance(p,e)>distance(u,e));
  e.range=600;assert.equal(evasiveDestination(u,[e],flat,1),undefined);
  e.range=110;e.x=500;assert.equal(evasiveDestination(u,[e],flat,1),undefined);
});
test('a ready lethal ranged attack finishes a close melee enemy instead of repeatedly kiting it',()=>{
  const u=unit('maiden'),e=enemy({x:180,hp:1});
  assert.equal(evasiveDestination(u,[e],flat,1),undefined);
  u.attackAt=2;assert.ok(evasiveDestination(u,[e],flat,1),'an unavailable attack is not a finishing opportunity');
  u.attackAt=0;u.actionUntil=2;assert.ok(evasiveDestination(u,[e],flat,1));
  u.actionUntil=0;e.armor=100;e.hp=6;assert.ok(evasiveDestination(u,[e],flat,1),'armor can make the apparent kill nonlethal');
  e.hp=5;assert.equal(evasiveDestination(u,[e],flat,1),undefined);
  e.guardUntil=3;assert.ok(evasiveDestination(u,[e],flat,1),'guard reduces actual attack damage again');
  e.hp=1;e.invulnerableUntil=3;assert.ok(evasiveDestination(u,[e],flat,1));
});
test('a one-hit enemy still forces evasion when a damaging aura remains active',()=>{
  const u=unit('maiden'),e=enemy({x:180,hp:1});
  for(const aura of ['spinUntil','stormUntil']as const){const threat={...e,[aura]:4};assert.ok(evasiveDestination(u,[threat],flat,1));}
});
test('a wall causes a safe sideways escape; fully blocked terrain never snaps elsewhere',()=>{
  const u=unit(),e=enemy({spinUntil:10,x:100});
  const nav={...flat,nearest:()=>{throw new Error('evasion must not snap');},lineFree:(_a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(b.y)>40};
  const p=evasiveDestination(u,[e],nav,1);assert.ok(p);assert.ok(Math.abs(p.y)>40);assert.ok(distance(p,e)>distance(u,e));
  assert.equal(evasiveDestination(u,[e],{...nav,isFree:()=>false},1),undefined);
});
test('evasion does not step from a spell into a previously safe enemy tower range',()=>{
  const u=unit(),e=enemy({x:100,spinUntil:10}),tower=enemy({id:'tower',kind:'tower',x:-600,range:300});
  const p=evasiveDestination(u,[e,tower],flat,1);assert.ok(p);assert.ok(distance(p,tower)>tower.range+u.radius);
});

test('axe spends his ultimate to finish a visible enemy within range',()=>{
  const u=unit(),e=enemy({hp:100});
  assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,false),{slot:'r',target:e.id});
  e.x=400;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  e.x=150;e.hp=e.maxHp;assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,false),{slot:'q'});
});
test('axe reserves taunt for a nearby hero or group and follows with the real helix skill',()=>{
  const u=unit(),e=enemy({kind:'melee',hp:500,maxHp:500});
  assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  const second=enemy({id:'second',kind:'melee',hp:500,maxHp:500,y:50});
  assert.deepEqual(chooseRivalSkill(u,e,[e,second],[u],1,false),{slot:'q'});
  u.cooldowns.q=10;assert.deepEqual(chooseRivalSkill(u,e,[e,second],[u],1,false),{slot:'w'});
});
test('self-centered offensive skills are never wasted on empty space or structures',()=>{
  for(const id of Object.keys(HEROES)as HeroId[]){
    const u=unit(id),e=enemy({x:1500});
    assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
    e.x=100;e.kind='tower';assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  }
});
test('unseen preferred target, invulnerable enemy, or returning neutral cannot cause a cast',()=>{
  const u=unit(),e=enemy({hp:100});
  assert.equal(chooseRivalSkill(u,e,[],[u],1,false),undefined);
  e.invulnerableUntil=3;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  e.invulnerableUntil=0;e.returning=true;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
});
test('juggernaut heals injured allies of his own team, including while escaping',()=>{
  const u=unit('juggernaut'),ally=unit('axe',{id:'ally',x:100,hp:400}),e=enemy({hp:100});
  assert.equal(chooseRivalSkill(u,undefined,[],[u,e],1,false),undefined);
  assert.deepEqual(chooseRivalSkill(u,undefined,[],[u,ally],1,false),{slot:'w'});
  ally.x=1000;assert.equal(chooseRivalSkill(u,undefined,[],[u,ally],1,false),undefined);
  u.hp=300;assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,true),{slot:'w'});
});
test('juggernaut uses the unlocked slash then spin in contact, but never slashes into an escape',()=>{
  const u=unit('juggernaut'),e=enemy({x:500});
  assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,false),{slot:'r',target:e.id});
  assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
  u.level=1;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  e.x=150;assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,false),{slot:'q'});
  u.spinUntil=3;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
});
test('maiden roots a pursuer and slows its visible position if root is unavailable',()=>{
  const u=unit('maiden'),e=enemy({x:600});
  assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,true),{slot:'w',target:e.id});
  e.rootUntil=3;assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,true),{slot:'q',target:{x:600,y:0}});
  e.x=900;assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
});
test('maiden channels only with nearby targets and sufficient health, never while retreating',()=>{
  const u=unit('maiden',{cooldowns:{q:10,w:10,r:0}}),e=enemy({x:200});
  assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,false),{slot:'r'});
  assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
  u.hp=200;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  u.hp=u.maxHp;e.x=480;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  e.rootUntil=3;assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,false),{slot:'r'});
  e.spinUntil=3;e.x=200;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
});
test('nova selects an in-range cluster instead of a lone healthy creep',()=>{
  const u=unit('maiden',{level:1,cooldowns:{q:0,w:10,r:0}}),a=enemy({id:'a',x:700,kind:'melee',hp:400,maxHp:400}),b=enemy({id:'b',x:800,kind:'melee',hp:400,maxHp:400});
  assert.equal(chooseRivalSkill(u,a,[a],[u],1,false),undefined);
  const cast=chooseRivalSkill(u,a,[a,b],[u],1,false);assert.equal(cast?.slot,'q');assert.ok(cast?.target&&typeof cast.target!=='string');
  assert.ok(distance(u,cast.target)<=HEROES.maiden.skills.q.range);
});
test('all decisions honor mana, cooldowns, stun, taunt, cast animation, and committed hits',()=>{
  const e=enemy({hp:100});
  for(const id of Object.keys(HEROES)as HeroId[]){
    for(const patch of [{mana:0},{cooldowns:{q:20,w:20,r:20}},{stunUntil:3},{tauntUntil:3},{invulnerableUntil:3},{action:'cast' as const,actionUntil:3},{pendingHit:{id:e.id,at:1.1}}]){
      assert.equal(chooseRivalSkill(unit(id,patch),e,[e],[],1,false),undefined);
    }
  }
});
test('skill selection leaves units, cooldowns, and supplied list ordering untouched',()=>{
  const u=unit('maiden'),e=enemy(),a=enemy({id:'second',x:500}),enemies=[a,e],allies=[u],before=structuredClone({u,enemies,allies});
  chooseRivalSkill(u,e,enemies,allies,1,false);assert.deepEqual({u,enemies,allies},before);
});

function only(u:CombatUnit,slot:SkillSlot){u.cooldowns={q:100,w:100,r:100};u.cooldowns[slot]=0;return u;}
const newHeroes:HeroId[]=['antimage','drow','lich','pudge','lina','mirana','furion','earthshaker','shaman'];
const exercises:{hero:HeroId;slot:SkillSlot;range:number;retreat?:boolean;more?:boolean;enemy?:Partial<CombatUnit>}[]=[
  {hero:'antimage',slot:'q',range:100},{hero:'antimage',slot:'w',range:300,retreat:true},{hero:'antimage',slot:'r',range:500,enemy:{mana:0}},
  {hero:'drow',slot:'q',range:500},{hero:'drow',slot:'w',range:200},{hero:'drow',slot:'r',range:600},
  {hero:'lich',slot:'q',range:600},{hero:'lich',slot:'w',range:180},{hero:'lich',slot:'r',range:500,more:true},
  {hero:'pudge',slot:'q',range:600},{hero:'pudge',slot:'w',range:160},{hero:'pudge',slot:'r',range:180},
  {hero:'lina',slot:'q',range:600},{hero:'lina',slot:'w',range:500},{hero:'lina',slot:'r',range:500,enemy:{hp:200}},
  {hero:'mirana',slot:'q',range:850},{hero:'mirana',slot:'w',range:160},{hero:'mirana',slot:'r',range:350},
  {hero:'furion',slot:'q',range:500},{hero:'furion',slot:'w',range:1080,retreat:true},{hero:'furion',slot:'r',range:500,more:true},
  {hero:'earthshaker',slot:'q',range:500},{hero:'earthshaker',slot:'w',range:100},{hero:'earthshaker',slot:'r',range:350,more:true},
  {hero:'shaman',slot:'q',range:600},{hero:'shaman',slot:'w',range:500},{hero:'shaman',slot:'r',range:500},
];
for(const example of exercises)test(`${example.hero} chooses ${example.slot} for its actual intended combat situation`,()=>{
  const u=only(unit(example.hero),example.slot),e=enemy({x:example.range,...example.enemy});
  const enemies=example.more?[e,enemy({id:'second',kind:'melee',x:e.x+50,y:80})]:[e];
  const before=structuredClone({u,enemies});
  const choice=chooseRivalSkill(u,e,enemies,[u],1,example.retreat??false);
  assert.equal(choice?.slot,example.slot);
  if(choice?.target&&typeof choice.target==='object')assert.ok(distance(u,choice.target)<=HEROES[example.hero].skills[example.slot].range);
  if(typeof choice?.target==='string')assert.ok(enemies.some(v=>v.id===choice.target));
  assert.deepEqual({u,enemies},before);
});
test('every newly added ultimate remains locked before level three',()=>{
  for(const example of exercises.filter(example=>example.slot==='r')){
    const u=only(unit(example.hero,{level:2}),'r'),e=enemy({x:example.range,...example.enemy});
    assert.equal(chooseRivalSkill(u,e,[e,enemy({id:'second',kind:'melee',x:e.x+50})],[u],1,false),undefined,example.hero);
  }
});
test('the nine new heroes ignore a preferred enemy absent from their visible list',()=>{
  for(const id of newHeroes){const u=unit(id),e=enemy();assert.equal(chooseRivalSkill(u,e,[],[u],1,false),undefined,id);}
});
test('anti-mage blink and furion teleport are reserved for local retreat destinations',()=>{
  for(const id of ['antimage','furion']as const){
    const u=only(unit(id),'w'),e=enemy({x:1080});
    assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
    const choice=chooseRivalSkill(u,e,[e],[u],1,true);assert.equal(choice?.slot,'w');
    assert.ok(choice?.target&&typeof choice.target==='object');assert.ok(distance(u,choice.target)<=700);
    assert.ok(distance(choice.target,e)>distance(u,e));
  }
});
test('movement spells respect roots and never intentionally land inside a visible enemy tower',()=>{
  for(const id of ['antimage','mirana','furion']as const){
    const u=only(unit(id,{rootUntil:3}),'w'),e=enemy({x:1080});
    assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
    u.rootUntil=0;e.x=150;
    const tower=enemy({id:'tower',kind:'tower',x:-650,range:450,speed:0});
    const choice=chooseRivalSkill(u,e,[e,tower],[u],1,true);
    if(choice){assert.ok(choice.target&&typeof choice.target==='object');assert.ok(distance(choice.target,tower)>tower.range+u.radius);}
  }
});
test('furion refuses unsafe teleport channels, roots a pursuer, then can teleport out of its reach',()=>{
  const u=unit('furion'),e=enemy({x:400});
  assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,true),{slot:'q',target:e.id});
  e.rootUntil=4;assert.equal(chooseRivalSkill(u,e,[e],[u],1,true)?.slot,'w');
  e.x=100;assert.notEqual(chooseRivalSkill(u,e,[e],[u],1,true)?.slot,'w');
  e.x=700;e.rootUntil=0;e.range=600;assert.notEqual(chooseRivalSkill(u,e,[e],[u],1,true)?.slot,'w');
});
test('furion may shorten a safe return route but cannot teleport without a known route or threat',()=>{
  const u=only(unit('furion',{destination:{x:-4000,y:0}}),'w');
  const choice=chooseRivalSkill(u,undefined,[],[u],1,true);assert.equal(choice?.slot,'w');
  assert.ok(choice?.target&&typeof choice.target==='object');assert.ok(distance(choice.target,{x:-700,y:0})<.0001);
  u.destination=null;assert.equal(chooseRivalSkill(u,undefined,[],[u],1,true),undefined);
});
test('frost arrows, mana break, and enchant require a nearby real attack target',()=>{
  for(const [id,slot]of [['drow','q'],['antimage','q'],['earthshaker','w']]as const){
    const u=only(unit(id),slot),e=enemy({x:1000});
    assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
    e.x=100;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false)?.slot,slot);
    assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
  }
});
test('drow knocks back a close pursuer and never starts a stationary volley while escaping',()=>{
  const u=unit('drow'),e=enemy({x:180});
  assert.deepEqual(chooseRivalSkill(u,e,[e],[u],1,true),{slot:'w',target:{x:180,y:0}});
  only(u,'r');assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
  assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  e.x=650;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false)?.slot,'r');
});
test('pudge does not spend health on rot or hold a dismember channel during retreat',()=>{
  const u=unit('pudge'),e=enemy({x:150});
  assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
  only(u,'w');u.hp=u.maxHp*.5;assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
  only(u,'r');u.hp=u.maxHp;
  assert.equal(chooseRivalSkill(u,e,[e,enemy({id:'other',x:300})],[u],1,false),undefined);
});
test('mana void rewards missing mana and laguna accounts for active damage reduction',()=>{
  const anti=only(unit('antimage'),'r'),e=enemy({x:500});
  assert.equal(chooseRivalSkill(anti,e,[e],[anti],1,false),undefined);
  e.mana=0;assert.deepEqual(chooseRivalSkill(anti,e,[e],[anti],1,false),{slot:'r',target:e.id});
  const lina=only(unit('lina'),'r');e.hp=300;e.guardUntil=3;
  assert.equal(chooseRivalSkill(lina,e,[e],[lina],1,false),undefined);
  e.hp=200;assert.equal(chooseRivalSkill(lina,e,[e],[lina],1,false)?.slot,'r');
});
test('chain frost and wrath seek visible bounce partners instead of wasting a chain on one healthy unit',()=>{
  for(const id of ['lich','furion']as const){
    const u=only(unit(id),'r'),e=enemy({x:500});
    assert.equal(chooseRivalSkill(u,e,[e],[u],1,false),undefined);
    assert.equal(chooseRivalSkill(u,e,[e,enemy({id:'partner',x:600})],[u],1,false)?.slot,'r');
  }
});
test('hex and sprout do not overlap a long existing disable',()=>{
  for(const [id,slot]of [['shaman','w'],['furion','q']]as const){
    const u=only(unit(id),slot),e=enemy({x:400,rootUntil:4});
    assert.equal(chooseRivalSkill(u,e,[e],[u],1,true),undefined);
    e.rootUntil=0;assert.equal(chooseRivalSkill(u,e,[e],[u],1,true)?.slot,slot);
  }
});
test('hook and sacred arrow account for a visible creep intercepting the shot',()=>{
  for(const id of ['pudge','mirana']as const){
    const u=only(unit(id),'q'),e=enemy({x:750}),blocker=enemy({id:'blocker',kind:'melee',x:400,hp:500,maxHp:500});
    assert.equal(chooseRivalSkill(u,e,[e,blocker],[u],1,false),undefined);
    blocker.y=300;assert.equal(chooseRivalSkill(u,e,[e,blocker],[u],1,false)?.slot,'q');
  }
});

function missile(patch:Partial<Extract<AbilityHazard,{kind:'missile'}>>={}):Extract<AbilityHazard,{kind:'missile'}>{
  return{source:'enemy',kind:'missile',x:-900,y:0,direction:{x:1,y:0},speed:1500,remaining:1200,radius:90,expiresAt:2,...patch};
}
function warning(patch:Partial<Extract<AbilityHazard,{kind:'area'}>>={}):Extract<AbilityHazard,{kind:'area'}>{
  return{source:'enemy',kind:'area',x:200,y:0,radius:250,impactAt:1.6,expiresAt:1.6,...patch};
}
function walkedPosition(u:CombatUnit,p:{x:number;y:number},elapsed:number){
  const ratio=Math.min(1,u.speed*(u.slowUntil>1?u.slowFactor:1)*elapsed/distance(u,p));
  return{x:u.x+(p.x-u.x)*ratio,y:u.y+(p.y-u.y)*ratio};
}
test('visible arrow and hook are dodged by a normal-speed lateral walk before contact',()=>{
  for(const radius of [90,100]){
    const u=unit('maiden'),shot=missile({radius}),before=structuredClone({u,shot}),p=hazardEvasionDestination(u,[shot],flat,1);
    assert.ok(p);assert.ok(Math.abs(p.y)>radius+u.radius);assert.ok(distance(u,p)<300);
    for(let elapsed=0;elapsed<=shot.remaining/shot.speed;elapsed+=1/600){
      const hero=walkedPosition(u,p,elapsed),projectile={x:shot.x+elapsed*shot.speed,y:shot.y};
      assert.ok(distance(hero,projectile)>radius+u.radius,'walking path must clear the moving collision radius');
    }
    assert.deepEqual({u,shot},before);
  }
});
test('missile evasion uses the open side of terrain and refuses inaccessible escape points',()=>{
  const u=unit('maiden'),shot=missile(),nav={...flat,lineFree:(_a:{x:number;y:number},b:{x:number;y:number})=>b.y<0};
  const p=hazardEvasionDestination(u,[shot],nav,1);assert.ok(p&&p.y<0);
  assert.equal(hazardEvasionDestination(u,[shot],{...flat,isFree:()=>false},1),undefined);
});
test('hazard evasion never reacts to unseen, expired, receding, or short-range projectiles',()=>{
  const u=unit('maiden'),shot=missile();
  assert.equal(hazardEvasionDestination(u,[],flat,1),undefined);
  assert.equal(hazardEvasionDestination(u,[shot],{...flat,lineVisible:()=>false},1),undefined);
  for(const candidate of [missile({expiresAt:.9}),missile({direction:{x:-1,y:0}}),missile({remaining:300}),missile({y:400})]){
    assert.equal(hazardEvasionDestination(u,[candidate],flat,1),undefined);
  }
});
test('an unavoidable near projectile cannot produce a fake instantaneous escape',()=>{
  const u=unit('maiden');
  assert.equal(hazardEvasionDestination(u,[missile({x:-200})],flat,1),undefined);
  u.slowUntil=3;u.slowFactor=.3;
  assert.equal(hazardEvasionDestination(u,[missile()],flat,1),undefined);
});
test('hazard dodges preserve imminent attack hits and obey root, stun, and active channel controls',()=>{
  for(const patch of [{pendingHit:{id:'enemy',at:1.2}},{rootUntil:3},{stunUntil:3},{tauntUntil:3},{invulnerableUntil:3},{stormUntil:3}]){
    assert.equal(hazardEvasionDestination(unit('maiden',patch),[missile()],flat,1),undefined);
  }
});
test('the hero leaves a visible delayed blast radius before its impact time',()=>{
  const u=unit('maiden'),area=warning(),p=hazardEvasionDestination(u,[area],flat,1);assert.ok(p);
  assert.ok(distance(walkedPosition(u,p,area.impactAt-1),area)>area.radius+u.radius);
  assert.equal(hazardEvasionDestination(u,[warning({impactAt:1.05,expiresAt:1.05})],flat,1),undefined);
  assert.equal(hazardEvasionDestination(u,[warning({impactAt:.9,expiresAt:.9})],flat,1),undefined);
  assert.equal(hazardEvasionDestination(u,[warning({x:600})],flat,1),undefined);
});
test('leaving one warning cannot run into another visible warning that was initially safe',()=>{
  const u=unit('maiden'),areas=[warning(),warning({x:-180,radius:100})],p=hazardEvasionDestination(u,areas,flat,1);
  assert.ok(p);
  for(const area of areas)assert.ok(distance(walkedPosition(u,p,area.impactAt-1),area)>area.radius+u.radius);
});
