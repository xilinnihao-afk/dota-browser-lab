import assets from './assets.json';
export {assets};
export type HeroId='juggernaut'|'axe'|'maiden'|'antimage'|'drow'|'lich'|'pudge'|'lina'|'mirana'|'furion'|'earthshaker'|'shaman';
export type SkillSlot='q'|'w'|'r';
// Skill slots stay stable in simulation data; keyboard bindings avoid WASD.
export const SKILL_KEYS:Record<SkillSlot,string>={q:'Q',w:'E',r:'R'};
export type ModelId=keyof typeof assets.models;
export interface Skill {id:keyof typeof assets.icons;name:string;description:string;mana:number;cooldown:number;range:number;radius:number;target:'self'|'enemy'|'point';level:number}
export interface HeroDefinition {id:HeroId;name:string;title:string;description:string;hp:number;mana:number;damage:number;range:number;speed:number;attackPeriod:number;scale:number;skills:Record<SkillSlot,Skill>}
export const HEROES:Record<HeroId,HeroDefinition>={
  juggernaut:{id:'juggernaut',name:'剑圣',title:'近战 · 持续伤害',description:'旋转切入兵线，用治疗守卫恢复，再以无敌斩收割。',hp:820,mana:330,damage:53,range:110,speed:384,attackPeriod:1.05,scale:1.25,skills:{
    q:{id:'spin',name:'剑刃风暴',description:'旋转 3.5 秒，对周围敌军持续造成伤害。期间可移动。',mana:65,cooldown:10,range:0,radius:285,target:'self',level:1},
    w:{id:'ward',name:'治疗守卫',description:'在身边放置守卫，持续 5 秒治疗范围内友军。',mana:70,cooldown:15,range:0,radius:400,target:'self',level:1},
    r:{id:'slash',name:'无敌斩',description:'选择敌军，在附近敌人之间连续斩击 6 次，期间无敌。',mana:120,cooldown:22,range:650,radius:420,target:'enemy',level:3}}},
  axe:{id:'axe',name:'斧王',title:'近战 · 控制与收割',description:'嘲讽聚拢敌军，反击螺旋清兵，淘汰之刃斩杀残血。',hp:1080,mana:300,damage:49,range:120,speed:360,attackPeriod:1.2,scale:1.25,skills:{
    q:{id:'call',name:'狂战士之吼',description:'嘲讽周围敌军 2.5 秒，期间获得 50% 减伤。',mana:45,cooldown:9,range:0,radius:350,target:'self',level:1},
    w:{id:'helix',name:'反击螺旋',description:'挥斧攻击周围所有敌军，造成一次范围伤害。',mana:55,cooldown:7,range:0,radius:300,target:'self',level:1},
    r:{id:'cull',name:'淘汰之刃',description:'选择敌军；低于 30% 生命直接斩杀，否则造成伤害。斩杀成功返还冷却。',mana:90,cooldown:16,range:300,radius:0,target:'enemy',level:3}}},
  maiden:{id:'maiden',name:'水晶室女',title:'远程 · 减速与定身',description:'冰霜新星控制兵线，冰封禁制困住目标，再释放极寒领域。',hp:660,mana:580,damage:40,range:560,speed:348,attackPeriod:1.3,scale:1.5,skills:{
    q:{id:'nova',name:'冰霜新星',description:'选择地面，在范围内造成伤害并减速 3 秒。',mana:75,cooldown:8,range:850,radius:320,target:'point',level:1},
    w:{id:'freeze',name:'冰封禁制',description:'选择敌军，造成伤害并定身 2.5 秒。',mana:65,cooldown:9,range:700,radius:0,target:'enemy',level:1},
    r:{id:'storm',name:'极寒领域',description:'原地引导 3.5 秒，对大范围敌军持续造成伤害。移动可取消引导。',mana:140,cooldown:22,range:0,radius:500,target:'self',level:3}}},
  antimage:{id:'antimage',name:'敌法师',title:'近战 · 削蓝与机动',description:'强化双刃消耗敌人法力，闪烁追击或脱离，再用法力虚空收割。',hp:760,mana:360,damage:48,range:115,speed:396,attackPeriod:.95,scale:1.35,skills:{
    q:{id:'manaBreak',name:'法力损毁',description:'强化普攻 6 秒，命中时削减敌方法力并造成额外伤害。',mana:40,cooldown:10,range:0,radius:0,target:'self',level:1},
    w:{id:'blink',name:'闪烁',description:'选择地面，瞬间移动至可通行的位置，可用于追击或逃脱。',mana:50,cooldown:8,range:900,radius:0,target:'point',level:1},
    r:{id:'manaVoid',name:'法力虚空',description:'选择敌军，按其已损失法力造成伤害，并波及附近敌军。',mana:110,cooldown:22,range:650,radius:250,target:'enemy',level:3}}},
  drow:{id:'drow',name:'卓尔游侠',title:'远程 · 冰箭与压制',description:'用冰箭减速追击，以狂风阻止近身，释放多重箭攻击前方敌军。',hp:690,mana:410,damage:51,range:620,speed:360,attackPeriod:1.15,scale:1.35,skills:{
    q:{id:'frostArrows',name:'霜冻之箭',description:'强化普攻 6 秒，命中敌军时附加减速。',mana:45,cooldown:10,range:0,radius:0,target:'self',level:1},
    w:{id:'gust',name:'狂风',description:'向指定方向释放狂风，伤害、击退并沉默路径上的敌军。',mana:65,cooldown:11,range:800,radius:150,target:'point',level:1},
    r:{id:'multishot',name:'多重箭',description:'原地引导 1.2 秒，向指定方向发射 3 轮扇形箭。移动或受到强控制会中断。',mana:110,cooldown:20,range:950,radius:220,target:'point',level:3}}},
  lich:{id:'lich',name:'巫妖',title:'远程 · 冰霜与连锁',description:'冰霜冲击压低敌群血量，以霜冻护盾自保，连环霜冻惩罚聚集敌军。',hp:650,mana:600,damage:39,range:560,speed:348,attackPeriod:1.3,scale:1.25,skills:{
    q:{id:'frostBlast',name:'冰霜冲击',description:'选择地面，对范围内敌军造成伤害并减速。',mana:75,cooldown:8,range:800,radius:280,target:'point',level:1},
    w:{id:'frostShield',name:'霜冻护盾',description:'为自己施加持续 5 秒、减伤 50% 的护盾，并减速周围敌军。',mana:70,cooldown:14,range:0,radius:320,target:'self',level:1},
    r:{id:'chainFrost',name:'连环霜冻',description:'选择敌军，释放在附近敌军之间弹跳 6 次的霜冻。',mana:130,cooldown:23,range:700,radius:500,target:'enemy',level:3}}},
  pudge:{id:'pudge',name:'屠夫',title:'近战 · 钩取与控制',description:'肉钩拉回敌人，腐烂减速缠斗，肢解困住近身目标并恢复自己。',hp:1120,mana:350,damage:55,range:125,speed:336,attackPeriod:1.35,scale:1.1,skills:{
    q:{id:'hook',name:'肉钩',description:'向指定方向甩出肉钩，伤害并拉回首先命中的敌军。',mana:75,cooldown:10,range:1000,radius:100,target:'point',level:1},
    w:{id:'rot',name:'腐烂',description:'释放毒雾 5 秒，持续伤害并减速周围敌军，同时损失自身生命。',mana:25,cooldown:9,range:0,radius:300,target:'self',level:1},
    r:{id:'dismember',name:'肢解',description:'原地引导 2.5 秒，控制近处敌军并吸取生命。移动可取消引导。',mana:100,cooldown:21,range:220,radius:0,target:'enemy',level:3}}},
  lina:{id:'lina',name:'秀逗魔导士',title:'远程 · 火焰与爆发',description:'龙破斩穿透兵线，预判光击阵控制敌人，再用神灭斩完成击杀。',hp:680,mana:560,damage:44,range:590,speed:360,attackPeriod:1.2,scale:1.5,skills:{
    q:{id:'dragonSlave',name:'龙破斩',description:'向指定方向放出火焰冲击，伤害直线上的敌军。',mana:75,cooldown:8,range:950,radius:140,target:'point',level:1},
    w:{id:'lightStrike',name:'光击阵',description:'选择地面，0.6 秒后造成范围伤害并眩晕敌军。',mana:80,cooldown:10,range:800,radius:250,target:'point',level:1},
    r:{id:'laguna',name:'神灭斩',description:'选择敌军，释放强力闪电造成高额单体伤害。',mana:140,cooldown:24,range:650,radius:0,target:'enemy',level:3}}},
  mirana:{id:'mirana',name:'月之女祭司',title:'远程 · 神箭与跳跃',description:'月神之箭远程控制，跳跃调整战场位置，群星风暴打击近处敌群。',hp:740,mana:450,damage:47,range:600,speed:384,attackPeriod:1.2,scale:1.05,skills:{
    q:{id:'arrow',name:'月神之箭',description:'向指定方向射出神箭，伤害并眩晕首先命中的敌军。',mana:75,cooldown:11,range:1200,radius:90,target:'point',level:1},
    w:{id:'leap',name:'跳跃',description:'选择地面，跃向附近可通行位置，用于切入或脱离战斗。',mana:50,cooldown:10,range:550,radius:0,target:'point',level:1},
    r:{id:'starfall',name:'群星风暴',description:'召唤流星，对身边大范围内的敌军造成伤害。',mana:120,cooldown:20,range:0,radius:550,target:'self',level:3}}},
  furion:{id:'furion',name:'先知',title:'远程 · 控制与支援',description:'发芽困住目标，传送支援战线，以自然之怒连锁打击敌军。',hp:720,mana:520,damage:46,range:560,speed:360,attackPeriod:1.2,scale:1.1,skills:{
    q:{id:'sprout',name:'发芽',description:'选择敌军，用自然之力将其定身 3 秒。',mana:65,cooldown:10,range:700,radius:0,target:'enemy',level:1},
    w:{id:'teleport',name:'传送',description:'选择地面，原地引导 2 秒后传送至可通行位置。移动可取消引导。',mana:85,cooldown:18,range:5000,radius:0,target:'point',level:1},
    r:{id:'wrath',name:'自然之怒',description:'选择敌军，能量在附近最多 6 名不同敌军之间连锁造成伤害。',mana:130,cooldown:23,range:1000,radius:700,target:'enemy',level:3}}},
  earthshaker:{id:'earthshaker',name:'撼地神牛',title:'近战 · 震击与团控',description:'沟壑远程震晕，强化图腾近身重击，回音击惩罚密集敌军。',hp:1020,mana:380,damage:54,range:135,speed:348,attackPeriod:1.3,scale:1.1,skills:{
    q:{id:'fissure',name:'沟壑',description:'向指定方向引发地震，伤害并眩晕直线上的敌军。',mana:80,cooldown:11,range:900,radius:140,target:'point',level:1},
    w:{id:'enchant',name:'强化图腾',description:'强化 6 秒内的下一次近战攻击，对附近敌军造成震击伤害并眩晕 1 秒。',mana:50,cooldown:8,range:0,radius:280,target:'self',level:1},
    r:{id:'echo',name:'回音击',description:'震击身边大范围的敌军并眩晕 1 秒，范围内敌人越多，伤害越高。',mana:130,cooldown:24,range:0,radius:550,target:'self',level:3}}},
  shaman:{id:'shaman',name:'暗影萨满',title:'远程 · 妖术与守卫',description:'苍穹震击清理敌群，妖术限制敌方英雄，召唤蛇棒持续压制区域。',hp:700,mana:560,damage:42,range:550,speed:348,attackPeriod:1.3,scale:1.4,skills:{
    q:{id:'shock',name:'苍穹震击',description:'向指定方向释放雷电，对前方范围内的敌军造成伤害。',mana:75,cooldown:8,range:800,radius:220,target:'point',level:1},
    w:{id:'hex',name:'妖术',description:'选择敌军，以妖术禁锢其 3 秒，期间无法移动、攻击或施法。',mana:75,cooldown:12,range:650,radius:0,target:'enemy',level:1},
    r:{id:'serpentWard',name:'群蛇守卫',description:'在指定位置召唤持续 8 秒的守卫阵，自动攻击附近敌军。',mana:140,cooldown:24,range:650,radius:600,target:'point',level:3}}}
};
export const TOWER_IDS=['e00R','u00M'] as const;
export const TOWER_POSITIONS=[{x:-1504,y:-1824},{x:1056,y:-96}] as const;
export const SPAWNS=[{x:-4700,y:-5100},{x:4200,y:3800}] as const;
export const HERO_SPAWN={x:-1280,y:-1480};
export const XP_REQUIRED=(level:number)=>80+level*40;

const ALL_TOWER_IDS=new Set(['e00R','e011','e00S','e019','u00M','u00D','u00N','u00T']);
export function isBattleTower(p:{kind:string;id:string;position:number[]}){return p.kind==='unit'&&ALL_TOWER_IDS.has(p.id);}
