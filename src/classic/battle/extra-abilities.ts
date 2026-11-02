import type {Skill} from './definitions';
import {distance,type Point} from './navigation';
import type {CombatEvent,CombatUnit,NavigationPort} from './simulation';

/** The simulation owns costs, cooldowns, rewards and damage mitigation. */
export interface AbilityContext {
  now:number;units:CombatUnit[];navigation:NavigationPort;
  unit(id:string|null):CombatUnit|undefined;
  hurt(v:CombatUnit,amount:number,source:CombatUnit,physical?:boolean):number;
  slow(v:CombatUnit,factor:number,duration:number):void;
  emit(kind:CombatEvent['kind'],p:Point,extra?:Partial<CombatEvent>):void;
}
/** Actual released spells only. The host filters hostility and visibility at this position. */
export type AbilityHazard=
  |Readonly<Point&{source:string;kind:'missile';direction:Readonly<Point>;speed:number;remaining:number;radius:number;expiresAt:number}>
  |Readonly<Point&{source:string;kind:'area';radius:number;impactAt:number;expiresAt:number}>;
type Buff={source:string;until:number;kind:'manaBreak'|'frostArrows'|'enchant';radius:number};
type Aura={source:string;until:number;next:number;kind:'rot'|'frostShield';radius:number};
type Channel={source:string;until:number;next:number;kind:'teleport'|'multishot'|'dismember';origin:Point;point:Point;range:number;radius:number;victim?:CombatUnit;previousStun?:number;appliedStun?:number};
type Missile=Point&{source:string;kind:'hook'|'arrow';direction:Point;remaining:number;travelled:number;radius:number;nextVisual:number;expiresAt:number};
type Chain={source:string;target:string;previous:string|null;origin:Point;remaining:number;next:number;radius:number;firstRange:number;unique:boolean;seen:Set<string>};
type Ward=Point&{source:string;until:number;next:number;radius:number};
type Delayed=Point&{source:string;at:number;radius:number};
/** Read-only presentation snapshots. Their lifetime is owned by combat, not the renderer. */
export interface AbilityVisual {key:string;kind:string;source:string;until:number;radius:number;x?:number;y?:number;direction?:Point;point?:Point;target?:string}
const living=(u:CombatUnit)=>u.hp>0&&u.kind!=='tower'&&u.kind!=='base';
const enemy=(u:CombatUnit,v:CombatUnit,now:number)=>living(v)&&v.team!==u.team&&v.invulnerableUntil<=now&&!v.returning;
const direction=(from:Point,to:Point,facing:number):Point=>{const d=distance(from,to);return d>.001?{x:(to.x-from.x)/d,y:(to.y-from.y)/d}:{x:Math.cos(facing),y:Math.sin(facing)};};
const EXTRA_IDS=new Set<string>(['manaBreak','blink','manaVoid','frostArrows','gust','multishot','frostBlast','frostShield','chainFrost','hook','rot','dismember','dragonSlave','lightStrike','laguna','arrow','leap','starfall','sprout','teleport','wrath','fissure','enchant','echo','shock','hex','serpentWard']);

/** Additional heroes share the original map, models and event effects. */
export class ExtraAbilities {
  private buffs:Buff[]=[];
  private auras:Aura[]=[];
  private channels=new Map<string,Channel>();
  private missiles:Missile[]=[];
  private chains:Chain[]=[];
  private wards:Ward[]=[];
  private delayed:Delayed[]=[];
  private silences=new Map<string,number>();

