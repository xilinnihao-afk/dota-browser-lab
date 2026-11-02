import fs from 'node:fs';
import assert from 'node:assert/strict';
import {MapNavigation,distance}from'../src/classic/battle/navigation';
import {BattleSimulation}from'../src/classic/battle/simulation';
import {HEROES,type HeroId,type SkillSlot}from'../src/classic/battle/definitions';
import {CAMPS}from'../src/classic/battle/world';
import {STARTING_GOLD,itemById} from '../src/classic/battle/economy';
import {isStructure} from '../src/classic/battle/structures';
const map=JSON.parse(fs.readFileSync(new URL('../public/assets/imba/map.json',import.meta.url),'utf8'));
const nav=new MapNavigation(map,fs.readFileSync(new URL('../public/assets/imba/pathing.wpm',import.meta.url)));
const results=[];
const survey=process.argv.includes('--survey');
const output=process.env.DOTA_PLAYTEST_OUTPUT??new URL('../artifacts/imba-base/',import.meta.url);
fs.mkdirSync(output,{recursive:true});
const report=(name:string,value:unknown)=>fs.writeFileSync(typeof output==='string'?output+'/'+name:new URL(name,output),JSON.stringify(value,null,2));
const selected=process.env.DOTA_PLAYTEST_HEROES?.split(',')??Object.keys(HEROES);
assert.ok(selected.every(id=>id in HEROES),'unknown playtest hero');
for(const id of (process.argv.includes('--farm-only')?[]:selected)as HeroId[]){const sim=new BattleSimulation(nav,CAMPS);sim.start(id);sim.buy('claws');sim.buy('armor');let casts=0,recovering=false;const samples=[];
  for(let i=0;i<60*900&&sim.phase==='playing';i++){
    if(i%30===0&&sim.hero.hp>0){const h=sim.hero;for(const item of ['armor','vampire','sword','orbSlow','vitality'])if(!sim.inventory.includes(item))sim.buy(item);
      if(survey&&h.hp<h.maxHp*.25&&!recovering){recovering=sim.recover();}
      if(recovering&&sim.inFountain(h)&&h.hp>=h.maxHp*.9&&h.mana>=h.maxMana*.8)recovering=false;
      const channeling=h.stormUntil>sim.time||sim.extraAbilities.isChanneling(h,sim.time);
      const close=sim.units.filter(u=>u.team===1&&u.hp>0&&!isStructure(u)&&distance(u,h)<850).sort((a,b)=>distance(a,h)-distance(b,h))[0],target=close??sim.objective(0,h);
      if(target&&!recovering&&!channeling){if(h.targetId!==target.id)sim.attack(target.id);const d=distance(target,h);for(const slot of ['q','w','r']as SkillSlot[]){const def=HEROES[id].skills[slot];
        if(['blink','leap','teleport'].includes(def.id)&&(d<h.range+100||d>def.range))continue;
        if(def.id==='ward'&&h.hp>h.maxHp*.8)continue;
        if((def.target==='self'&&d<Math.max(def.radius,h.range+80))||(def.target!=='self'&&!isStructure(target)))casts+=Number(sim.cast(slot,def.target==='point'?{x:target.x,y:target.y}:def.target==='enemy'?target.id:undefined));
      }}
    }
    sim.step();sim.drainEvents();if(i%600===0)samples.push({time:Math.round(sim.time),level:sim.hero.level,kills:sim.kills,deaths:sim.deaths,units:sim.units.length});
    for(const u of sim.units)if(u.hp>0&&!isStructure(u))assert.ok(nav.isFree(u),u.id+' left walkable terrain');
  }
  const rival=sim.unit('rival')!;
  const result={hero:id,phase:sim.phase,time:Math.round(sim.time),level:sim.hero.level,kills:sim.kills,deaths:sim.deaths,casts,enemyBaseHp:sim.unit('base-1')!.hp,enemyTowersRemaining:sim.units.filter(u=>u.team===1&&u.kind==='tower'&&u.hp>0).length,rival:{hero:rival.heroId,level:rival.level,casts:rival.castSerial,earned:sim.rivalGoldEarned,gold:sim.rivalGold,inventory:sim.rivalInventory,mode:sim.rivalMode},samples};
  results.push(result);report('simulation-playthroughs.json',{source:map.source,survey,method:'Original WPM, normal buy/attack/cast/recover commands; no stat or position mutation. Survey records wins, losses and 900-second timeouts without requiring a naive bot to defeat the stronger AI.',results});
  if(!survey)assert.equal(result.phase,'won',id+' must be able to complete the encounter');assert.ok(result.level>=3);assert.ok(casts>3);console.log(result.hero,result.phase,result.time+'s','level '+result.level,result.kills+' kills');
}

