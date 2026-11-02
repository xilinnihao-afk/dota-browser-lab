import {gamePoint,gameRect} from '../viewport';
import {HEROES,type SkillSlot} from './definitions';
import type {BattleSimulation} from './simulation';
import type {Point} from './navigation';
import {TouchPointer,stickVector} from './mobile-input';
import {mobileEnvironment,loadMobileQuality,type MobileQuality} from './mobile-profile';
import './mobile.css';

interface Actions {
  move(value:Point|null):void;attack():void;stop():void;
  aim(slot:SkillSlot,drag:Point|null,release:boolean):void;cancelAim():void;
  shop():void;inventory():void;center():void;recover():void;camps():void;
  preview(id:keyof typeof HEROES):void;quality(value:MobileQuality):void;
}
export function createMobileControls(ui:HTMLElement,icons:Record<string,string>,actions:Actions){
  const root=document.createElement('div');root.className='mobile-controls';
  root.innerHTML=`<div class="mobile-orientation">横屏视野更开阔</div>
    <div class="mobile-play-controls">
      <div class="move-stick" role="group" aria-label="移动摇杆"><span class="stick-guide">移动</span><i class="stick-knob"></i></div>
      <button class="mobile-stop" aria-label="停止移动与攻击">停</button>
      <nav class="mobile-tools" aria-label="战斗工具"><button data-mobile="shop">商店</button><button data-mobile="inventory" aria-expanded="false">背包</button><button data-mobile="camps">野区</button><button data-mobile="center">跟随</button><button data-mobile="recover">回泉</button></nav>
      <div class="mobile-combat" aria-label="触屏攻击与技能">${(['q','w','r']as SkillSlot[]).map(s=>`<button class="touch-skill touch-${s}" data-touch-skill="${s}"><img alt=""><span class="touch-cooldown"></span><b class="touch-time"></b><small></small></button>`).join('')}<button class="touch-attack" aria-label="普攻：攻击附近目标"><img src="${icons.attack}" alt=""><span>普攻</span></button></div>
      <div class="touch-cancel" hidden>取消<br>施法</div><div class="touch-aim-tip" hidden>拖动瞄准 · 松手释放 · 拖入取消区取消</div>
    </div>
    <button class="mobile-quality" aria-label="切换画质">画质：自动</button>
    <div class="mobile-roster" aria-label="触屏选择英雄">${Object.values(HEROES).map(h=>`<button data-mobile-hero="${h.id}" aria-label="选择${h.name}"><img src="${icons[h.id]}" alt=""><span>${h.name}</span></button>`).join('')}</div>`;
  ui.append(root);
  const stick=root.querySelector<HTMLElement>('.move-stick')!,knob=root.querySelector<HTMLElement>('.stick-knob')!,cancel=root.querySelector<HTMLElement>('.touch-cancel')!,tip=root.querySelector<HTMLElement>('.touch-aim-tip')!;
  const moveOwner=new TouchPointer(),skillOwner=new TouchPointer();
  let moving=false,enabled=false,active=mobileEnvironment(),slot:SkillSlot|null=null,origin={x:0,y:0},lastDrag:Point|null=null,cancelling=false,skillButton:HTMLButtonElement|null=null,quality=loadMobileQuality();
  const skillButtons=[...root.querySelectorAll<HTMLButtonElement>('[data-touch-skill]')];
  function releaseCapture(el:HTMLElement,id:number|null){if(id!==null&&el.hasPointerCapture(id))el.releasePointerCapture(id);}
  function resetMove(){const id=moveOwner.id;moveOwner.clear();moving=false;knob.style.transform='translate(-50%,-50%)';stick.classList.remove('held');actions.move(null);releaseCapture(stick,id);}
  function resetAim(){const id=skillOwner.id,button=skillButton;skillOwner.clear();slot=null;skillButton=null;lastDrag=null;cancelling=false;cancel.hidden=tip.hidden=true;cancel.classList.remove('active');ui.classList.remove('is-touch-aiming');skillButtons.forEach(b=>b.classList.remove('aiming'));actions.cancelAim();if(button)releaseCapture(button,id);}
  function reset(){resetMove();resetAim();}
  function resize(){reset();active=mobileEnvironment();document.body.classList.toggle('touch-battle',active);root.hidden=!active;actions.quality(quality);}
  function move(e:PointerEvent){if(!moveOwner.owns(e.pointerId))return;const r=gameRect(stick),radius=r.width*.36,dx=gamePoint(e).x-r.left-r.width/2,dy=gamePoint(e).y-r.top-r.height/2,length=Math.hypot(dx,dy),scale=length>radius?radius/length:1;knob.style.transform=`translate(calc(-50% + ${dx*scale}px),calc(-50% + ${dy*scale}px))`;const value=stickVector(dx,dy,radius);moving=!!value;actions.move(value);}
  stick.onpointerdown=e=>{if(!enabled||e.button!==0||!moveOwner.claim(e.pointerId))return;e.preventDefault();stick.setPointerCapture(e.pointerId);stick.classList.add('held');move(e);};
  stick.onpointermove=move;
  stick.onpointerup=stick.onpointercancel=e=>{if(moveOwner.owns(e.pointerId))resetMove();};
  stick.onlostpointercapture=e=>{if(moveOwner.owns(e.pointerId))resetMove();};
  function aim(e:PointerEvent){if(!skillOwner.owns(e.pointerId)||!slot)return;const drag={x:gamePoint(e).x-origin.x,y:gamePoint(e).y-origin.y};lastDrag=Math.hypot(drag.x,drag.y)>9?drag:null;const r=gameRect(cancel);cancelling=gamePoint(e).x>=r.left&&gamePoint(e).x<=r.right&&gamePoint(e).y>=r.top&&gamePoint(e).y<=r.bottom;cancel.classList.toggle('active',cancelling);if(cancelling)actions.cancelAim();else actions.aim(slot,lastDrag,false);}
  for(const button of skillButtons){
    button.onpointerdown=e=>{if(!enabled||button.disabled||e.button!==0||!skillOwner.claim(e.pointerId))return;e.preventDefault();slot=button.dataset.touchSkill as SkillSlot;origin={x:gamePoint(e).x,y:gamePoint(e).y};lastDrag=null;cancelling=false;skillButton=button;button.setPointerCapture(e.pointerId);button.classList.add('aiming');cancel.hidden=tip.hidden=false;ui.classList.add('is-touch-aiming');actions.aim(slot,null,false);};
    button.onpointermove=aim;
    button.onpointerup=e=>{if(!skillOwner.owns(e.pointerId)||!slot)return;e.preventDefault();aim(e);if(!cancelling&&enabled)actions.aim(slot,lastDrag,true);resetAim();};
    button.onpointercancel=button.onlostpointercapture=e=>{if(skillOwner.owns(e.pointerId))resetAim();};
    // Pointer release owns touch casting; keyboard/assistive activation still works.
    button.onclick=e=>{if(e.detail===0&&enabled&&!button.disabled)actions.aim(button.dataset.touchSkill as SkillSlot,null,true);};
  }
  root.querySelector<HTMLButtonElement>('.touch-attack')!.onclick=()=>{if(enabled){reset();actions.attack();}};
  root.querySelector<HTMLButtonElement>('.mobile-stop')!.onclick=()=>{reset();actions.stop();};
  root.querySelectorAll<HTMLButtonElement>('[data-mobile]').forEach(b=>b.onclick=()=>{reset();actions[b.dataset.mobile as 'shop'|'inventory'|'center'|'recover'|'camps']();});
  root.querySelectorAll<HTMLButtonElement>('[data-mobile-hero]').forEach(b=>b.onclick=()=>actions.preview(b.dataset.mobileHero as keyof typeof HEROES));
  const qualityButton=root.querySelector<HTMLButtonElement>('.mobile-quality')!;
  qualityButton.onclick=()=>{quality=quality==='auto'?'smooth':quality==='smooth'?'high':'auto';try{localStorage.setItem('dota-mobile-quality',quality);}catch{}actions.quality(quality);qualityButton.textContent=`画质：${quality==='auto'?'自动':quality==='smooth'?'流畅':'清晰'}`;};
  qualityButton.textContent=`画质：${quality==='auto'?'自动':quality==='smooth'?'流畅':'清晰'}`;
  const visibility=()=>{if(document.hidden)reset();};
  addEventListener('resize',resize);addEventListener('blur',reset);document.addEventListener('visibilitychange',visibility);
  resize();
  return {
    get active(){return active;},get moving(){return moving;},reset,resetMove,
    update(sim:BattleSimulation,blocked:boolean){
      const next=active&&sim.canCommand()&&!blocked;
      if(enabled&&!next)reset();enabled=next;
      root.querySelector<HTMLElement>('.mobile-play-controls')!.hidden=sim.phase==='choose'||sim.phase==='won'||sim.phase==='lost';
      root.classList.toggle('blocked',blocked);
      stick.setAttribute('aria-disabled',String(!enabled));
      root.querySelector<HTMLButtonElement>('.touch-attack')!.disabled=!enabled;
      root.querySelector<HTMLButtonElement>('.mobile-stop')!.disabled=!enabled;
      root.querySelectorAll<HTMLButtonElement>('[data-mobile]').forEach(b=>b.disabled=!sim.canCommand());
      root.querySelector<HTMLButtonElement>('[data-mobile="inventory"]')!.setAttribute('aria-expanded',String(ui.classList.contains('inventory-open')));
      root.querySelector<HTMLElement>('.mobile-roster')!.hidden=sim.phase!=='choose';
      const selected=ui.querySelector<HTMLButtonElement>('.hero-pedestal[aria-pressed="true"]')?.dataset.hero;
      root.querySelectorAll<HTMLButtonElement>('[data-mobile-hero]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mobileHero===selected)));
      if(!sim.hero)return;
      const hero=sim.hero,definition=HEROES[hero.heroId!];
      for(const button of skillButtons){const s=button.dataset.touchSkill as SkillSlot,skill=definition.skills[s],remaining=Math.max(0,hero.cooldowns[s]-sim.time),locked=hero.level<skill.level;
        const img=button.querySelector('img')!;if(img.getAttribute('src')!==icons[skill.id])img.src=icons[skill.id];
        button.setAttribute('aria-label',`触屏技能：${skill.name}`);button.title=skill.description;
        button.querySelector('small')!.textContent=skill.name;
        button.querySelector('b')!.textContent=locked?`${skill.level}级`:remaining>0?remaining.toFixed(1):hero.mana<skill.mana?'缺蓝':'';
        button.disabled=!enabled||locked||remaining>0||hero.mana<skill.mana;
        (button.querySelector('.touch-cooldown')as HTMLElement).style.height=`${locked?100:remaining/skill.cooldown*100}%`;
      }
      if(slot&&skillButton?.disabled)resetAim();
      if(slot&&!cancelling)actions.aim(slot,lastDrag,false);
    },
    dispose(){reset();removeEventListener('resize',resize);removeEventListener('blur',reset);document.removeEventListener('visibilitychange',visibility);document.body.classList.remove('touch-battle');root.remove();}
  };
}