  clear(){for(const channel of this.channels.values())this.release(channel);this.buffs=[];this.auras=[];this.channels.clear();this.missiles=[];this.chains=[];this.wards=[];this.delayed=[];this.silences.clear();}
  hazards(now:number):readonly AbilityHazard[]{
    const hazards:AbilityHazard[]=[];
    for(const m of this.missiles)if(m.remaining>0&&m.expiresAt>now)hazards.push(Object.freeze({source:m.source,kind:'missile',x:m.x,y:m.y,direction:Object.freeze({...m.direction}),speed:1500,remaining:m.remaining,radius:m.radius,expiresAt:m.expiresAt}));
    for(const area of this.delayed)if(area.at>now)hazards.push(Object.freeze({source:area.source,kind:'area',x:area.x,y:area.y,radius:area.radius,impactAt:area.at,expiresAt:area.at}));
    return Object.freeze(hazards);
  }
  isChanneling(u:CombatUnit,now:number){return u.hp>0&&(this.channels.get(u.id)?.until??0)>now;}
  isSilenced(u:CombatUnit,now:number){return u.hp>0&&(this.silences.get(u.id)??0)>now;}
  visuals(now:number):readonly AbilityVisual[]{
    return [
      ...this.buffs.filter(b=>b.until>now).map(b=>({key:b.source+':'+b.kind,kind:b.kind,source:b.source,until:b.until,radius:b.radius})),
      ...this.auras.filter(a=>a.until>now).map(a=>({key:a.source+':'+a.kind,kind:a.kind,source:a.source,until:a.until,radius:a.radius})),
      ...[...this.channels.values()].filter(c=>c.until>now).map(c=>({key:c.source+':'+c.kind,kind:c.kind,source:c.source,until:c.until,radius:c.radius,point:{...c.point},target:c.victim?.id})),
      ...this.missiles.filter(m=>m.remaining>0).map(m=>({key:m.source+':'+m.kind,kind:m.kind,source:m.source,until:m.expiresAt,radius:m.radius,x:m.x,y:m.y,direction:{...m.direction}})),
      ...this.wards.filter(w=>w.until>now).map(w=>({key:w.source+':ward:'+w.until,kind:'serpentWard',source:w.source,until:w.until,radius:w.radius,x:w.x,y:w.y})),
      ...this.delayed.filter(d=>d.at>now).map(d=>({key:d.source+':lightStrike:'+d.at,kind:'lightStrike',source:d.source,until:d.at,radius:d.radius,x:d.x,y:d.y})),
    ];
  }
  cancel(u:CombatUnit){const channel=this.channels.get(u.id);if(channel)this.release(channel);this.channels.delete(u.id);}
  private release(c:Channel){if(c.victim&&c.appliedStun===c.victim.stunUntil)c.victim.stunUntil=c.previousStun??0;}
  private visible(ctx:AbilityContext,u:CombatUnit,p:Point){return ctx.navigation.lineVisible?.(u,p)??true;}
  private foes(u:CombatUnit,ctx:AbilityContext,p:Point,radius:number){return ctx.units.filter(v=>enemy(u,v,ctx.now)&&distance(v,p)<=radius+v.radius);}
  private effect(ctx:AbilityContext,u:CombatUnit,p:Point,effect:string,radius:number,target?:CombatUnit,duration?:number){ctx.emit('spell',p,{source:u.id,target:target?.id??u.id,heroId:u.heroId,effect,radius,direction:u.facing,duration});}
  private visual(ctx:AbilityContext,u:CombatUnit,effect:string,p:Point=u,end?:Point,target?:CombatUnit,radius=120,stage:CombatEvent['stage']='hit'){ctx.emit('ability',p,{source:u.id,target:target?.id??u.id,heroId:u.heroId,effect,stage,time:ctx.now,end:end?{x:end.x,y:end.y}:undefined,radius,direction:u.facing});}
  private impact(ctx:AbilityContext,u:CombatUnit,v:CombatUnit,effect='impact',radius=110){ctx.emit('impact',v,{source:u.id,target:v.id,effect,radius,direction:u.facing,height:85});}
  private stun(v:CombatUnit,duration:number,ctx:AbilityContext){v.stunUntil=Math.max(v.stunUntil,ctx.now+duration);v.pendingHit=null;v.stormUntil=0;}
  private silence(v:CombatUnit,duration:number,ctx:AbilityContext){this.silences.set(v.id,Math.max(this.silences.get(v.id)??0,ctx.now+duration));v.stormUntil=0;this.cancel(v);}
  private buff(u:CombatUnit,kind:Buff['kind'],radius:number,ctx:AbilityContext){this.buffs=this.buffs.filter(b=>b.source!==u.id||b.kind!==kind);this.buffs.push({source:u.id,kind,until:ctx.now+6,radius});}
  private startChannel(c:Channel,u:CombatUnit){this.cancel(u);u.path=[];u.destination=null;u.pendingHit=null;u.order='hold';this.channels.set(u.id,c);}
  /** Clamp before and after nearest(): blocked/outside destinations cannot extend cast range. */
  private landing(u:CombatUnit,p:Point,range:number,ctx:AbilityContext):Point|undefined {
    const d=direction(u,p,u.facing),length=Math.min(range,distance(u,p));
    for(let fraction=1;fraction>=0;fraction-=.125){
      const candidate=ctx.navigation.nearest({x:u.x+d.x*length*fraction,y:u.y+d.y*length*fraction});
      if(Number.isFinite(candidate.x)&&Number.isFinite(candidate.y)&&ctx.navigation.isFree(candidate)&&distance(u,candidate)<=range+.001)return candidate;
    }
  }
  private relocate(u:CombatUnit,p:Point){u.x=p.x;u.y=p.y;u.path=[];u.pathGoal=undefined;u.avoidance=undefined;u.destination=null;u.pendingHit=null;u.repathAt=0;}
  private ray(u:CombatUnit,p:Point,range:number,width:number,ctx:AbilityContext){
    const d=direction(u,p,u.facing);
    return ctx.units.filter(v=>{const dx=v.x-u.x,dy=v.y-u.y,along=dx*d.x+dy*d.y;return enemy(u,v,ctx.now)&&along>=0&&along<=range+v.radius&&Math.abs(dx*d.y-dy*d.x)<=width+v.radius;}).sort((a,b)=>distance(u,a)-distance(u,b));
  }
  private cone(u:CombatUnit,p:Point,range:number,width:number,ctx:AbilityContext){
    const d=direction(u,p,u.facing);
    return this.foes(u,ctx,u,range).filter(v=>{const dx=v.x-u.x,dy=v.y-u.y,along=dx*d.x+dy*d.y;return along>=0&&Math.abs(dx*d.y-dy*d.x)<=35+width*(along/range)+v.radius;});
  }
  private lineEffect(u:CombatUnit,p:Point,range:number,effect:string,ctx:AbilityContext){const d=direction(u,p,u.facing);for(let at=120;at<=range;at+=160)this.effect(ctx,u,{x:u.x+d.x*at,y:u.y+d.y*at},effect,135);}

