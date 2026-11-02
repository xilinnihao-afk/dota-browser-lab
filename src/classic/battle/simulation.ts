import {HEROES,SPAWNS,HERO_SPAWN,XP_REQUIRED,type HeroId,type SkillSlot,type ModelId} from './definitions';
import {distance,type Point,type MapNavigation} from './navigation';
import {itemById,INVENTORY_SLOTS,STARTING_GOLD,PASSIVE_GOLD_PER_SECOND,armorMultiplier,type Orb} from './economy';
import type {CampDefinition} from './world';
import {STRUCTURES,FOUNTAINS,FOUNTAIN_SPAWNS,FOUNTAIN_RADIUS,isStructure,type StructureDefinition} from './structures';
import {creepStep,isCreep} from './crowd';
import {shouldRecover,evasiveDestination,hazardEvasionDestination,chooseRivalSkill} from './rival-tactics';
import {ExtraAbilities,type AbilityContext} from './extra-abilities';
export const STEP=1/60;
export const RIVAL_SIGHT=1100,RIVAL_MEMORY=2.5;
// A normal-speed target can travel ~115 units during the 0.3s attack windup.
// Keep committed attacks connected while still allowing a dash/teleport escape.
const HIT_LEEWAY=140;
export type Team=0|1|2;
export interface CombatUnit extends Point {
  id:string;model:ModelId;name:string;team:Team;kind:'hero'|'melee'|'ranged'|'tower'|'base'|'neutral';heroId?:HeroId;sourceId?:string;lane?:StructureDefinition['lane'];tier?:number;
  hp:number;maxHp:number;mana:number;maxMana:number;damage:number;range:number;speed:number;attackPeriod:number;radius:number;scale:number;
  level:number;xp:number;facing:number;action:'idle'|'walk'|'attack'|'cast'|'dead';actionSerial:number;actionUntil:number;
  order:'idle'|'move'|'steer'|'attack'|'hold';destination:Point|null;targetId:string|null;path:Point[];repathAt:number;attackAt:number;pendingHit:{id:string;at:number}|null;
  deadAt:number;respawnAt:number;rootUntil:number;slowUntil:number;tauntUntil:number;tauntId:string|null;guardUntil:number;invulnerableUntil:number;spinUntil:number;stormUntil:number;nextPulse:number;
  cooldowns:Record<SkillSlot,number>;castSerial:number;spell:string;
  armor:number;slowFactor:number;stunUntil:number;frostReadyAt:number;
  home?:Point;campId?:string;returning?:boolean;bounty?:number;experience?:number;
  pathGoal?:Point;avoidance?:{id:string;side:1|-1};
}
export interface CombatEvent extends Point {id:number;kind:'damage'|'kill'|'level'|'spell'|'heal'|'wave'|'respawn'|'result'|'command'|'attack'|'impact'|'gold'|'purchase'|'ability';heroId?:HeroId;text?:string;amount?:number;target?:string;source?:string;effect?:string;radius?:number;physical?:boolean;direction?:number;height?:number;duration?:number;end?:Point;range?:number;time?:number;stage?:'cast'|'hit'|'pulse'}
export interface Projectile extends Point {id:number;source:string;target:string;team:Team;damage:number;speed:number;life:number;style?:'rock'|'spirit'|'frost';orb?:Orb;lifesteal?:number}
interface Ward extends Point {until:number;next:number;source:string}
interface Slash {source:string;target:string;remaining:number;next:number}
export interface NavigationPort {nearest(p:Point):Point;findPath(a:Point,b:Point):Point[];lineFree(a:Point,b:Point):boolean;isFree(p:Point):boolean;lineVisible?(a:Point,b:Point):boolean}
export class BattleSimulation {
  units:CombatUnit[]=[];projectiles:Projectile[]=[];events:CombatEvent[]=[];wards:Ward[]=[];slashes:Slash[]=[];
  phase:'choose'|'playing'|'won'|'lost'='choose';paused=false;time=0;wave=0;nextWave=0;kills=0;deaths=0;lastHits=0;selectedId='hero';message='选择英雄，加入中路战斗';
  gold=STARTING_GOLD;goldEarned=0;passiveGoldEarned=0;inventory:string[]=[];itemCharges:Record<string,number>={};activeOrb:Orb|null=null;neutralKills=0;
  camps:{definition:CampDefinition;unitIds:string[];respawnAt:number}[]=[];
  private itemRegeneration=new Map<string,{until:number;rate:number}>();
  private serial=0;private eventSerial=0;
  private steering:Point|null=null;
  private rivalThinkAt=0;
  readonly extraAbilities=new ExtraAbilities();
  rivalGold=STARTING_GOLD;rivalGoldEarned=0;rivalInventory:string[]=[];rivalItemCharges:Record<string,number>={};rivalActiveOrb:Orb|null=null;
  rivalMode:'idle'|'fight'|'push'|'search'|'evade'|'retreat'|'recover'='idle';
  private rivalRecovering=false;private rivalShopAt=0;private rivalMoveUntil=0;
  private rivalLastSeen:(Point&{until:number})|null=null;
  private rivalSeesPlayer=false;
  get rivalPerception(){return {sight:RIVAL_SIGHT,playerVisible:this.rivalSeesPlayer,lastSeen:this.rivalLastSeen?{...this.rivalLastSeen}:null};}
  canSee(observer:CombatUnit,target:CombatUnit){return observer.hp>0&&target.hp>0&&distance(observer,target)<=RIVAL_SIGHT&&(this.navigation.lineVisible?.(observer,target)??true);}
  constructor(readonly navigation:NavigationPort|MapNavigation,readonly campDefinitions:readonly CampDefinition[]=[],readonly structures:readonly StructureDefinition[]=STRUCTURES){}
  get hero(){return this.units.find(u=>u.id==='hero')!;}
  unit(id:string|null){return this.units.find(u=>u.id===id);}
  fountain(team:number){return FOUNTAINS[team===1?1:0];}
  inFountain(u:CombatUnit){return u.team!==2&&u.hp>0&&!isStructure(u)&&distance(u,this.fountain(u.team))<=FOUNTAIN_RADIUS;}
  fountainSpawn(team:number){return this.navigation.nearest(FOUNTAIN_SPAWNS[team===1?1:0]);}
  recover(){const ok=this.move(this.fountainSpawn(0));if(ok)this.message='正在返回近卫泉水，恢复生命与法力';return ok;}
  /** Mid lane waves advance through each surviving defence and finally the base. */
  objective(team:0|1,from:Point){const enemies=this.units.filter(u=>u.team!==team&&u.team!==2&&u.hp>0&&isStructure(u));
    const mid=enemies.filter(u=>u.kind==='tower'&&u.lane==='mid').sort((a,b)=>(a.tier??1)-(b.tier??1));
    return mid[0]??enemies.filter(u=>u.kind==='tower'&&u.lane==='base').sort((a,b)=>distance(a,from)-distance(b,from))[0]??enemies.find(u=>u.kind==='base');
  }
  private emit(kind:CombatEvent['kind'],p:Point,extra:Partial<CombatEvent>={}){this.events.push({id:++this.eventSerial,kind,x:p.x,y:p.y,...extra});if(this.events.length>160)this.events.shift();}
  drainEvents(){return this.events.splice(0);}
  private create(model:ModelId,team:Team,kind:CombatUnit['kind'],p:Point,id?:string):CombatUnit {
    const heroId=Object.hasOwn(HEROES,model)?model as HeroId:undefined,h=heroId?HEROES[heroId]:undefined;
    const hp=h?.hp??(kind==='tower'?2000:kind==='melee'?330:240),mana=h?.mana??0;
    const u:CombatUnit={...p,id:id??'unit-'+(++this.serial),model,name:h?.name??(kind==='tower'?(team?'天灾防御塔':'近卫防御塔'):kind==='melee'?'近战小兵':'远程小兵'),team,kind,heroId,hp,maxHp:hp,mana,maxMana:mana,damage:h?.damage??(kind==='tower'?62:kind==='melee'?23:29),range:h?.range??(kind==='tower'?720:kind==='melee'?85:480),speed:h?.speed??(kind==='tower'?0:250),attackPeriod:h?.attackPeriod??(kind==='tower'?1.15:1.35),radius:kind==='tower'?115:kind==='hero'?32:25,scale:h?.scale??(kind==='tower'?1:kind==='melee'?.8:1),level:1,xp:0,facing:team?-2.4:.7,action:'idle',actionSerial:0,actionUntil:0,order:'idle',destination:null,targetId:null,path:[],repathAt:0,attackAt:0,pendingHit:null,deadAt:-1,respawnAt:0,rootUntil:0,slowUntil:0,tauntUntil:0,tauntId:null,guardUntil:0,invulnerableUntil:0,spinUntil:0,stormUntil:0,nextPulse:0,cooldowns:{q:0,w:0,r:0},castSerial:0,spell:'',armor:0,slowFactor:.5,stunUntil:0,frostReadyAt:0};
    this.units.push(u);return u;
  }
  start(id:HeroId,rivalId?:HeroId){
    this.units=[];this.projectiles=[];this.events=[];this.wards=[];this.slashes=[];this.steering=null;this.serial=this.eventSerial=0;this.time=this.wave=this.kills=this.deaths=this.lastHits=0;this.nextWave=18;this.paused=false;this.phase='playing';this.selectedId='hero';
    this.gold=STARTING_GOLD;this.goldEarned=0;this.passiveGoldEarned=0;this.itemCharges={};this.rivalItemCharges={};this.itemRegeneration.clear();this.neutralKills=0;this.inventory=[];this.activeOrb=null;this.camps=[];this.rivalThinkAt=0;this.rivalLastSeen=null;this.rivalSeesPlayer=false;
    this.extraAbilities.clear();this.rivalGold=STARTING_GOLD;this.rivalGoldEarned=0;this.rivalInventory=[];this.rivalActiveOrb=null;this.rivalRecovering=false;this.rivalMode='idle';this.rivalShopAt=0;this.rivalMoveUntil=0;
    this.create(id,0,'hero',this.fountainSpawn(0),'hero');
    const roster=Object.keys(HEROES)as HeroId[],opponent=rivalId??roster[(roster.indexOf(id)+1)%roster.length];
    this.create(opponent,1,'hero',this.fountainSpawn(1),'rival');
    for(const def of this.structures){const u=this.create(def.model,def.team,def.kind,def,def.id);Object.assign(u,{sourceId:def.sourceId,name:def.name,facing:def.facing,scale:def.scale,tier:def.tier,lane:def.lane});
      if(def.kind==='base')Object.assign(u,{hp:4500,maxHp:4500,damage:0,range:0,speed:0,radius:230,armor:5});
      else Object.assign(u,{hp:1600+(def.tier-1)*200,maxHp:1600+(def.tier-1)*200,damage:62+(def.tier-1)*7});
    }
    for(const definition of this.campDefinitions){const camp={definition,unitIds:[]as string[],respawnAt:0};this.camps.push(camp);this.spawnCamp(camp);}
    this.spawnWave(true);this.message='从泉水出发：B 购买装备或吃树，N 前往野区；每秒获得 1 金币。';
  }
  spawnWave(first=false){
    this.wave++;for(const team of [0,1]as const){const alive=this.units.filter(u=>u.team===team&&u.hp>0&&(u.kind==='melee'||u.kind==='ranged')).length;if(alive>=20)continue;
      const origin=first?(team?{x:180,y:-110}:{x:-900,y:-1120}):SPAWNS[team];
      for(let i=0;i<Math.min(4,20-alive);i++){const p=this.navigation.nearest({x:origin.x+(i%2)*95-45,y:origin.y+Math.floor(i/2)*95-45});this.create(team?(i===3?'scourgeRanged':'scourgeMelee'):(i===3?'sentinelRanged':'sentinelMelee'),team,i===3?'ranged':'melee',p);}}
    this.emit('wave',HERO_SPAWN,{text:`第 ${this.wave} 波兵线抵达`});
  }
  move(point:Point){const u=this.hero;if(!this.canCommand())return false;const destination=this.navigation.nearest(point),path=this.navigation.findPath(u,destination);if(!path.length){this.message='无法到达该位置，请选择可通行地面';return false;}
    this.extraAbilities.cancel(u);u.order='move';u.destination=destination;u.targetId=null;u.path=path;u.pendingHit=null;u.stormUntil=0;this.message='正在移动';this.emit('command',destination);return true;}
  attack(id:string){
    if(!this.canCommand())return false;const u=this.hero,target=this.unit(id);if(!target||target.hp<=0||target.team===u.team)return false;
    this.selectedId=id;this.message='攻击 '+target.name;
    // Repeated clicks confirm the existing order; they must not cancel its hit
    // windup or throw away the pursuit path on every mouse press.
    if(u.order==='attack'&&u.targetId===id)return true;
    if(u.pendingHit){u.attackAt=this.time;u.actionUntil=this.time;}
    this.extraAbilities.cancel(u);u.order='attack';u.targetId=id;u.destination=null;u.path=[];u.repathAt=0;u.pendingHit=null;u.stormUntil=0;return true;
  }
  stop(){if(!this.canCommand())return;const u=this.hero;this.extraAbilities.cancel(u);u.order='hold';u.targetId=null;u.destination=null;u.path=[];u.pendingHit=null;u.stormUntil=0;u.action='idle';this.message='已停止';}
  /** Held keyboard intent, consumed at the simulation timestep without A* detours. */
  steer(direction:Point|null){
    const u=this.hero,length=direction?Math.hypot(direction.x,direction.y):0;
    if(!length){this.steering=null;if(u?.order==='steer'){u.order='hold';if(u.action==='walk')u.action='idle';}return false;}
    if(!this.canCommand())return false;
    this.steering={x:direction!.x/length,y:direction!.y/length};
    if(u.order!=='steer')this.message='WASD 移动中';
    this.extraAbilities.cancel(u);u.order='steer';u.destination=null;u.targetId=null;u.path=[];u.pendingHit=null;u.stormUntil=0;return true;
  }
  canCommand(){return this.phase==='playing'&&!this.paused&&this.hero?.hp>0;}
  purchaseError(id:string){
    const item=itemById(id);if(!this.canCommand())return '请在英雄存活且战斗进行时购买';if(!item)return '未知物品';
    const owned=this.inventory.includes(id);if(owned&&!item.consumable)return '已拥有这件装备';
    if(!owned&&this.inventory.length>=INVENTORY_SLOTS)return '装备栏已满，请先出售';if(this.gold<item.cost)return '金币不足';return null;
  }
  private addItem(id:string,u=this.hero){
    const item=itemById(id)!,inventory=u.id==='hero'?this.inventory:this.rivalInventory,charges=u.id==='hero'?this.itemCharges:this.rivalItemCharges;
    if(!inventory.includes(id))inventory.push(id);if(item.consumable)charges[id]=(charges[id]??0)+item.consumable.charges;
    if(item.orb){if(u.id==='hero')this.activeOrb=item.orb;else this.rivalActiveOrb=item.orb;}this.refreshEquipment(u);
  }
  buy(id:string){const error=this.purchaseError(id);if(error){this.message=error;return false;}const item=itemById(id)!;this.gold-=item.cost;this.addItem(id);this.message='已购买 '+item.name+(item.consumable?'，点击背包使用':'');this.emit('purchase',this.hero,{text:this.message});return true;}
  sellValue(id:string){const item=itemById(id);return item?Math.floor(item.cost*.5*(item.consumable?(this.itemCharges[id]??0)/item.consumable.charges:1)):0;}
  sell(id:string){if(!this.canCommand())return false;const index=this.inventory.indexOf(id),item=itemById(id);if(index<0||!item)return false;this.gold+=this.sellValue(id);this.inventory.splice(index,1);delete this.itemCharges[id];if(item.orb===this.activeOrb)this.activeOrb=null;this.refreshEquipment();this.message='已出售 '+item.name;return true;}
  itemRecoveryRemaining(u=this.hero){return u&&u.hp>0?Math.max(0,(this.itemRegeneration.get(u.id)?.until??0)-this.time):0;}
  itemUseError(id:string,u=this.hero){
    if(!u||!['hero','rival'].includes(u.id)||this.phase!=='playing'||this.paused||u.hp<=0)return '当前不能使用物品';
    const item=itemById(id),inventory=u.id==='hero'?this.inventory:this.rivalInventory,charges=u.id==='hero'?this.itemCharges:this.rivalItemCharges;
    if(!item?.consumable||!inventory.includes(id)||(charges[id]??0)<1)return '没有可使用的物品';
    if(u.stunUntil>this.time||u.tauntUntil>this.time)return '受控制，暂时不能使用';
    if(u.stormUntil>this.time||u.invulnerableUntil>this.time||this.extraAbilities.isChanneling(u,this.time))return '当前动作结束后可使用';
    if(this.itemRecoveryRemaining(u)>0)return '吃树正在恢复生命';if(u.hp>=u.maxHp)return '生命已满，无需使用';return null;
  }
  useItem(id:string,u=this.hero){
    const error=this.itemUseError(id,u);if(error){if(u?.id==='hero')this.message=error;return false;}
    const item=itemById(id)!,effect=item.consumable!,inventory=u.id==='hero'?this.inventory:this.rivalInventory,charges=u.id==='hero'?this.itemCharges:this.rivalItemCharges;
    if(--charges[id]===0){delete charges[id];inventory.splice(inventory.indexOf(id),1);}
    this.itemRegeneration.set(u.id,{until:this.time+effect.duration,rate:effect.heal/effect.duration});
    if(u.id==='hero')this.message=`吃树：${effect.duration} 秒内恢复 ${effect.heal} 生命`;
    this.emit('heal',u,{source:u.id,target:u.id,effect:'heal',text:'吃树 · 持续恢复'});return true;
  }
  equipOrb(id:string){const item=itemById(id);if(!this.canCommand()||!this.inventory.includes(id)||!item?.orb)return false;this.activeOrb=item.orb;this.message='已启用 '+item.name;return true;}
  get lifesteal(){return this.inventory.reduce((n,id)=>Math.max(n,itemById(id)?.lifesteal??0),0);}
  private refreshEquipment(h=this.hero){const inventory=h.id==='hero'?this.inventory:this.rivalInventory,items=inventory.map(id=>itemById(id)!),previous=h.maxHp;h.damage=HEROES[h.heroId!].damage+(h.level-1)*8+items.reduce((n,i)=>n+(i.damage??0),0);h.armor=items.reduce((n,i)=>n+(i.armor??0),0);h.maxHp=HEROES[h.heroId!].hp+(h.level-1)*110+items.reduce((n,i)=>n+(i.health??0),0);h.hp=Math.min(h.maxHp,h.hp+Math.max(0,h.maxHp-previous));}
  private autoBuy(u:CombatUnit){
    if(this.time<this.rivalShopAt||u.hp<=0)return;this.rivalShopAt=this.time+1.2;
    if(!this.inFountain(u)&&u.hp<=u.maxHp*.7&&!this.rivalInventory.includes('tango')&&this.rivalInventory.length<INVENTORY_SLOTS&&this.rivalGold>=itemById('tango')!.cost){this.rivalGold-=itemById('tango')!.cost;this.addItem('tango',u);this.emit('purchase',u,{source:u.id,text:u.name+' 购买 吃树',amount:itemById('tango')!.cost});}
    const build=u.range>200?['claws','armor','orbSlow','vitality','sword','vampire']:['armor','claws','vitality','vampire','sword','orbFrost'];
    for(const id of build){const item=itemById(id)!;if(this.rivalInventory.includes(id))continue;if(this.rivalInventory.length>=INVENTORY_SLOTS)break;if(this.rivalGold<item.cost)break;
      this.rivalGold-=item.cost;this.addItem(id,u);this.emit('purchase',u,{source:u.id,text:u.name+' 购买 '+item.name,amount:item.cost});
    }
  }
  private abilityContext():AbilityContext{return {now:this.time,units:this.units,navigation:this.navigation,unit:id=>this.unit(id),hurt:(v,amount,source,physical)=>this.hurt(v,amount,source,physical),slow:(v,factor,duration)=>this.slow(v,factor,duration),emit:(kind,p,extra)=>this.emit(kind,p,extra)};}
  private spawnCamp(camp:typeof this.camps[number]){camp.unitIds=[];camp.respawnAt=0;const d=camp.definition;for(let i=0;i<d.count;i++){const angle=i*Math.PI*2/d.count,p=this.navigation.nearest({x:d.x+(d.count>1?Math.cos(angle)*95:0),y:d.y+(d.count>1?Math.sin(angle)*95:0)}),u=this.create(d.model,2,'neutral',p);Object.assign(u,{name:d.count===1?d.name:d.model==='kobold'?'狗头人':d.model==='satyr'?'萨特':'熊怪',maxHp:d.hp,hp:d.hp,damage:d.damage,range:110,speed:240,scale:d.scale,home:{...p},campId:d.id,bounty:d.gold,experience:d.xp});camp.unitIds.push(u.id);}}
  goToCamp(id:string){const camp=this.camps.find(c=>c.definition.id===id);if(!camp)return false;return this.move(this.navigation.nearest(camp.definition));}
  skillError(slot:SkillSlot,target?:Point|string){return this.skillErrorFor(this.hero,slot,target);}
  skillErrorFor(u:CombatUnit|undefined,slot:SkillSlot,target?:Point|string){if(!u?.heroId||this.phase!=='playing'||this.paused||u.hp<=0)return u?.hp===0?'英雄正在等待复活':'当前不能施法';if(u.stunUntil>this.time||u.tauntUntil>this.time||this.extraAbilities.isSilenced(u,this.time))return '受控制，暂时无法施法';if(this.extraAbilities.isChanneling(u,this.time))return '正在持续施法';const s=HEROES[u.heroId!].skills[slot];if(u.rootUntil>this.time&&['blink','leap','teleport'].includes(s.id))return '定身期间无法位移';if(u.level<s.level)return `${s.level} 级解锁 ${s.name}`;if(u.cooldowns[slot]>this.time)return '技能尚在冷却';if(u.mana<s.mana)return '法力不足';if(u.invulnerableUntil>this.time)return '正在进行无敌斩';
    if(s.target==='enemy'){const v=typeof target==='string'?this.unit(target):undefined;if(!v||v.team===u.team||v.hp<=0||isStructure(v))return '请选择敌军或野怪';if(v.invulnerableUntil>this.time||v.returning)return '目标暂时无法受到技能影响';if(distance(u,v)>s.range+v.radius)return '目标超出施法距离';if(u.id==='rival'&&(!this.canSee(u,v)||this.inFountain(v)))return '目标不在视野内';}
    if(s.target==='point'){if(!target||typeof target==='string')return '请选择施法位置';if(distance(u,target)>s.range)return '位置超出施法距离';}return null;}
  cast(slot:SkillSlot,target?:Point|string){return this.castFor(this.hero,slot,target);}
  castFor(u:CombatUnit,slot:SkillSlot,target?:Point|string){const error=this.skillErrorFor(u,slot,target);if(error){if(u?.id==='hero')this.message=error;return false;}const s=HEROES[u.heroId!].skills[slot];const facingTarget=typeof target==='string'?this.unit(target):target;if(facingTarget&&distance(u,facingTarget)>1)u.facing=Math.atan2(facingTarget.y-u.y,facingTarget.x-u.x);u.mana-=s.mana;u.cooldowns[slot]=this.time+s.cooldown;u.pendingHit=null;u.castSerial++;u.actionSerial++;u.spell=s.id;u.action='cast';u.actionUntil=this.time+.6;if(u.id==='hero')this.message=s.name;
    this.emit('ability',u,{source:u.id,target:typeof target==='string'?target:u.id,heroId:u.heroId,effect:s.id,stage:'cast',time:this.time,end:facingTarget?{x:facingTarget.x,y:facingTarget.y}:undefined,direction:u.facing,range:s.range,radius:s.radius});
    if(this.extraAbilities.cast(s,u,target,this.abilityContext()))return true;
    const spell=(p:Point,extra:Partial<CombatEvent>)=>this.emit('spell',p,{source:u.id,heroId:u.heroId,...extra});
    const victim=typeof target==='string'?this.unit(target):undefined,center=target&&typeof target!=='string'?target:u;
    const enemies=(radius:number,p:Point=u)=>this.units.filter(v=>v.hp>0&&v.team!==u.team&&!isStructure(v)&&distance(v,p)<=radius+v.radius);
    switch(s.id){
      case'spin':u.spinUntil=this.time+3.5;u.nextPulse=this.time;spell(u,{effect:'spin',radius:s.radius});break;
      case'ward':this.wards.push({...u,until:this.time+5,next:this.time,source:u.id});spell(u,{effect:'ward',radius:s.radius});break;
      case'slash':u.invulnerableUntil=this.time+1.2;u.path=[];this.slashes.push({source:u.id,target:victim!.id,remaining:6,next:this.time});spell(victim!,{effect:'slash',radius:80});break;
      case'call':u.guardUntil=this.time+2.5;for(const v of enemies(s.radius)){v.tauntUntil=this.time+2.5;v.tauntId=u.id;v.targetId=u.id;}spell(u,{effect:'stomp',radius:s.radius});break;
      case'helix':for(const v of enemies(s.radius))this.hurt(v,120+u.level*20,u);spell(u,{effect:'stomp',radius:s.radius});break;
      case'cull':{const execute=victim!.hp<=victim!.maxHp*.3;this.hurt(victim!,execute?victim!.maxHp*3:170+u.level*15,u);if(victim!.hp<=0){u.cooldowns[slot]=this.time;u.hp=Math.min(u.maxHp,u.hp+100);}spell(victim!,{effect:'stomp',radius:120});break;}
      case'nova':for(const v of enemies(s.radius,center)){this.slow(v,.5,3);this.hurt(v,100+u.level*20,u);}spell(center,{effect:'frost',radius:s.radius});break;
      case'freeze':victim!.rootUntil=this.time+2.5;this.hurt(victim!,70+u.level*15,u);spell(victim!,{effect:'frost',radius:110,target:victim!.id});break;
      case'storm':u.stormUntil=this.time+3.5;u.nextPulse=this.time;u.path=[];u.order='hold';spell(u,{effect:'storm',radius:s.radius});break;
    }return true;
  }
  private hurt(v:CombatUnit,amount:number,source:CombatUnit,physical=false):number {
    if(this.phase!=='playing'||v.hp<=0||v.invulnerableUntil>this.time||v.returning)return 0;
    const damage=Math.min(v.hp,amount*(v.guardUntil>this.time||v.stormUntil>this.time?.5:1)*(physical?armorMultiplier(v.armor):1));
    v.hp=Math.max(0,v.hp-damage);this.emit('damage',v,{amount:Math.round(damage),target:v.id,source:source.id,physical});
    if(v.team===2&&source.team!==2){for(const ally of this.units)if(ally.campId===v.campId&&ally.hp>0&&!ally.returning){ally.targetId=source.id;ally.repathAt=0;}}
    if(v.hp>0)return damage;
    this.extraAbilities.cancel(v);v.deadAt=this.time;v.action='dead';v.actionSerial++;v.path=[];v.pendingHit=null;v.targetId=null;v.spinUntil=v.stormUntil=0;
    this.emit('kill',v,{target:v.id,source:source.id,text:v.name,heroId:v.kind==='hero'?v.heroId:undefined});
    if(v.id==='rival'){this.rivalLastSeen=null;this.rivalSeesPlayer=false;}
    if(v.id==='hero'){this.deaths++;v.respawnAt=this.time+8;this.message='英雄阵亡，8 秒后在近卫泉水复活';}else if(v.kind==='hero')v.respawnAt=this.time+14;
    for(const receiver of [this.hero,this.unit('rival')]){
      if(!receiver||receiver.hp<=0||v.team===receiver.team||source.team!==receiver.team)continue;
      const lastHit=source.id===receiver.id;
      if(lastHit){const bounty=v.bounty??(v.kind==='hero'?180:isStructure(v)?250:v.kind==='ranged'?48:38);
        if(receiver.id==='hero'){this.kills++;if(!isStructure(v))this.lastHits++;if(v.kind==='neutral')this.neutralKills++;this.gold+=bounty;this.goldEarned+=bounty;}
        else{this.rivalGold+=bounty;this.rivalGoldEarned+=bounty;}
        this.emit('gold',v,{amount:bounty,text:`+${bounty} 金币`,source:source.id});
      }
      if(lastHit||distance(receiver,v)<1100)this.gainExperience(v.experience?(lastHit?v.experience:Math.floor(v.experience*.5)):v.kind==='hero'?(lastHit?180:100):isStructure(v)?250:lastHit?55:30,receiver);
    }
    if(v.kind==='base'){this.phase=v.team===1?'won':'lost';this.message=v.team===1?'胜利！天灾冰封王座已被摧毁':'战败！近卫世界之树已被摧毁';this.emit('result',v,{text:this.message});}
    return damage;
  }
  private slow(v:CombatUnit,factor:number,duration:number){v.slowFactor=v.slowUntil>this.time?Math.min(v.slowFactor,factor):factor;v.slowUntil=Math.max(v.slowUntil,this.time+duration);}
  private attackHit(v:CombatUnit,source:CombatUnit,damage:number,orb?:Orb,lifesteal=0){
    const dealt=this.hurt(v,damage,source,true);if(!dealt)return;
    this.emit('impact',v,{source:source.id,target:v.id,effect:source.kind==='tower'?'impact':source.heroId==='maiden'||orb==='frost'?'frost':source.heroId==='axe'?'axe':source.heroId==='juggernaut'?'blade':undefined,radius:source.kind==='tower'?150:95,direction:source.facing,height:isStructure(v)?160:85});
    if(isStructure(v))return;
    this.extraAbilities.onAttack(source,v,dealt,this.abilityContext());
    if(lifesteal>0&&source.hp>0){const heal=Math.min(source.maxHp-source.hp,dealt*lifesteal);source.hp+=heal;if(heal>0)this.emit('heal',source,{text:`+${Math.round(heal)}`,effect:'vamp'});}
    if(orb==='slow'&&v.hp>0)this.slow(v,.65,2);
    if(orb==='frost'&&v.hp>0){this.slow(v,.5,2);if(v.frostReadyAt<=this.time){v.rootUntil=Math.max(v.rootUntil,this.time+.65);v.stunUntil=Math.max(v.stunUntil,this.time+.65);v.pendingHit=null;v.frostReadyAt=this.time+3;}}
    if(orb==='splash'){this.emit('spell',v,{effect:'impact',radius:240});for(const other of this.units)if(other.id!==v.id&&other.hp>0&&other.team!==source.team&&!isStructure(other)&&distance(other,v)<240+other.radius)this.hurt(other,damage*.45,source,true);}
  }
  private gainExperience(amount:number,h=this.hero){if(h.level>=10)return;h.xp+=amount;this.emit('heal',h,{text:`+${amount} 经验`});while(h.level<10&&h.xp>=XP_REQUIRED(h.level)){h.xp-=XP_REQUIRED(h.level);h.level++;h.maxHp+=110;h.hp=Math.min(h.maxHp,h.hp+160);h.maxMana+=45;h.mana=Math.min(h.maxMana,h.mana+80);h.damage+=8;this.emit('level',h,{effect:'level',text:`升级！Lv.${h.level}${h.level===3?' · 终极技能已解锁':''}`});if(h.id==='hero')this.message=`升至 ${h.level} 级${h.level===3?'，R 终极技能已解锁':''}`;}if(h.level===10)h.xp=0;}
  private acquire(u:CombatUnit){const range=u.kind==='tower'?u.range:u.team===2?330:600;let best:CombatUnit|undefined,score=Infinity;for(const v of this.units){if(v.team===u.team||v.hp<=0||v.returning||(u.team!==2&&v.team===2))continue;if(u.id==='rival'&&!isStructure(v)&&(!this.canSee(u,v)||this.inFountain(v)))continue;const d=distance(u,v);if(d>range+v.radius)continue;const s=d+(isStructure(v)?350:0);if(s<score){best=v;score=s;}}return best;}
  private rivalMove(u:CombatUnit,point:Point,mode:typeof this.rivalMode){
    if(!u.destination||distance(u.destination,point)>40||u.order!=='move'){u.path=[];u.pathGoal=undefined;u.repathAt=0;}
    this.rivalMode=mode;u.order='move';u.destination={x:point.x,y:point.y};u.targetId=null;u.pendingHit=null;
  }
  private thinkRival(u:CombatUnit){
    this.rivalSeesPlayer=!!this.hero&&this.canSee(u,this.hero)&&!this.inFountain(this.hero);
    if(this.rivalSeesPlayer)this.rivalLastSeen={x:this.hero.x,y:this.hero.y,until:this.time+RIVAL_MEMORY};
    this.autoBuy(u);
    if(!this.inFountain(u)&&u.maxHp-u.hp>=itemById('tango')!.consumable!.heal&&!this.itemUseError('tango',u))this.useItem('tango',u);
    if(u.tauntUntil>this.time)return false;
    if(!this.rivalSeesPlayer&&u.targetId==='hero'){u.targetId=null;u.pendingHit=null;u.path=[];u.repathAt=0;this.rivalThinkAt=0;}
    if(shouldRecover(u,false))this.rivalRecovering=true;
    if(this.rivalRecovering&&this.inFountain(u)&&!shouldRecover(u,true)){this.rivalRecovering=false;this.rivalThinkAt=0;u.destination=null;u.path=[];this.rivalMode='idle';}
    // Never overwrite an escape channel with a new movement command every tick.
    if(this.extraAbilities.isChanneling(u,this.time))return true;
    if(this.rivalRecovering){
      this.rivalLastSeen=null;
      if(this.inFountain(u)){this.rivalMode='recover';u.order='hold';u.destination=null;u.targetId=null;u.pendingHit=null;u.path=[];return true;}
      if(u.stormUntil>this.time){u.stormUntil=0;this.extraAbilities.cancel(u);}
      if(this.time>=this.rivalThinkAt){
        this.rivalThinkAt=this.time+.35;
        const seen=this.units.filter(v=>v.team!==u.team&&this.canSee(u,v)&&!this.inFountain(v)),allies=this.units.filter(v=>v.team===u.team&&v.hp>0&&distance(u,v)<1100);
        const intent=chooseRivalSkill(u,this.unit(u.targetId),seen,allies,this.time,true);
        if(intent)this.castFor(u,intent.slot,intent.target);
      }
      if(!this.extraAbilities.isChanneling(u,this.time))this.rivalMove(u,this.fountainSpawn(u.team),'retreat');return true;
    }
    if(this.time<this.rivalThinkAt)return u.order==='move'&&!!u.destination;
    this.rivalThinkAt=this.time+.35;
    const seen=this.units.filter(v=>v.team!==u.team&&this.canSee(u,v)&&!this.inFountain(v)),allies=this.units.filter(v=>v.team===u.team&&v.hp>0&&distance(u,v)<1100);
    const hazards=this.extraAbilities.hazards(this.time).filter(h=>this.unit(h.source)?.team!==u.team&&distance(u,h)<=RIVAL_SIGHT&&(this.navigation.lineVisible?.(u,h)??true));
    const dodge=hazardEvasionDestination(u,hazards,this.navigation,this.time)??evasiveDestination(u,seen,this.navigation,this.time);
    if(dodge){this.extraAbilities.cancel(u);this.rivalMove(u,dodge,'evade');this.rivalMoveUntil=this.time+.65;return true;}
    if(this.rivalMode==='evade'&&this.time<this.rivalMoveUntil&&u.destination&&distance(u,u.destination)>25)return true;
    let target:CombatUnit|undefined;
    if(this.rivalSeesPlayer)target=this.hero;
    else if(this.rivalLastSeen){
      if(this.time<this.rivalLastSeen.until&&distance(u,this.rivalLastSeen)>40){this.rivalMove(u,this.rivalLastSeen,'search');return true;}
      this.rivalLastSeen=null;u.destination=null;u.path=[];u.repathAt=0;
    }
    if(!target)target=seen.filter(v=>isCreep(v)).sort((a,b)=>Number(b.hp<=u.damage)-Number(a.hp<=u.damage)||distance(u,a)-distance(u,b))[0]??this.objective(1,u);
    this.rivalTarget(u,target);this.rivalMode=target?(isStructure(target)?'push':'fight'):'idle';
    const intent=chooseRivalSkill(u,target,seen,allies,this.time,false);
    if(intent)this.castFor(u,intent.slot,intent.target);
    return false;
  }
  private rivalTarget(u:CombatUnit,target:CombatUnit|undefined){
    if((target?.id??null)!==u.targetId){u.targetId=target?.id??null;u.path=[];u.repathAt=0;u.pendingHit=null;}
    u.destination=null;u.order=target?'attack':'idle';
  }
  private walk(u:CombatUnit,point:Point,dt:number){if(u.rootUntil>this.time||u.invulnerableUntil>this.time||u.stormUntil>this.time)return;
    if(u.path.length&&u.repathAt<=this.time&&!this.navigation.lineFree(u,u.path[0]))u.path=[];
    const movedGoal=!u.pathGoal||distance(point,u.pathGoal)>80;
    if((!u.path.length||movedGoal)&&u.repathAt<=this.time){u.path=this.navigation.findPath(u,point);u.pathGoal={x:point.x,y:point.y};u.repathAt=this.time+.4;}
    // A sidestep may carry a creep past a corner. Continue to the next visible
    // segment instead of turning back to stand on the old grid waypoint.
    while(u.path.length>1&&distance(u,u.path[0])<100&&this.navigation.lineFree(u,u.path[1]))u.path.shift();
    let budget=u.speed*(u.slowUntil>this.time?u.slowFactor:1)*dt;
    while(budget>0&&u.path.length){const p=u.path[0],d=distance(u,p);if(d<1){u.path.shift();continue;}const step=Math.min(d,budget);
      const next=isCreep(u)?creepStep(u,p,step,this.units,this.navigation):{x:u.x+(p.x-u.x)/d*step,y:u.y+(p.y-u.y)/d*step};
      if(!next)break;
      if(!this.navigation.lineFree(u,next)){u.path=[];u.repathAt=this.time+.2;break;}
      u.facing=Math.atan2(next.y-u.y,next.x-u.x);u.x=next.x;u.y=next.y;budget-=step;if(distance(u,p)<1)u.path.shift();if(u.spinUntil<=this.time&&u.actionUntil<=this.time)u.action='walk';
    }
  }
  private walkDirection(u:CombatUnit,dt:number){
    if(!this.steering||u.rootUntil>this.time)return;
    const speed=u.speed*(u.slowUntil>this.time?u.slowFactor:1)*dt,dx=this.steering.x*speed,dy=this.steering.y*speed;
    const full={x:u.x+dx,y:u.y+dy},xOnly={x:u.x+dx,y:u.y},yOnly={x:u.x,y:u.y+dy};
    const candidates=Math.abs(dx)>=Math.abs(dy)?[full,xOnly,yOnly]:[full,yOnly,xOnly];
    // Slide along blocked terrain instead of navigating around it or crossing it.
    const next=candidates.find(p=>distance(u,p)>.0001&&this.navigation.lineFree(u,p));
    u.facing=Math.atan2(this.steering.y,this.steering.x);
    if(next){u.x=next.x;u.y=next.y;}
    if(u.spinUntil<=this.time)u.action=next?'walk':'idle';
  }
  private respawn(u:CombatUnit){this.extraAbilities.cancel(u);this.itemRegeneration.delete(u.id);const p=this.fountainSpawn(u.team);u.x=p.x;u.y=p.y;u.hp=u.maxHp;u.mana=u.maxMana;u.deadAt=-1;u.respawnAt=0;u.order='idle';u.destination=null;u.action='idle';u.actionUntil=0;u.attackAt=0;u.repathAt=0;u.actionSerial++;u.path=[];u.pathGoal=undefined;u.avoidance=undefined;u.pendingHit=null;u.targetId=null;u.rootUntil=u.slowUntil=u.tauntUntil=u.guardUntil=u.invulnerableUntil=u.spinUntil=u.stormUntil=0;u.stunUntil=0;u.slowFactor=.5;u.frostReadyAt=0;u.cooldowns={q:0,w:0,r:0};if(u.id==='rival'){this.rivalLastSeen=null;this.rivalSeesPlayer=false;this.rivalThinkAt=0;this.rivalRecovering=false;this.rivalMode='idle';this.rivalMoveUntil=0;}if(u.id==='hero'){this.message='已在近卫泉水复活，生命与法力已恢复';this.selectedId='hero';this.steering=null;}this.emit('respawn',u,{target:u.id,text:u.name+' 已在泉水复活',effect:'heal'});}
  step(dt=STEP){if(this.phase!=='playing'||this.paused||!Number.isFinite(dt)||dt<=0)return;const previousTime=this.time;this.time+=dt;
    // Integer awards follow simulation time, including death, but never pause or game over.
    const income=Math.floor(this.time+1e-8)*PASSIVE_GOLD_PER_SECOND-this.passiveGoldEarned;
    if(income>0){this.gold+=income;this.rivalGold+=income;this.passiveGoldEarned+=income;}
    for(const [id,recovery]of this.itemRegeneration){const u=this.unit(id);if(!u||u.hp<=0){this.itemRegeneration.delete(id);continue;}
      const elapsed=Math.max(0,Math.min(this.time,recovery.until)-previousTime);u.hp=Math.min(u.maxHp,u.hp+elapsed*recovery.rate);
      if(this.time+1e-8>=recovery.until)this.itemRegeneration.delete(id);
    }
    for(const camp of this.camps){if(!camp.respawnAt&&camp.unitIds.every(id=>!this.unit(id)||this.unit(id)!.hp<=0))camp.respawnAt=this.time+camp.definition.respawn;if(camp.respawnAt&&this.time>=camp.respawnAt&&this.units.every(u=>u.team===2||u.hp<=0||distance(u,camp.definition)>450))this.spawnCamp(camp);}
    if(this.time>=this.nextWave){this.nextWave+=18;this.spawnWave();}
    for(const slash of this.slashes){if(slash.next>this.time)continue;const u=this.unit(slash.source);if(!u||u.hp<=0){slash.remaining=0;continue;}let v=this.unit(slash.target);if(!v||v.hp<=0)v=this.units.find(t=>t.team!==u.team&&t.hp>0&&!isStructure(t)&&distance(t,u)<500);if(!v){slash.remaining=0;continue;}const p=this.navigation.nearest({x:v.x-60,y:v.y-40});u.x=p.x;u.y=p.y;u.facing=Math.atan2(v.y-u.y,v.x-u.x);u.action='attack';u.actionSerial++;u.actionUntil=this.time+.2;this.hurt(v,80+u.level*9,u);this.emit('spell',v,{source:u.id,target:v.id,heroId:u.heroId,effect:'slash',radius:100});this.emit('ability',v,{source:u.id,target:v.id,effect:'slash',stage:'hit',time:this.time,radius:100});slash.target=v.id;slash.next+=.16;slash.remaining--;}
    this.slashes=this.slashes.filter(s=>s.remaining>0);
    for(const w of this.wards){if(w.next>this.time)continue;w.next+=.5;for(const u of this.units)if(u.team===this.unit(w.source)?.team&&u.hp>0&&!isStructure(u)&&distance(u,w)<400)u.hp=Math.min(u.maxHp,u.hp+30);}
    this.wards=this.wards.filter(w=>w.until>this.time);
    this.extraAbilities.update(dt,this.abilityContext());
    for(const u of this.units){if(u.hp<=0){if(u.kind==='hero'&&u.respawnAt<=this.time)this.respawn(u);continue;}
      if(u.kind==='neutral'&&u.home){
        const target=this.unit(u.targetId);
        if(!u.returning&&(distance(u,u.home)>650||(target&&distance(target,u.home)>850))){u.returning=true;u.pendingHit=null;u.targetId=null;u.path=[];u.repathAt=0;u.rootUntil=u.stunUntil=u.slowUntil=0;}
        if(u.returning){u.hp=Math.min(u.maxHp,u.hp+u.maxHp*dt*.3);this.walk(u,u.home,dt);if(distance(u,u.home)<15){u.returning=false;u.hp=u.maxHp;u.action='idle';u.path=[];}continue;}
      }
      if(u.kind==='base')continue;
      if(u.kind==='hero'){u.hp=Math.min(u.maxHp,u.hp+dt*1.5);u.mana=Math.min(u.maxMana,u.mana+dt*(u.heroId==='maiden'?6:3.5));if(this.inFountain(u)){u.hp=Math.min(u.maxHp,u.hp+dt*90);u.mana=Math.min(u.maxMana,u.mana+dt*40);}}
      if(u.stunUntil>this.time){u.action='idle';u.pendingHit=null;continue;}
      if((u.spinUntil>this.time||u.stormUntil>this.time)&&u.nextPulse<=this.time){u.nextPulse+=.25;const storm=u.stormUntil>this.time;for(const v of this.units)if(v.hp>0&&v.team!==u.team&&!isStructure(v)&&distance(v,u)<(storm?500:285)+v.radius){this.hurt(v,(storm?100+u.level*15:75+u.level*10)*.25,u);if(storm)this.slow(v,.5,.5);}if(storm)this.emit('spell',{x:u.x+Math.cos(this.time*7)*240,y:u.y+Math.sin(this.time*7)*240},{effect:'blizzard',radius:160});}
      const rivalSearching=u.id==='rival'&&this.thinkRival(u);
      if(u.pendingHit&&u.pendingHit.at<=this.time&&!this.extraAbilities.isChanneling(u,this.time)){const victim=this.unit(u.pendingHit.id);u.pendingHit=null;if(victim&&victim.hp>0&&distance(u,victim)<=u.range+victim.radius+HIT_LEEWAY){const orb=u.id==='hero'?this.activeOrb??undefined:u.id==='rival'?this.rivalActiveOrb??undefined:undefined,lifesteal=u.id==='hero'?this.lifesteal:u.id==='rival'?this.rivalInventory.reduce((n,id)=>Math.max(n,itemById(id)?.lifesteal??0),0):0;
          this.emit('attack',u,{source:u.id,target:victim.id,effect:u.kind==='tower'?(u.team===0?'rock':'spirit'):u.heroId==='maiden'?'frost':u.heroId==='axe'?'axe':u.heroId==='juggernaut'?'blade':undefined,direction:u.facing,height:isStructure(u)?180:100});
          if(u.range>200)this.projectiles.push({id:++this.eventSerial,source:u.id,target:victim.id,team:u.team,x:u.x,y:u.y,damage:u.damage,speed:u.kind==='tower'?850:1050,life:3,style:u.kind==='tower'?(u.team===0?'rock':'spirit'):orb==='frost'||u.heroId==='maiden'?'frost':undefined,orb,lifesteal});else this.attackHit(victim,u,u.damage,orb,lifesteal);
        }else if(u.id==='hero'&&victim&&victim.hp>0)this.message='目标已脱离攻击距离，正在追击';}
      if(u.invulnerableUntil>this.time||u.stormUntil>this.time||this.extraAbilities.isChanneling(u,this.time))continue;
      if(u.actionUntil<=this.time&&u.spinUntil<=this.time)u.action='idle';
      if(u.id==='hero'&&u.tauntUntil<=this.time&&u.order==='steer'){this.walkDirection(u,dt);continue;}
      if(u.id==='hero'&&u.tauntUntil<=this.time&&u.order==='move'&&u.destination){this.walk(u,u.destination,dt);if(distance(u,u.destination)<12){u.order='idle';u.destination=null;u.path=[];}continue;}
      if(u.id==='hero'&&u.tauntUntil<=this.time&&u.order==='hold')continue;
      if(rivalSearching){if(u.destination)this.walk(u,u.destination,dt);continue;}
      let target=this.unit(u.tauntUntil>this.time?u.tauntId:u.targetId);if(!target||target.hp<=0||target.team===u.team||(u.id!=='hero'&&u.id!=='rival'&&distance(u,target)>(u.kind==='tower'?u.range+target.radius:1100))){target=this.acquire(u);u.targetId=target?.id??null;}
      if(target){if(!isStructure(u))u.facing=Math.atan2(target.y-u.y,target.x-u.x);if(distance(u,target)<=u.range+target.radius){u.path=[];if(u.attackAt<=this.time&&u.spinUntil<=this.time&&u.actionUntil<=this.time){u.action='attack';u.actionSerial++;u.actionUntil=this.time+.5;u.attackAt=this.time+u.attackPeriod;u.pendingHit={id:target.id,at:this.time+.3};}
        }else if(!isStructure(u))this.walk(u,target,dt);
      }else if(u.kind==='melee'||u.kind==='ranged'){const goal=this.objective(u.team===0?0:1,u);if(goal)this.walk(u,goal,dt);}
    }
    for(const p of this.projectiles){p.life-=dt;const target=this.unit(p.target),source=this.unit(p.source);if(!target||target.hp<=0||!source){p.life=0;continue;}const d=distance(p,target),step=p.speed*dt;if(d<=step+target.radius){this.attackHit(target,source,p.damage,p.orb,p.lifesteal);p.life=0;}else{p.x+=(target.x-p.x)/d*step;p.y+=(target.y-p.y)/d*step;}}
    this.projectiles=this.projectiles.filter(p=>p.life>0);
    // Soft separation never pushes a unit through the original pathing mask.
    const moving=this.units.filter(u=>u.hp>0&&!isStructure(u)&&!isCreep(u));for(let a=0;a<moving.length;a++)for(let b=a+1;b<moving.length;b++){const u=moving[a],v=moving[b],d=distance(u,v),limit=(u.radius+v.radius)*.75;if(d>=limit)continue;const angle=d>.01?Math.atan2(v.y-u.y,v.x-u.x):(a+b)*2.399,push=Math.min(45*dt,(limit-d)*.2),dx=Math.cos(angle)*push,dy=Math.sin(angle)*push;for(const [unit,sign]of [[u,-1],[v,1]]as const){if(unit.rootUntil>this.time||unit.stunUntil>this.time||unit.stormUntil>this.time||this.extraAbilities.isChanneling(unit,this.time))continue;const next={x:unit.x+dx*sign,y:unit.y+dy*sign};if(this.navigation.lineFree(unit,next)){unit.x=next.x;unit.y=next.y;}}}
    this.units=this.units.filter(u=>u.hp>0||u.kind==='hero'||isStructure(u)||this.time-u.deadAt<2.5);
  }
}
