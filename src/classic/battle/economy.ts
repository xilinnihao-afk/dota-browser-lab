export type Orb = 'slow'|'frost'|'splash';
export interface ItemDefinition {
  id:string;name:string;icon:string;cost:number;description:string;
  damage?:number;armor?:number;health?:number;lifesteal?:number;orb?:Orb;
  consumable?:{charges:number;heal:number;duration:number};
}
export const ITEMS:readonly ItemDefinition[]=[
  {id:'claws',name:'攻击之爪',icon:'claws',cost:150,damage:12,description:'+12 攻击力'},
  {id:'sword',name:'阔剑',icon:'sword',cost:400,damage:28,description:'+28 攻击力'},
  {id:'armor',name:'锁子甲',icon:'armor',cost:180,armor:5,description:'+5 护甲，减少普通攻击伤害'},
  {id:'vitality',name:'生命护符',icon:'vitality',cost:250,health:200,description:'+200 最大生命'},
  {id:'vampire',name:'吸血面具',icon:'vampire',cost:450,lifesteal:.18,description:'普攻对生物造成的实际伤害，18% 转为生命'},
  {id:'orbSlow',name:'迟缓法球',icon:'orbSlow',cost:350,orb:'slow',description:'普攻减速 35%，持续 2 秒'},
  {id:'orbFrost',name:'霜冻法球',icon:'orbFrost',cost:600,orb:'frost',description:'普攻减速 50%；每 3 秒可冻结目标 0.65 秒'},
  {id:'orbSplash',name:'溅射法球',icon:'orbSplash',cost:500,orb:'splash',description:'普攻对目标周围 240 范围敌军造成 45% 溅射伤害'},
  {id:'tango',name:'吃树',icon:'sprout',cost:90,consumable:{charges:3,heal:115,duration:16},description:'一组 3 次；点击背包使用，每次 16 秒恢复 115 生命，受伤不中断。重复购买叠加次数。'},
];
export const itemById=(id:string)=>ITEMS.find(item=>item.id===id);
export const INVENTORY_SLOTS=6;
export const STARTING_GOLD=200;
export const PASSIVE_GOLD_PER_SECOND=1;
export const armorMultiplier=(armor:number)=>1/(1+.06*Math.max(0,armor));