  cast(skill:Skill,u:CombatUnit,target:Point|string|undefined,ctx:AbilityContext):boolean {
    if(!EXTRA_IDS.has(skill.id))return false;
    if(!living(u))return true;
    const victim=typeof target==='string'?ctx.unit(target):undefined;
    const point:Point=typeof target==='object'?target:victim??u;
    const valid=victim&&enemy(u,victim,ctx.now)&&distance(u,victim)<=skill.range+victim.radius;
    switch(skill.id){
      case'manaBreak':case'frostArrows':case'enchant':
        if(u.hp<=0)return true;
        this.buff(u,skill.id,skill.radius,ctx);this.effect(ctx,u,u,skill.id==='frostArrows'?'frost':'stomp',140);return true;
      case'blink':case'leap':{
        if(u.hp<=0||u.rootUntil>ctx.now)return true;
        const to=this.landing(u,point,skill.range,ctx);if(to){this.visual(ctx,u,skill.id,u,to);this.effect(ctx,u,u,'frost',130);this.relocate(u,to);this.effect(ctx,u,u,'stomp',145);}return true;
      }
      case'manaVoid':
        if(valid){const amount=100+u.level*15+Math.max(0,victim.maxMana-victim.mana)*.8;for(const v of this.foes(u,ctx,victim,skill.radius)){ctx.hurt(v,amount,u);this.impact(ctx,u,v,'frost');}this.effect(ctx,u,victim,'frost',skill.radius,victim);}return true;
      case'gust':{
        for(const v of this.ray(u,point,skill.range,skill.radius,ctx)){
          ctx.hurt(v,65+u.level*12,u);if(v.hp<=0)continue;
          const d=direction(u,point,u.facing),to=ctx.navigation.nearest({x:v.x+d.x*180,y:v.y+d.y*180});
          if(ctx.navigation.isFree(to)&&distance(v,to)<=190&&ctx.navigation.lineFree(v,to))this.relocate(v,to);
          this.silence(v,2.5,ctx);this.impact(ctx,u,v,'frost');
        }this.lineEffect(u,point,skill.range,'frost',ctx);return true;
      }
      case'multishot':
        this.startChannel({source:u.id,kind:'multishot',origin:{x:u.x,y:u.y},point:{...point},until:ctx.now+1.2,next:ctx.now,range:skill.range,radius:skill.radius},u);return true;
      case'frostBlast':
        for(const v of this.foes(u,ctx,point,skill.radius)){ctx.hurt(v,115+u.level*18,u);ctx.slow(v,.5,3);this.impact(ctx,u,v,'frost');}this.effect(ctx,u,point,'frost',skill.radius);return true;
      case'frostShield':case'rot':
        this.auras=this.auras.filter(a=>a.source!==u.id||a.kind!==skill.id);
        this.auras.push({source:u.id,kind:skill.id,until:ctx.now+5,next:ctx.now,radius:skill.radius});
        if(skill.id==='frostShield')u.guardUntil=Math.max(u.guardUntil,ctx.now+5);
        this.effect(ctx,u,u,skill.id==='frostShield'?'frost':'vamp',skill.radius);return true;
      case'chainFrost':case'wrath':
        if(valid){this.chains.push({source:u.id,target:victim.id,previous:null,origin:{x:u.x,y:u.y},remaining:6,next:ctx.now,radius:skill.radius,firstRange:skill.range,unique:skill.id==='wrath',seen:new Set()});this.effect(ctx,u,victim,skill.id==='wrath'?'impact':'frost',130,victim);}return true;
      case'hook':case'arrow':
        this.missiles.push({x:u.x,y:u.y,source:u.id,kind:skill.id,direction:direction(u,point,u.facing),remaining:skill.range,travelled:0,radius:skill.radius,nextVisual:ctx.now,expiresAt:ctx.now+skill.range/1500});return true;
      case'dismember':
        if(valid){const c:Channel={source:u.id,kind:'dismember',origin:{x:u.x,y:u.y},point:{x:victim.x,y:victim.y},until:ctx.now+2.5,next:ctx.now,range:skill.range,radius:0,victim,previousStun:victim.stunUntil};this.startChannel(c,u);this.channelStun(c,ctx);this.effect(ctx,u,victim,'vamp',150,victim);}return true;
      case'dragonSlave':case'fissure':
        for(const v of this.ray(u,point,skill.range,skill.radius,ctx)){ctx.hurt(v,(skill.id==='fissure'?110:135)+u.level*18,u);if(v.hp>0&&skill.id==='fissure'){this.stun(v,1.5,ctx);this.cancel(v);}this.impact(ctx,u,v,'stomp');}
        this.lineEffect(u,point,skill.range,'stomp',ctx);return true;
      case'lightStrike':
        this.delayed.push({x:point.x,y:point.y,source:u.id,at:ctx.now+.6,radius:skill.radius});this.effect(ctx,u,point,'ward',skill.radius,undefined,.6);return true;
      case'laguna':
        if(valid){ctx.hurt(victim,330+u.level*30,u);this.impact(ctx,u,victim,'impact',190);}return true;
      case'starfall':
        for(const v of this.foes(u,ctx,u,skill.radius)){ctx.hurt(v,180+u.level*22,u);this.effect(ctx,u,v,'blizzard',150,v);this.visual(ctx,u,'starfall',v,undefined,v,150);}return true;
      case'sprout':
        if(valid){victim.rootUntil=Math.max(victim.rootUntil,ctx.now+3);this.effect(ctx,u,victim,'ward',155,victim,3);}return true;
      case'teleport':{
        const to=this.landing(u,point,skill.range,ctx);if(to){this.startChannel({source:u.id,kind:'teleport',origin:{x:u.x,y:u.y},point:to,until:ctx.now+2,next:ctx.now,range:skill.range,radius:0},u);this.effect(ctx,u,u,'ward',150,undefined,2);}return true;
      }
      case'echo':{
        const victims=this.foes(u,ctx,u,skill.radius),amount=130+u.level*20+Math.min(victims.length,10)*32;
        for(const v of victims){ctx.hurt(v,amount,u);if(v.hp>0){this.stun(v,1,ctx);this.cancel(v);}this.impact(ctx,u,v,'stomp');this.visual(ctx,u,'echo',v,undefined,v,115);}this.effect(ctx,u,u,'stomp',skill.radius);return true;
      }
      case'shock':
        for(const v of this.cone(u,point,skill.range,skill.radius,ctx)){ctx.hurt(v,125+u.level*18,u);this.impact(ctx,u,v,'impact');}this.lineEffect(u,point,skill.range,'impact',ctx);return true;
      case'hex':
        if(valid){this.stun(victim,3,ctx);victim.rootUntil=Math.max(victim.rootUntil,ctx.now+3);this.silence(victim,3,ctx);this.effect(ctx,u,victim,'ward',140,victim,3);}return true;
      case'serpentWard':{
        const to=this.landing(u,point,skill.range,ctx);if(to){this.wards.push({...to,source:u.id,until:ctx.now+8,next:ctx.now,radius:skill.radius});for(const [x,y]of [[-70,-70],[70,-70],[-70,70],[70,70]])this.effect(ctx,u,{x:to.x+x,y:to.y+y},'ward',150,undefined,8);}return true;
      }
      default:return false;
    }
  }

