import {HEROES,type SkillSlot} from './definitions';
import {distance,type Point} from './navigation';
import {armorMultiplier} from './economy';
import type {AbilityHazard} from './extra-abilities';
import type {CombatUnit,NavigationPort} from './simulation';

export interface RivalSkillIntent {slot:SkillSlot;target?:Point|string}

/** The caller owns the return trip; different entry/exit thresholds prevent dithering. */
export function shouldRecover(u:CombatUnit,committed:boolean):boolean {
  if(u.hp<=0)return false;
  const health=u.hp/Math.max(1,u.maxHp),mana=u.maxMana>0?u.mana/u.maxMana:1;
  return committed?health<.9||mana<.82:health<=.32||mana<=.18;
}

const structure=(u:CombatUnit)=>u.kind==='tower'||u.kind==='base';
const windingUp=(u:CombatUnit,now:number)=>!!u.pendingHit&&u.pendingHit.at<=now+.35;
const hostile=(u:CombatUnit,v:CombatUnit)=>v.hp>0&&v.team!==u.team&&!v.returning;

/** Returns a walk destination, never applies movement or changes an attack order. */
export function evasiveDestination(u:CombatUnit,visibleEnemies:readonly CombatUnit[],nav:NavigationPort,now:number):Point|undefined {
  if(u.hp<=0||u.speed<=0||u.rootUntil>now||u.stunUntil>now||u.tauntUntil>now||u.invulnerableUntil>now||u.stormUntil>now||windingUp(u,now))return;
  // The supplied list is perception-filtered. Recheck terrain occlusion when the
  // navigation adapter supports it; never consult units outside that list.
  const enemies=visibleEnemies.filter(v=>hostile(u,v)&&(nav.lineVisible?.(u,v)??true));
  const threats=enemies.flatMap(v=>{
    const d=distance(u,v),aura=v.stormUntil>now?500:v.spinUntil>now?285:0;
    if(aura&&d<aura+u.radius+75)return[{unit:v,safe:aura+u.radius+100,weight:3}];
    const lethalAttack=u.attackAt<=now&&u.actionUntil<=now&&u.spinUntil<=now&&v.invulnerableUntil<=now&&
      d<=u.range+v.radius&&u.damage*armorMultiplier(v.armor)*(v.guardUntil>now||v.stormUntil>now?.5:1)>=v.hp;
    const closingMelee=u.range>200&&v.range<=200&&!structure(v)&&(v.kind==='hero'||v.targetId===u.id);
    if(closingMelee&&!lethalAttack&&d<v.range+u.radius+155)return[{unit:v,safe:Math.min(u.range-70,v.range+u.radius+245),weight:1}];
    return[];
  });
  if(!threats.length)return;
  let dx=0,dy=0;
  for(const t of threats){
    const d=distance(u,t.unit),weight=t.weight*Math.max(1,t.safe-d);
    dx+=d>.01?(u.x-t.unit.x)/d*weight:Math.cos(u.facing+Math.PI)*weight;
    dy+=d>.01?(u.y-t.unit.y)/d*weight:Math.sin(u.facing+Math.PI)*weight;
  }
  const angle=Math.hypot(dx,dy)>.01?Math.atan2(dy,dx):u.facing+Math.PI;
  const stride=Math.min(660,Math.max(170,...threats.map(t=>t.safe-distance(u,t.unit)+35)));
  const danger=(p:Point)=>threats.reduce((sum,t)=>sum+t.weight*Math.max(0,t.safe-distance(p,t.unit))**2,0);
  const initial=danger(u);
  let best:Point|undefined,bestScore=initial;
  for(const turn of [0,Math.PI/6,-Math.PI/6,Math.PI/3,-Math.PI/3,Math.PI/2,-Math.PI/2,Math.PI]){
    for(const fraction of [1,.65,.4]){
      const step=stride*fraction,p={x:u.x+Math.cos(angle+turn)*step,y:u.y+Math.sin(angle+turn)*step};
      if(!nav.isFree(p)||!nav.lineFree(u,p))continue;
      // Do not escape one spell by entering another visible spell or tower's
      // attack range. This is still a local walk, so no nearest-cell teleport.
      const newlyExposed=enemies.some(v=>{
        const radius=v.stormUntil>now?500+u.radius:v.spinUntil>now?285+u.radius:v.kind==='tower'?v.range+u.radius:0;
        return radius>0&&distance(u,v)>radius&&distance(p,v)<=radius;
      });
      if(newlyExposed)continue;
      const score=danger(p)+step*.05+Math.abs(turn)*2;
      if(score<bestScore-1){best=p;bestScore=score;}
    }
  }
  return best;
}