const farm=new BattleSimulation(nav,CAMPS);farm.start('juggernaut');assert.ok(farm.buy('tango'));let farmPurchaseSpend=itemById('tango')!.cost;
const farmResults=[];let vampHeals=0,slowHits=0,neutralGold=0,rivalKills=0,contestedKills=0,contestedGold=0;
const farmRoute=['south','west','northwest','northeast'];
for(const campId of farmRoute){
  const camp=farm.camps.find(c=>c.definition.id===campId)!;assert.ok(farm.goToCamp(campId));const deadline=farm.time+180,before={gold:farm.gold,xp:farm.hero.xp,level:farm.hero.level,kills:farm.neutralKills};
  while(farm.phase==='playing'&&farm.time<deadline&&camp.unitIds.some(id=>(farm.unit(id)?.hp??0)>0)){
    const h=farm.hero,targets=camp.unitIds.map(id=>farm.unit(id)).filter(u=>u&&u.hp>0).sort((a,b)=>distance(a!,h)-distance(b!,h)),target=targets[0];
    for(const id of ['vampire','orbSlow']){if(farm.inventory.includes(id))continue;const price=itemById(id)!.cost;if(farm.gold>=price&&h.hp>0){assert.ok(farm.buy(id));farmPurchaseSpend+=price;}break;}
    if(h.hp>0&&h.hp<h.maxHp*.7&&!farm.itemUseError('tango'))farm.useItem('tango');
    // The stronger opponent can kill this intentionally simple farming bot.
    // Reissue a normal travel order after fountain respawn instead of idling.
    if(target&&h.hp>0&&distance(h,target)>=500&&h.order==='idle')assert.ok(farm.goToCamp(campId));
    if(target&&h.hp>0&&distance(h,target)<500){if(h.targetId!==target.id)farm.attack(target.id);if(distance(h,target)<250&&h.cooldowns.q<=farm.time&&(!farm.activeOrb||slowHits>0))farm.cast('q');if(h.hp<h.maxHp*.75&&h.cooldowns.w<=farm.time)farm.cast('w');}
    farm.step();for(const event of farm.drainEvents()){if(event.effect==='vamp')vampHeals++;if(event.kind==='kill'){const victim=farm.unit(event.target!);if(event.source==='hero'){if(victim?.kind==='neutral')neutralGold+=victim.bounty!;if(victim?.kind==='hero')rivalKills++;}else if(victim?.kind==='neutral'&&camp.unitIds.includes(victim.id)){contestedKills++;contestedGold+=victim.bounty!;}}}
    if(target&&target.slowUntil>farm.time)slowHits++;
    for(const u of farm.units)if(u.hp>0&&!isStructure(u))assert.ok(nav.isFree(u),u.id+' left walkable terrain while farming');
  }
  assert.equal(camp.unitIds.filter(id=>(farm.unit(id)?.hp??0)>0).length,0,campId+' must be cleared: '+JSON.stringify({time:farm.time,hero:{hp:farm.hero.hp,x:farm.hero.x,y:farm.hero.y,order:farm.hero.order,target:farm.hero.targetId},deaths:farm.deaths,gold:farm.gold,rival:farm.rivalMode}));
  const after={time:farm.time,gold:farm.gold,xp:farm.hero.xp,level:farm.hero.level,kills:farm.neutralKills};farmResults.push({camp:campId,before,after});
}
assert.ok(vampHeals>0);assert.ok(slowHits>0);assert.equal(farm.neutralKills+contestedKills,12);assert.equal(neutralGold+contestedGold,825);assert.equal(farm.gold,STARTING_GOLD-farmPurchaseSpend+farm.goldEarned+farm.passiveGoldEarned);
report('farm-playthrough.json',{source:map.source,method:'Original WPM, five live camps, normal goToCamp/attack/cast/buy/useItem commands only; no stat or position mutation. Enemy skill last-hits are credited to their actual source.',farmResults,vampHeals,neutralGold,contestedKills,contestedGold,rivalKills,slowFrames:slowHits,gold:farm.gold,earned:farm.goldEarned,passiveGold:farm.passiveGoldEarned,purchaseSpend:farmPurchaseSpend,inventory:farm.inventory,deaths:farm.deaths});
console.log('Economy: 4 camps cleared, '+farm.neutralKills+' player kills / '+contestedKills+' contested kills, '+farm.goldEarned+' earned gold; lifesteal and purchased slow orb applied.');