  onAttack(source:CombatUnit,target:CombatUnit,actualDamage:number,ctx:AbilityContext){
    if(actualDamage<=0||source.hp<=0||target.team===source.team||target.kind==='tower'||target.kind==='base')return;
    for(const buff of this.buffs.filter(b=>b.source===source.id&&b.until>ctx.now)){
      if(buff.kind==='manaBreak'){
        if(!enemy(source,target,ctx.now))continue;
        const burned=Math.min(target.mana,25+source.level*5);target.mana-=burned;
        ctx.hurt(target,12+burned*.7,source);this.impact(ctx,source,target,'frost');this.visual(ctx,source,'manaBreak',target,undefined,target);
      }else if(buff.kind==='frostArrows'){if(!enemy(source,target,ctx.now))continue;ctx.slow(target,.55,2.2);this.impact(ctx,source,target,'frost');this.visual(ctx,source,'frostArrows',target,undefined,target);}
      else{
        buff.until=ctx.now;
        for(const v of this.foes(source,ctx,target,buff.radius)){ctx.hurt(v,v.id===target.id?source.damage*1.8:65+source.level*12,source);if(v.hp>0){this.stun(v,1,ctx);this.cancel(v);}this.impact(ctx,source,v,'stomp');}
        this.visual(ctx,source,'enchant',target,undefined,target,buff.radius);
      }
    }
  }