/**
 * Side-step visible skillshots and leave telegraphed areas at normal walk speed.
 * The host must filter snapshots by hostile source and visibility; this helper
 * cannot query a hidden caster and never treats tracking attacks as dodgeable.
 */
export function hazardEvasionDestination(u:CombatUnit,visibleHostileHazards:readonly AbilityHazard[],nav:NavigationPort,now:number):Point|undefined {
  if(u.hp<=0||u.speed<=0||u.rootUntil>now||u.stunUntil>now||u.tauntUntil>now||u.invulnerableUntil>now||u.stormUntil>now||windingUp(u,now))return;
  const speed=u.speed*(u.slowUntil>now?u.slowFactor:1);
  if(speed<=0)return;
  const hazards=visibleHostileHazards.filter(h=>h.expiresAt>now&&(nav.lineVisible?.(u,h)??true)&&
    (h.kind==='area'?h.impactAt>now:h.speed>0&&h.remaining>0&&Math.hypot(h.direction.x,h.direction.y)>.001));
  const positionAt=(p:Point,t:number):Point=>{
    const d=distance(u,p),fraction=d>.001?Math.min(1,speed*t/d):0;
    return{x:u.x+(p.x-u.x)*fraction,y:u.y+(p.y-u.y)*fraction};
  };
  const collides=(p:Point,h:AbilityHazard):boolean=>{
    const radius=h.radius+u.radius+12;
    if(h.kind==='area')return h.impactAt-now<=1.2&&distance(positionAt(p,h.impactAt-now),h)<=radius;
    const norm=Math.hypot(h.direction.x,h.direction.y),vx=h.direction.x/norm*h.speed,vy=h.direction.y/norm*h.speed;
    const lifetime=Math.min(h.remaining/h.speed,h.expiresAt-now,1.2),travel=distance(u,p)/speed;
    if(lifetime<=0)return false;
    // Relative motion is linear until arrival, then the hero remains at the
    // chosen destination. Test the closest approach on both exact segments.
    const overlap=(rx:number,ry:number,dx:number,dy:number,duration:number)=>{
      const length=dx*dx+dy*dy,time=length>.001?Math.max(0,Math.min(duration,-(rx*dx+ry*dy)/length)):0;
      return (rx+dx*time)**2+(ry+dy*time)**2<=radius*radius;
    };
    const ux=travel>.001?(p.x-u.x)/travel:0,uy=travel>.001?(p.y-u.y)/travel:0;
    if(overlap(u.x-h.x,u.y-h.y,ux-vx,uy-vy,Math.min(travel,lifetime)))return true;
    return travel<lifetime&&overlap(p.x-h.x-vx*travel,p.y-h.y-vy*travel,-vx,-vy,lifetime-travel);
  };
  const threats=hazards.filter(h=>collides(u,h));
  if(!threats.length)return;
  const candidates:Point[]=[];
  for(const h of threats){
    if(h.kind==='missile'){
      const norm=Math.hypot(h.direction.x,h.direction.y),dx=h.direction.x/norm,dy=h.direction.y/norm;
      const lateral=(u.x-h.x)*-dy+(u.y-h.y)*dx,clearance=h.radius+u.radius+40;
      for(const side of [lateral<0?-1:1,lateral<0?1:-1]){
        const offset=side*clearance-lateral,p={x:u.x-dy*offset,y:u.y+dx*offset};
        candidates.push(p,{x:p.x-dx*80,y:p.y-dy*80});
      }
    }else{
      const angle=distance(u,h)>.01?Math.atan2(u.y-h.y,u.x-h.x):u.facing+Math.PI;
      for(const turn of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,Math.PI]){
        const radius=h.radius+u.radius+45;candidates.push({x:h.x+Math.cos(angle+turn)*radius,y:h.y+Math.sin(angle+turn)*radius});
      }
    }
  }
  let best:Point|undefined,bestScore=Infinity;
  for(const p of candidates){
    const travel=distance(u,p);
    if(travel<12||travel>660||!nav.isFree(p)||!nav.lineFree(u,p)||hazards.some(h=>collides(p,h)))continue;
    // Prefer the shortest reachable escape; continuing an existing safe side
    // wins close ties so repeated observations cannot flip the dodge direction.
    const continuity=u.destination?Math.min(100,distance(p,u.destination))*.025:0,score=travel+continuity;
    if(score<bestScore){best=p;bestScore=score;}
  }
  return best;
}