  private channelStun(c:Channel,ctx:AbilityContext){if(!c.victim)return;const until=Math.min(c.until,ctx.now+.3);if(c.victim.stunUntil<=until){c.victim.stunUntil=until;c.appliedStun=until;}c.victim.pendingHit=null;c.victim.stormUntil=0;this.cancel(c.victim);}
  update(dt:number,ctx:AbilityContext){
    this.buffs=this.buffs.filter(b=>b.until>ctx.now&&(ctx.unit(b.source)?.hp??0)>0);
    for(const [id,until]of this.silences)if(until<=ctx.now||(ctx.unit(id)?.hp??0)<=0)this.silences.delete(id);
    for(const [id,c]of this.channels){
      const u=ctx.unit(id);
      if(!u||u.hp<=0||u.stunUntil>ctx.now||u.tauntUntil>ctx.now||this.isSilenced(u,ctx.now)||distance(u,c.origin)>8){if(u)this.cancel(u);else{this.release(c);this.channels.delete(id);}continue;}
      if(c.kind==='teleport'){
        if(ctx.now>=c.until){const to=this.landing(u,c.point,c.range,ctx);if(to&&u.rootUntil<=ctx.now){this.visual(ctx,u,'teleport',u,to);this.relocate(u,to);this.effect(ctx,u,u,'frost',180);}this.cancel(u);}continue;
      }
      if(c.kind==='dismember'){
        const v=c.victim!;
        if(!enemy(u,v,ctx.now)||distance(u,v)>c.range+v.radius+80){this.cancel(u);continue;}
        this.channelStun(c,ctx);
        while(c.next<=ctx.now&&c.next<c.until){c.next+=.25;const dealt=ctx.hurt(v,(72+u.level*10)*.25,u);const heal=Math.min(u.maxHp-u.hp,dealt);u.hp+=heal;if(heal>0)ctx.emit('heal',u,{source:u.id,target:u.id,effect:'vamp',amount:Math.round(heal)});this.impact(ctx,u,v,'vamp');if(v.hp<=0)break;}
        if(v.hp<=0||ctx.now>=c.until)this.cancel(u);
      }else{
        while(c.next<=ctx.now&&c.next<c.until){c.next+=.4;for(const v of this.cone(u,c.point,c.range,c.radius,ctx)){ctx.hurt(v,55+u.level*10,u);ctx.slow(v,.7,.7);this.impact(ctx,u,v,'frost');}this.visual(ctx,u,'multishot',u,c.point,undefined,c.range,'pulse');this.lineEffect(u,c.point,c.range,'frost',ctx);}
        if(ctx.now>=c.until)this.cancel(u);
      }
    }
    for(const aura of this.auras){const u=ctx.unit(aura.source);if(!u||u.hp<=0){aura.until=0;continue;}
      while(aura.next<=ctx.now&&aura.next<aura.until){aura.next+=.25;
        for(const v of this.foes(u,ctx,u,aura.radius)){ctx.slow(v,aura.kind==='rot'?.65:.6,.5);if(aura.kind==='rot')ctx.hurt(v,(54+u.level*8)*.25,u);}
        if(aura.kind==='rot'){const loss=Math.min(Math.max(0,u.hp-1),(20+u.level*2)*.25);if(loss>0)ctx.hurt(u,loss,u);}
        if(Math.round(aura.next*4)%2===0)this.effect(ctx,u,u,aura.kind==='rot'?'vamp':'frost',aura.radius);
      }
    }
    this.auras=this.auras.filter(a=>a.until>ctx.now);
    for(const hit of this.delayed){if(hit.at>ctx.now)continue;const u=ctx.unit(hit.source);if(u){for(const v of this.foes(u,ctx,hit,hit.radius)){ctx.hurt(v,120+u.level*20,u);if(v.hp>0){this.stun(v,1.8,ctx);this.cancel(v);}this.impact(ctx,u,v,'stomp');}this.effect(ctx,u,hit,'stomp',hit.radius);this.visual(ctx,u,'lightStrike',hit,undefined,undefined,hit.radius);}hit.at=-Infinity;}
    this.delayed=this.delayed.filter(d=>d.at>ctx.now);
    this.updateMissiles(dt,ctx);this.updateChains(ctx);
    for(const ward of this.wards){const u=ctx.unit(ward.source);if(!u){ward.until=0;continue;}
      while(ward.next<=ctx.now&&ward.next<ward.until){ward.next+=.65;
        const v=this.foes(u,ctx,ward,ward.radius).filter(v=>this.visible(ctx,{...u,x:ward.x,y:ward.y},v)).sort((a,b)=>distance(a,ward)-distance(b,ward)||a.id.localeCompare(b.id))[0];
        if(v){ctx.hurt(v,46+u.level*9,u);ctx.emit('attack',ward,{source:u.id,target:v.id,effect:'spirit',direction:Math.atan2(v.y-ward.y,v.x-ward.x),height:100});this.visual(ctx,u,'serpentWard',ward,v,v);this.impact(ctx,u,v,'impact');}
      }
    }
    this.wards=this.wards.filter(w=>w.until>ctx.now);
  }

  private updateMissiles(dt:number,ctx:AbilityContext){
    for(const missile of this.missiles){
      const u=ctx.unit(missile.source);if(!u){missile.remaining=0;continue;}
      const travel=Math.min(missile.remaining,Math.max(0,dt)*1500),d=missile.direction;
      const hits=ctx.units.filter(v=>enemy(u,v,ctx.now)).map(v=>{const dx=v.x-missile.x,dy=v.y-missile.y,along=dx*d.x+dy*d.y,across=Math.abs(dx*d.y-dy*d.x),radius=missile.radius+v.radius;return {v,along,across,radius,enter:along-Math.sqrt(Math.max(0,radius*radius-across*across))};}).filter(h=>h.across<=h.radius&&h.along+h.radius>=0&&h.enter<=travel).sort((a,b)=>a.enter-b.enter);
      const hit=hits[0];
      if(hit){
        const v=hit.v,impactPoint={x:v.x,y:v.y};missile.travelled+=Math.max(0,hit.enter);
        ctx.hurt(v,(missile.kind==='hook'?135:95)+u.level*18,u);
        if(v.hp>0){
          if(missile.kind==='hook'){
            const toward=direction(u,v,u.facing),to=ctx.navigation.nearest({x:u.x+toward.x*(u.radius+v.radius+35),y:u.y+toward.y*(u.radius+v.radius+35)});
            if(u.hp>0&&ctx.navigation.isFree(to)&&distance(u,to)<=220)this.relocate(v,to);
            this.stun(v,.45,ctx);
          }else this.stun(v,Math.min(3.5,.8+missile.travelled/420),ctx);
          this.cancel(v);
        }
        this.visual(ctx,u,missile.kind,impactPoint,v,v,150);this.impact(ctx,u,v,missile.kind==='hook'?'vamp':'frost',150);missile.remaining=0;
      }else{
        missile.x+=d.x*travel;missile.y+=d.y*travel;missile.remaining-=travel;missile.travelled+=travel;
        if(missile.nextVisual<=ctx.now){missile.nextVisual=ctx.now+.08;this.effect(ctx,u,missile,missile.kind==='hook'?'vamp':'frost',65);}
      }
    }
    this.missiles=this.missiles.filter(m=>m.remaining>0);
  }
  private updateChains(ctx:AbilityContext){
    for(const chain of this.chains){
      const u=ctx.unit(chain.source);if(!u){chain.remaining=0;continue;}
      while(chain.remaining>0&&chain.next<=ctx.now){
        let v=ctx.unit(chain.target);
        // Later bounces are local to the last impact, including when that victim died.
        const local=(v:CombatUnit)=>enemy(u,v,ctx.now)&&v.id!==chain.previous&&(!chain.unique||!chain.seen.has(v.id))&&distance(v,chain.origin)<=chain.radius+v.radius;
        if(chain.previous!==null&&(!v||!local(v)))v=ctx.units.filter(local).sort((a,b)=>distance(a,chain.origin)-distance(b,chain.origin)||a.id.localeCompare(b.id))[0];
        if(!v||!enemy(u,v,ctx.now)||(chain.previous===null&&distance(v,chain.origin)>chain.firstRange+v.radius)){chain.remaining=0;break;}
        this.visual(ctx,u,chain.unique?'wrath':'chainFrost',chain.origin,v,v);
        ctx.hurt(v,(chain.unique?105:100)+u.level*12+(chain.unique?chain.seen.size*15:0),u);
        this.impact(ctx,u,v,chain.unique?'impact':'frost',160);
        chain.origin={x:v.x,y:v.y};chain.previous=v.id;chain.seen.add(v.id);chain.remaining--;chain.next+=.32;
        const candidates=ctx.units.filter(local).sort((a,b)=>distance(a,chain.origin)-distance(b,chain.origin)||a.id.localeCompare(b.id));
        if(!candidates.length){chain.remaining=0;break;}chain.target=candidates[0].id;
      }
    }
    this.chains=this.chains.filter(c=>c.remaining>0);
  }
}