/** Only proposes legal, useful casts; the simulation remains the authority for effects. */
export function chooseRivalSkill(u:CombatUnit,target:CombatUnit|undefined,visibleEnemies:readonly CombatUnit[],allies:readonly CombatUnit[],now:number,retreating:boolean):RivalSkillIntent|undefined {
  const hero=u.heroId?HEROES[u.heroId]:undefined;
  if(!hero||u.hp<=0||u.stunUntil>now||u.tauntUntil>now||u.invulnerableUntil>now||u.stormUntil>now||(u.action==='cast'&&u.actionUntil>now)||windingUp(u,now))return;
  const enemies=visibleEnemies.filter(v=>hostile(u,v)&&!structure(v)&&v.invulnerableUntil<=now);
  const preferred=target?enemies.find(v=>v.id===target.id):undefined;
  const ready=(slot:SkillSlot)=>{
    const skill=hero.skills[slot];
    return u.level>=skill.level&&u.cooldowns[slot]<=now&&u.mana>=skill.mana;
  };
  const nearby=(slot:SkillSlot)=>enemies.filter(v=>distance(u,v)<=hero.skills[slot].radius+v.radius);
  const inRange=(slot:SkillSlot)=>enemies.filter(v=>distance(u,v)<=hero.skills[slot].range+v.radius);
  const ranked=(list:CombatUnit[])=>list.sort((a,b)=>
    Number(b.kind==='hero')-Number(a.kind==='hero')||Number(b===preferred)-Number(a===preferred)||distance(u,a)-distance(u,b));
  const damageTo=(v:CombatUnit,damage:number)=>damage*(v.guardUntil>now||v.stormUntil>now?.5:1);
  const intent=(slot:SkillSlot,v?:CombatUnit):RivalSkillIntent=>({slot,...(v?{target:v.id}:{})});
  const pointIntent=(slot:SkillSlot,p:Point):RivalSkillIntent=>({slot,target:{x:p.x,y:p.y}});
  const controlled=(v:CombatUnit)=>v.rootUntil>now+.65||v.stunUntil>now+.65||v.tauntUntil>now+.65;
  const closeThreats=enemies.filter(v=>distance(u,v)<=v.range+u.radius+120);
  const healthy=u.hp/u.maxHp;
  const attacking=enemies.filter(v=>distance(u,v)<=u.range+v.radius+60);
  /** Aim at an observed position and score victims using the spell's real shape. */
  const pointSpell=(slot:SkillSlot,damage:number,shape:'circle'|'line'|'cone'|'missile'='circle',candidates=enemies):RivalSkillIntent|undefined=>{
    if(!ready(slot))return;
    const s=hero.skills[slot];
    const options=candidates.filter(v=>distance(u,v)<=s.range).map(v=>{
      const length=Math.max(.001,distance(u,v)),dx=(v.x-u.x)/length,dy=(v.y-u.y)/length;
      let caught=enemies.filter(other=>{
        if(shape==='circle')return distance(v,other)<=s.radius+other.radius;
        const x=other.x-u.x,y=other.y-u.y,along=x*dx+y*dy;
        return along>=0&&along<=s.range+other.radius&&Math.abs(x*dy-y*dx)<=
          (shape==='cone'?35+s.radius*along/s.range:s.radius)+other.radius;
      });
      if(shape==='missile')caught=caught.sort((a,b)=>distance(u,a)-distance(u,b)).slice(0,1);
      const useful=caught.length>=2||caught.some(other=>other.kind==='hero'||other.hp<=damageTo(other,damage));
      return{v,score:useful?caught.reduce((sum,other)=>sum+(other.kind==='hero'?4:1)+(other.hp<=damageTo(other,damage)?2:0),0):0};
    }).sort((a,b)=>b.score-a.score);
    if(options[0]?.score>0)return pointIntent(slot,options[0].v);
  };
  /** A local escape proposal. Navigation and landing remain simulation-owned. */
  const escapePoint=(range:number):Point|undefined=>{
    if(u.rootUntil>now)return;
    const threats=visibleEnemies.filter(v=>hostile(u,v)&&v.kind!=='base');
    let dx=0,dy=0;
    for(const v of threats){const d=Math.max(1,distance(u,v)),weight=Math.max(1,1100-d);dx+=(u.x-v.x)/d*weight;dy+=(u.y-v.y)/d*weight;}
    if(Math.hypot(dx,dy)<.01){
      if(!u.destination||distance(u,u.destination)<160)return;
      dx=u.destination.x-u.x;dy=u.destination.y-u.y;
    }
    const angle=Math.atan2(dy,dx),step=Math.min(range*.9,700,u.destination&&!threats.length?distance(u,u.destination):Infinity);
    const separation=(p:Point)=>Math.min(1500,...threats.map(v=>distance(p,v)));
    let best:Point|undefined,score=-Infinity;
    for(const turn of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2]){
      const p={x:u.x+Math.cos(angle+turn)*step,y:u.y+Math.sin(angle+turn)*step};
      if(threats.some(v=>distance(p,v)<=Math.max(v.range+u.radius+60,v.stormUntil>now?500+u.radius:v.spinUntil>now?285+u.radius:0)))continue;
      const clearance=separation(p);
      if(threats.length&&clearance<separation(u)+80)continue;
      const value=clearance-Math.abs(turn)*8;
      if(value>score){best=p;score=value;}
    }
    return best;
  };

  switch(u.heroId){
    case'axe':{
      if(ready('r')){
        const kill=ranked(inRange('r').filter(v=>v.hp<=v.maxHp*.3||v.hp<=damageTo(v,170+u.level*15)))[0];
        if(kill)return intent('r',kill);
      }
      const call=nearby('q');
      if(ready('q')&&call.length&&(retreating?call.some(v=>distance(u,v)<=v.range+u.radius+90):call.some(v=>v.kind==='hero')||call.length>=2))return intent('q');
      const helix=nearby('w');
      if(ready('w')&&helix.length&&(!retreating||helix.some(v=>v.hp<=damageTo(v,120+u.level*20)))&&
        (helix.some(v=>v.kind==='hero'||v.hp<=damageTo(v,120+u.level*20))||helix.length>=2))return intent('w');
      return;
    }
    case'juggernaut':{
      const hurtSelf=u.hp/u.maxHp<.72&&u.maxHp-u.hp>=80;
      const hurtAllies=allies.filter(v=>v.id!==u.id&&v.team===u.team&&v.hp>0&&!structure(v)&&distance(u,v)<=hero.skills.w.radius+v.radius);
      const teamMissing=hurtAllies.reduce((sum,v)=>sum+Math.max(0,v.maxHp-v.hp),0);
      if(ready('w')&&(hurtSelf||(!retreating&&teamMissing>=200)))return intent('w');
      if(!retreating&&ready('r')&&u.spinUntil<=now){
        const victim=ranked(inRange('r').filter(v=>v.kind==='hero'||(v.kind==='neutral'&&v.hp>u.damage*3)))[0];
        if(victim)return intent('r',victim);
      }
      const spin=nearby('q');
      if(ready('q')&&u.spinUntil<=now&&spin.length&&(spin.some(v=>v.kind==='hero')||spin.length>=2))return intent('q');
      return;
    }
    case'maiden':{
      const rooted=(v:CombatUnit)=>v.rootUntil>now+.65||v.stunUntil>now+.65||v.tauntUntil>now+.65;
      const freezing=ranked(inRange('w').filter(v=>!rooted(v)&&(v.kind==='hero'||v.kind==='neutral'||v.hp<=damageTo(v,70+u.level*15))));
      if(ready('w')&&freezing.length)return intent('w',freezing[0]);
      const storm=nearby('r');
      if(!retreating&&ready('r')&&u.hp/u.maxHp>=.55&&
        !enemies.some(v=>v.spinUntil>now&&distance(u,v)<285+u.radius)&&
        (storm.length>=2||storm.some(v=>v.kind==='hero'&&(rooted(v)||distance(u,v)<250))))return intent('r');
      if(ready('q')){
        const centers=enemies.filter(v=>distance(u,v)<=hero.skills.q.range).map(v=>{
          const caught=enemies.filter(other=>distance(v,other)<=hero.skills.q.radius+other.radius);
          const useful=caught.length>=2||caught.some(other=>other.kind==='hero'||other.hp<=damageTo(other,100+u.level*20));
          const score=caught.reduce((sum,other)=>sum+(other.kind==='hero'?4:1)+(other.hp<=damageTo(other,100+u.level*20)?2:0),0);
          return{v,score:useful?score:0};
        }).sort((a,b)=>b.score-a.score);
        if(centers[0]?.score>0)return{slot:'q',target:{x:centers[0].v.x,y:centers[0].v.y}};
      }
      return;
    }
    case'antimage':{
      if(retreating&&ready('w')){const p=escapePoint(hero.skills.w.range);if(p)return pointIntent('w',p);}
      if(ready('r')){
        const victims=inRange('r').filter(v=>{
          const missing=Math.max(0,v.maxMana-v.mana),damage=100+u.level*15+missing*.8;
          return v.hp<=damageTo(v,damage)||(v.kind==='hero'&&missing>=Math.max(100,v.maxMana*.4));
        }).sort((a,b)=>(b.maxMana-b.mana)-(a.maxMana-a.mana));
        if(victims[0])return intent('r',victims[0]);
      }
      if(!retreating&&ready('q')&&attacking.some(v=>v.mana>0))return intent('q');
      return;
    }
    case'drow':{
      const pursuer=ranked(enemies.filter(v=>distance(u,v)<=hero.skills.w.range&&
        (retreating||distance(u,v)<350||v.stormUntil>now)))[0];
      if(ready('w')&&pursuer)return pointIntent('w',pursuer);
      if(!retreating&&healthy>=.55&&!enemies.some(v=>v.range<250&&distance(u,v)<350)){
        const volley=pointSpell('r',(55+u.level*10)*3,'cone');if(volley)return volley;
      }
      if(!retreating&&ready('q')&&attacking.length)return intent('q');
      return;
    }
    case'lich':{
      if(ready('w')&&u.guardUntil<=now&&closeThreats.length&&(retreating||healthy<.72||nearby('w').length))return intent('w');
      if(ready('r')){
        const victims=ranked(inRange('r').filter(v=>enemies.some(other=>other.id!==v.id&&distance(v,other)<=hero.skills.r.radius+other.radius)||v.hp<=damageTo(v,100+u.level*12)));
        if(victims[0])return intent('r',victims[0]);
      }
      return pointSpell('q',115+u.level*18);
    }
    case'pudge':{
      if(!retreating&&ready('r')&&healthy>=.4){
        const victims=ranked(inRange('r').filter(v=>v.kind==='hero'||v.kind==='neutral'));
        const victim=victims[0];
        if(victim&&!enemies.some(v=>v.id!==victim.id&&v.kind==='hero'&&distance(u,v)<550))return intent('r',victim);
      }
      if(!retreating&&ready('w')&&healthy>.55){
        const victims=nearby('w');if(victims.some(v=>v.kind==='hero')||victims.length>=2)return intent('w');
      }
      if(!retreating){
        return pointSpell('q',135+u.level*18,'missile',enemies.filter(v=>distance(u,v)>u.range+v.radius+70));
      }
      return;
    }
    case'lina':{
      if(ready('r')){
        const victim=ranked(inRange('r').filter(v=>v.hp<=damageTo(v,330+u.level*30)))[0];
        if(victim)return intent('r',victim);
      }
      const stun=pointSpell('w',120+u.level*20,'circle',enemies.filter(v=>!controlled(v)));
      if(stun)return stun;
      return pointSpell('q',135+u.level*18,'line');
    }
    case'mirana':{
      if(ready('w')&&(retreating||enemies.some(v=>v.range<250&&distance(u,v)<v.range+u.radius+130))){
        const p=escapePoint(hero.skills.w.range);if(p)return pointIntent('w',p);
      }
      const stars=nearby('r');
      if(ready('r')&&(stars.length>=2||stars.some(v=>v.kind==='hero'||v.hp<=damageTo(v,180+u.level*22))))return intent('r');
      return pointSpell('q',95+u.level*18,'missile',enemies.filter(v=>!controlled(v)));
    }
    case'furion':{
      // A two-second channel is only safe after opening a real gap or disabling
      // pursuers. Rooted attackers can still attack within their weapon range.
      if(retreating&&ready('w')&&visibleEnemies.filter(v=>hostile(u,v)&&v.kind!=='base').every(v=>{
        const travel=v.rootUntil>now+2.1||v.stunUntil>now+2.1?0:v.speed*2.1;
        return distance(u,v)>v.range+u.radius+70+travel;
      })){
        const p=escapePoint(hero.skills.w.range);if(p)return pointIntent('w',p);
      }
      if(ready('q')){
        const victim=ranked(inRange('q').filter(v=>!controlled(v)&&(v.kind==='hero'||v.kind==='neutral'||retreating)))[0];
        if(victim)return intent('q',victim);
      }
      if(!retreating&&ready('r')){
        const victim=ranked(inRange('r').filter(v=>enemies.some(other=>other.id!==v.id&&distance(v,other)<=hero.skills.r.radius+other.radius)||v.hp<=damageTo(v,105+u.level*12)))[0];
        if(victim)return intent('r',victim);
      }
      return;
    }
    case'earthshaker':{
      const echo=nearby('r');
      if(ready('r')&&(echo.length>=3||(echo.length>=2&&echo.some(v=>v.kind==='hero'))||
        echo.some(v=>v.kind==='hero'&&v.hp<=damageTo(v,130+u.level*20+Math.min(echo.length,10)*32))))return intent('r');
      const fissure=pointSpell('q',110+u.level*18,'line',enemies.filter(v=>!controlled(v)));
      if(fissure)return fissure;
      if(!retreating&&ready('w')&&attacking.length)return intent('w');
      return;
    }
    case'shaman':{
      if(ready('w')){
        const victim=ranked(inRange('w').filter(v=>!controlled(v)&&(v.kind==='hero'||v.kind==='neutral'||retreating)))[0];
        if(victim)return intent('w',victim);
      }
      if(!retreating){const ward=pointSpell('r',0);if(ward)return ward;}
      return pointSpell('q',125+u.level*18,'cone');
    }
    default:return;
  }
}
