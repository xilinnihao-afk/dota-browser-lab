import {gamePoint,gameRect} from '../viewport';
import {HEROES,XP_REQUIRED,SKILL_KEYS,type HeroId,type SkillSlot}from './definitions';
import type{BattleSimulation}from './simulation';
import {ITEMS,INVENTORY_SLOTS,STARTING_GOLD,PASSIVE_GOLD_PER_SECOND,itemById} from './economy';
import {CAMPS} from './world';
import type {MapData} from '../map-data';
import type {Point} from './navigation';
import {SELECTION_HEROES,playableSelection} from './selection-roster';
import './selection.css';
export interface BattleActions {preview(id:HeroId):void;start(id:HeroId):void;skill(slot:SkillSlot):void;attack():void;moveMode():void;look(point:Point):void;stop():void;center():void;pause():void;restart():void;choose():void;recover():void;buy(id:string):void;use(id:string):void;sell(id:string):void;equip(id:string):void;camp(id:string):void;mute():void;isMuted():boolean;audioLabel?():string;shop(open:boolean):void}
export function createBattleHud(app:HTMLElement,icons:Record<string,string>,actions:BattleActions,map:MapData){
  const ui=document.createElement('div');ui.className='battle-ui';ui.innerHTML=`
    <div class="battle-top">
      <nav class="battle-menu" aria-label="对局菜单"><button id="toggle-objective" aria-expanded="false" aria-controls="objective-panel">战况</button><button data-action="pause">暂停</button><button data-action="mute" id="battle-sound">音效：开</button><button data-action="choose">更换英雄</button></nav>
      <div class="battle-time-dial" aria-hidden="true"><i></i></div>
      <div class="battle-resources"><strong id="battle-gold" title="开局 ${STARTING_GOLD} 金币，对局每秒 +${PASSIVE_GOLD_PER_SECOND}；暂停停止增长">金币 ${STARTING_GOLD}</strong><span id="battle-clock" aria-label="对局时间">00:00</span><span id="battle-wave">第 1 波</span><span id="battle-kills">击杀 0 · 阵亡 0</span></div>
    </div>
    <div class="battle-score"><span>摧毁敌方基地获胜</span></div>
    <aside class="battle-objective" id="objective-panel" hidden aria-label="基地战况"><span id="battle-objective">摧毁敌方基地获胜</span><div class="base-objectives"><span class="base-objective ally"><strong>近卫基地</strong><b id="ally-base">—</b><small>防御塔 <b id="ally-towers">—</b> 座</small></span><i>⚔</i><span class="base-objective enemy"><strong>天灾基地</strong><b id="enemy-base">—</b><small>防御塔 <b id="enemy-towers">—</b> 座</small></span></div></aside>
    <div class="battle-message" role="status" id="battle-message"></div>
    <section class="classic-hud" aria-label="英雄与技能">
      <div class="classic-minimap classic-panel"><button id="battle-minimap" aria-label="小地图：点击或拖动查看位置" title="点击或拖动小地图查看位置；空格回到英雄。菱形：基地；方形：防御塔；蓝色十字：泉水"><img src="${import.meta.env.BASE_URL}assets/imba/minimap.png" alt="原地图小地图"><canvas id="battle-minimap-units" width="256" height="256"></canvas></button><nav class="minimap-tools" aria-label="地图工具"><button id="toggle-shop" title="装备商店 B" aria-label="装备商店 B"><img src="${icons.shop}" alt=""></button><button id="toggle-camps" title="野怪营地 N" aria-label="野怪营地 N"><img src="${icons.claws}" alt=""></button><button data-action="center" title="空格：回到英雄" aria-label="镜头回到英雄"><img src="${icons.move}" alt=""></button><button data-action="recover" title="返回己方泉水" aria-label="回泉恢复"><img src="${icons.recover}" alt=""></button><a href="?scene=1&view=river" title="观察原版地图" aria-label="观察原版地图">◉</a></nav></div>
      <div class="classic-portrait classic-panel"><button data-action="center" class="classic-portrait-button" aria-label="回到英雄" title="空格：回到英雄"><img id="hero-portrait" alt="英雄头像"><b id="hero-level">1</b></button><div class="portrait-bars"><div class="vital health"><i id="hero-health-fill"></i><span id="hero-health"></span></div><div class="vital mana"><i id="hero-mana-fill"></i><span id="hero-mana"></span></div></div></div>
      <div class="classic-info classic-panel"><div class="classic-info-content">
        <strong id="hero-name">剑圣</strong>
        <div class="experience"><i id="hero-xp-fill"></i><span id="hero-xp"></span></div>
        <div class="hero-stats" id="hero-stats" aria-label="英雄属性">
          <div class="hero-stat"><img src="${icons.attack}" alt=""><span>攻击力<b id="hero-damage">—</b></span></div>
          <div class="hero-stat"><img src="${icons.move}" alt=""><span>移动速度<b id="hero-speed">—</b></span></div>
          <div class="hero-stat"><img src="${icons.armor}" alt=""><span>护甲<b id="hero-armor">—</b></span></div>
          <div class="hero-stat"><img src="${icons.vampire}" alt=""><span>吸血<b id="hero-lifesteal">—</b></span></div>
        </div>
        <div class="classic-target"><span id="selected-target">左键点敌军即可攻击</span><div class="target-health" id="target-health" hidden><i id="target-health-fill"></i></div><small id="attack-state">准备就绪</small><small class="fountain-status" id="fountain-status" hidden>泉水 · 恢复生命与法力</small></div>
      </div></div>
      <div class="classic-inventory classic-panel"><strong class="inventory-title">物品栏</strong><button class="inventory-close" aria-label="关闭背包">×</button><div class="inventory-slots" id="inventory-slots" aria-label="六格装备栏"></div></div>
      <div class="classic-commands classic-panel"><div class="command-grid" aria-label="四列三行指令栏">
        <button class="command-icon" data-action="moveMode" aria-label="移动指令 M" title="移动 M：点击地面前往"><img src="${icons.move}" alt=""><kbd>M</kbd></button>
        <button class="command-icon" data-action="stop" aria-label="停止 X" title="停止 X"><img src="${icons.stop}" alt=""><kbd>X</kbd></button>
        <button class="command-icon" data-action="attack" aria-label="攻击指令 T" title="攻击 T：点击敌军持续攻击"><img src="${icons.attack}" alt=""><kbd>T</kbd></button>
        <button class="command-icon" data-action="recover" aria-label="返回泉水" title="步行返回己方泉水，恢复生命与法力"><img src="${icons.recover}" alt=""><span>泉水</span></button>
        <button class="command-icon" data-action="center" aria-label="镜头跟随英雄" title="空格：回到英雄并跟随"><img id="center-hero-icon" src="${icons.juggernaut}" alt=""><span>英雄</span></button>
        <button class="command-icon" id="command-shop" aria-label="打开装备商店 B" title="装备商店 B"><img src="${icons.shop}" alt=""><kbd>B</kbd></button>
        <button class="command-icon" id="command-camps" aria-label="查看野区 N" title="野怪营地 N"><img src="${icons.claws}" alt=""><kbd>N</kbd></button>
        <button class="command-icon command-pause" data-action="pause" aria-label="暂停或继续 P" title="暂停 / 继续 P"><b>Ⅱ</b><kbd>P</kbd></button>
        ${(['q','w','r']as SkillSlot[]).map(slot=>`<button class="skill" data-skill="${slot}" aria-label="${SKILL_KEYS[slot]} 技能"><img alt=""><kbd>${SKILL_KEYS[slot]}</kbd><span class="skill-shade"></span><b class="skill-time"></b><strong class="skill-name"></strong><small class="skill-cost"></small></button>`).join('')}<span class="command-empty" aria-hidden="true"></span>
      </div></div>
    </section>
    <div class="mobile-panel-shade" hidden></div>
    <aside class="battle-shop" id="battle-shop" hidden aria-label="装备商店"><div class="panel-title"><h2>装备商店</h2><button id="close-shop" aria-label="关闭商店">×</button></div><p class="shop-rule">开局 ${STARTING_GOLD} 金币 · 每秒 +${PASSIVE_GOLD_PER_SECOND} · 可随时购买<br>6 格物品栏；装备限购 1 件，吃树可叠加，点击背包直接使用。出售返还剩余物品价值的 50%。</p><div class="shop-items">${ITEMS.map(item=>`<article><img src="${icons[item.icon]}" alt=""><div><strong>${item.name}</strong><p>${item.description}</p><small>${item.cost} 金币</small></div><button data-buy="${item.id}" aria-label="购买${item.name}">购买</button></article>`).join('')}</div><div id="shop-owned"></div><p id="shop-message" role="status"></p></aside>
    <aside class="battle-camps" id="battle-camps" hidden aria-label="野怪营地"><div class="panel-title"><h2>野怪营地</h2><button id="close-camps" aria-label="关闭野区">×</button></div><p class="shop-rule">点击前往营地，再左键攻击野怪。打野获得经验和金币，清空后倒计时刷新。</p>${CAMPS.map(c=>`<article><div><strong>${c.name}</strong><small id="camp-${c.id}"></small></div><button data-camp="${c.id}" aria-label="前往${c.name}">前往</button></article>`).join('')}</aside>
    <div class="battle-pause" hidden id="battle-pause">战斗已暂停<span>点击「继续」或按 P 恢复战斗</span></div>
    <section class="hero-picker" aria-label="能量圈选择英雄"><div class="selection-banner"><span>DEFENSE OF THE ANCIENTS</span><h1>英雄祭坛</h1><p>点击英雄或脚下能量圈选择 · 12 位英雄各有独特技能</p></div>
      <div class="selection-heroes">${SELECTION_HEROES.map(h=>`<button class="hero-pedestal available" data-hero="${h.id}" aria-label="选择${h.name}" aria-pressed="${h.id==='juggernaut'}" title="${h.name} · 可选择"><span class="selection-health"><i></i></span><span class="selection-label">${h.name}<small>可选择</small></span></button>`).join('')}</div>
      <div class="selection-confirm"><span id="selection-description">剑圣 · 近战 · 持续伤害</span><button id="start-battle" class="start-battle">以剑圣开始战斗</button><small>已开放 ${SELECTION_HEROES.length} 位英雄 · 确认后进入战场</small></div></section>
    <div class="battle-result" hidden><small>基地攻防</small><h1 id="result-title"></h1><p id="result-summary"></p><button data-action="restart">重新开始</button><button data-action="choose">更换英雄</button></div>`;
  for(const name of ['minimap','portrait','info','inventory','commands','top'])ui.style.setProperty('--console-'+name,`url("${new URL(`${import.meta.env.BASE_URL}assets/imba/resources/ui/derived/${name}.png`,document.baseURI).href}")`);
  app.append(ui);let chosen:HeroId='juggernaut',lastHero:HeroId|undefined;const el=(id:string)=>ui.querySelector<HTMLElement>('#'+id)!;
  const handlers:Record<string,()=>void>={attack:actions.attack,moveMode:actions.moveMode,stop:actions.stop,center:actions.center,pause:actions.pause,restart:actions.restart,choose:actions.choose,recover:actions.recover,mute:actions.mute};ui.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>b.onclick=()=>handlers[b.dataset.action!]());
  ui.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach(b=>b.onclick=()=>actions.skill(b.dataset.skill as SkillSlot));
  function previewHero(id:string){const hero=playableSelection(id);if(!hero)return;chosen=hero;actions.preview(hero);const def=HEROES[hero];
    ui.querySelectorAll('[data-hero]').forEach(n=>n.setAttribute('aria-pressed',String((n as HTMLElement).dataset.hero===chosen)));
    el('battle-clock').textContent='00:00';el('battle-wave').textContent='准备选人';el('battle-kills').textContent='击杀 0 · 阵亡 0';el('battle-gold').textContent=`金币 ${STARTING_GOLD}`;
    el('start-battle').textContent=`以${def.name}开始战斗`;el('selection-description').textContent=`${def.name} · ${def.title}`;
    (el('hero-portrait')as HTMLImageElement).src=icons[hero];(el('center-hero-icon')as HTMLImageElement).src=icons[hero];el('hero-name').textContent=def.name;el('hero-level').textContent='1';
    el('hero-health').textContent=`${def.hp} / ${def.hp}`;el('hero-mana').textContent=`${def.mana} / ${def.mana}`;el('hero-health-fill').style.width='100%';el('hero-mana-fill').style.width='100%';el('hero-xp-fill').style.width='0';el('hero-xp').textContent='能量圈 · 选择英雄';
    el('hero-damage').textContent=String(def.damage);el('hero-speed').textContent=String(def.speed);el('hero-armor').textContent='0';el('hero-lifesteal').textContent='0%';el('selected-target').textContent=def.description;el('target-health').hidden=true;el('attack-state').textContent='确认英雄后开始战斗';el('attack-state').hidden=false;el('fountain-status').hidden=true;
    for(const slot of ['q','w','r']as SkillSlot[]){const button=ui.querySelector<HTMLButtonElement>(`[data-skill="${slot}"]`)!,skill=def.skills[slot];button.querySelector('img')!.src=icons[skill.id];button.querySelector('.skill-name')!.textContent=skill.name;button.querySelector('.skill-cost')!.textContent=`${skill.mana} 法力`;button.querySelector('.skill-time')!.textContent=skill.level>1?'Lv.3':'';button.title=`${skill.name}：${skill.description}`;button.setAttribute('aria-label',`${SKILL_KEYS[slot]} ${skill.name}`);button.disabled=true;(button.querySelector('.skill-shade')as HTMLElement).style.height='0';}
    el('inventory-slots').innerHTML=Array.from({length:INVENTORY_SLOTS},()=>'<span class="inventory-empty" aria-hidden="true"></span>').join('');lastHero=undefined;inventorySignature='';
  }
  ui.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(button=>button.onclick=()=>previewHero(button.dataset.hero!));el('start-battle').onclick=()=>actions.start(chosen);
  const picker=ui.querySelector<HTMLElement>('.hero-picker')!,result=ui.querySelector<HTMLElement>('.battle-result')!;
  let inventorySignature='';
  el('toggle-objective').onclick=()=>{const panel=el('objective-panel');panel.hidden=!panel.hidden;el('toggle-objective').setAttribute('aria-expanded',String(!panel.hidden));};
  const panelShade=ui.querySelector<HTMLElement>('.mobile-panel-shade')!;
  const syncPanels=()=>{panelShade.hidden=el('battle-shop').hidden&&el('battle-camps').hidden&&!ui.classList.contains('inventory-open');};
  const closeInventory=()=>{ui.classList.remove('inventory-open');syncPanels();};
  const toggleInventory=()=>{const open=!ui.classList.contains('inventory-open');el('battle-shop').hidden=el('battle-camps').hidden=true;ui.classList.toggle('inventory-open',open);if(open)actions.shop(true);syncPanels();};
  ui.querySelector<HTMLButtonElement>('.inventory-close')!.onclick=closeInventory;
  panelShade.onclick=()=>{el('battle-shop').hidden=el('battle-camps').hidden=true;closeInventory();};
  const toggleShop=(open=el('battle-shop').hidden)=>{el('battle-shop').hidden=!open;if(open){el('battle-camps').hidden=true;ui.classList.remove('inventory-open');actions.shop(true);}syncPanels();};
  const toggleCamps=()=>{el('battle-camps').hidden=!el('battle-camps').hidden;if(!el('battle-camps').hidden){el('battle-shop').hidden=true;ui.classList.remove('inventory-open');actions.shop(true);}syncPanels();};
  el('command-shop').onclick=()=>toggleShop();el('command-camps').onclick=toggleCamps;el('toggle-shop').onclick=()=>toggleShop();el('close-shop').onclick=()=>toggleShop(false);el('toggle-camps').onclick=toggleCamps;el('close-camps').onclick=()=>{el('battle-camps').hidden=true;syncPanels();};
  ui.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(b=>b.onclick=()=>actions.buy(b.dataset.buy!));
  ui.querySelectorAll<HTMLButtonElement>('[data-camp]').forEach(b=>b.onclick=()=>{actions.camp(b.dataset.camp!);el('battle-camps').hidden=true;syncPanels();});

  const mini=el('battle-minimap'),miniCanvas=el('battle-minimap-units') as HTMLCanvasElement,miniContext=miniCanvas.getContext('2d')!;
  const mapWidth=(map.width-1)*128,mapHeight=(map.height-1)*128;
  const look=(event:PointerEvent)=>{const rect=gameRect(mini);actions.look({x:map.offset[0]+Math.max(0,Math.min(1,(gamePoint(event).x-rect.left)/rect.width))*mapWidth,y:map.offset[1]+(1-Math.max(0,Math.min(1,(gamePoint(event).y-rect.top)/rect.height)))*mapHeight});};
  mini.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();mini.setPointerCapture(event.pointerId);look(event);};mini.onpointermove=event=>{if(mini.hasPointerCapture(event.pointerId))look(event);};mini.onpointerup=event=>{if(mini.hasPointerCapture(event.pointerId))mini.releasePointerCapture(event.pointerId);};mini.oncontextmenu=event=>event.preventDefault();
  function drawMinimap(sim:BattleSimulation,view?:{center:Point;width:number;height:number}){const ctx=miniContext;ctx.clearRect(0,0,256,256);const xy=(p:Point)=>({x:(p.x-map.offset[0])/mapWidth*256,y:(1-(p.y-map.offset[1])/mapHeight)*256});
    for(const team of [0,1]as const){const p=xy(sim.fountain(team));ctx.fillStyle='#071b28';ctx.beginPath();ctx.arc(p.x,p.y,5.5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#91e7ff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x-4,p.y);ctx.lineTo(p.x+4,p.y);ctx.moveTo(p.x,p.y-4);ctx.lineTo(p.x,p.y+4);ctx.stroke();}
    for(const u of sim.units){if(u.hp<=0)continue;const p=xy(u),size=u.kind==='tower'?5:u.id==='hero'?5:u.kind==='hero'?4:2;ctx.fillStyle=u.id==='hero'?'#fff176':u.team===0?'#6ce177':u.team===1?'#ff5959':'#edbd60';if(u.kind==='base'){ctx.beginPath();ctx.moveTo(p.x,p.y-6);ctx.lineTo(p.x+6,p.y);ctx.lineTo(p.x,p.y+6);ctx.lineTo(p.x-6,p.y);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff2c6';ctx.lineWidth=1;ctx.stroke();}else ctx.fillRect(p.x-size/2,p.y-size/2,size,size);}
    if(view){const p=xy(view.center),w=view.width/mapWidth*256,h=view.height/mapHeight*256;ctx.strokeStyle='#ffffffc9';ctx.lineWidth=1;ctx.strokeRect(p.x-w/2,p.y-h/2,w,h);}
  }

  previewHero(chosen);
  const selectionButtons=new Map([...ui.querySelectorAll<HTMLButtonElement>('[data-hero]')].map(b=>[b.dataset.hero!,b]));
  return {element:ui,selectionButtons,previewHero,toggleShop,toggleCamps,toggleInventory,get hasOpenPanel(){return !el('battle-shop').hidden||!el('battle-camps').hidden||ui.classList.contains('inventory-open');},closePanels(){toggleShop(false);el('battle-camps').hidden=true;closeInventory();},showPicker(){previewHero(chosen);picker.hidden=false;result.hidden=true;toggleShop(false);el('battle-camps').hidden=true;closeInventory();},update(sim:BattleSimulation,armed:SkillSlot|null,paused:boolean,view?:{center:Point;width:number;height:number}){
    const choosing=sim.phase==='choose';picker.hidden=!choosing;ui.classList.toggle('is-selecting',choosing);
    ui.querySelectorAll<HTMLButtonElement>('[data-action],#toggle-shop,#toggle-camps,#command-shop,#command-camps,#toggle-objective,#battle-minimap').forEach(button=>{button.disabled=choosing&&button.dataset.action!=='mute';});
    if(choosing){el('battle-sound').textContent=actions.audioLabel?.()??(actions.isMuted()?'音效：关':'音效：开');el('battle-pause').hidden=true;result.hidden=true;el('battle-message').textContent='';drawMinimap(sim);return;}const h=sim.hero;if(!h)return;const def=HEROES[h.heroId!];
    if(lastHero!==h.heroId){lastHero=h.heroId;(el('hero-portrait')as HTMLImageElement).src=icons[h.heroId!];(el('center-hero-icon')as HTMLImageElement).src=icons[h.heroId!];el('hero-name').textContent=def.name;for(const slot of ['q','w','r']as SkillSlot[]){const b=ui.querySelector<HTMLButtonElement>(`[data-skill="${slot}"]`)!,s=def.skills[slot];b.querySelector('img')!.src=icons[s.id];b.querySelector('.skill-name')!.textContent=s.name;b.querySelector('.skill-cost')!.textContent=`${s.mana} 法力`;b.title=`${s.name} · ${s.cooldown} 秒冷却\n${s.description}`;b.setAttribute('aria-label',`${SKILL_KEYS[slot as SkillSlot]} ${s.name}`);}}
    el('hero-level').textContent=String(h.level);el('hero-damage').textContent=String(h.damage);el('hero-armor').textContent=String(h.armor);el('hero-speed').textContent=String(h.speed);el('hero-lifesteal').textContent=`${Math.round(sim.lifesteal*100)}%`;el('hero-health').textContent=`${Math.ceil(h.hp)} / ${h.maxHp}`;el('hero-mana').textContent=`${Math.floor(h.mana)} / ${h.maxMana}`;el('hero-health-fill').style.width=h.hp/h.maxHp*100+'%';el('hero-mana-fill').style.width=h.mana/h.maxMana*100+'%';el('hero-xp-fill').style.width=(h.level>=10?100:h.xp/XP_REQUIRED(h.level)*100)+'%';el('hero-xp').textContent=`等级 ${h.level} ${def.title}`;el('hero-xp').parentElement!.title=h.level>=10?'已达最高等级':`经验 ${h.xp} / ${XP_REQUIRED(h.level)} · ${h.level<3?'3 级解锁终极技能':'击杀继续成长'}`;
    el('battle-clock').textContent=`${String(Math.floor(sim.time/60)).padStart(2,'0')}:${String(Math.floor(sim.time%60)).padStart(2,'0')}`;el('battle-wave').textContent=`第 ${sim.wave} 波 · ${Math.max(0,Math.ceil(sim.nextWave-sim.time))}s`;el('battle-kills').textContent=`击杀 ${sim.kills} · 阵亡 ${sim.deaths}`;
    for(const [team,prefix]of [[0,'ally'],[1,'enemy']]as const){const base=sim.unit('base-'+team);el(prefix+'-base').textContent=base?`${Math.ceil(Math.max(0,base.hp))} / ${base.maxHp}`:'—';el(prefix+'-towers').textContent=String(sim.units.filter(u=>u.team===team&&u.kind==='tower'&&u.hp>0).length);}
    const recovery=sim.itemRecoveryRemaining();el('fountain-status').hidden=sim.phase!=='playing'||h.hp<=0||(!sim.inFountain(h)&&!recovery);el('fountain-status').textContent=sim.inFountain(h)?'泉水 · 恢复生命与法力':`吃树 · 恢复生命 ${Math.ceil(recovery)}s`;el('attack-state').hidden=!el('fountain-status').hidden;
    el('battle-message').textContent=h.hp<=0?`英雄阵亡 · ${Math.max(0,Math.ceil(h.respawnAt-sim.time))} 秒后在近卫泉水复活`:armed?`${def.skills[armed].name}：左键选择${def.skills[armed].target==='enemy'?'敌军':'地面'} · Esc 取消`:sim.message;
    const target=sim.unit(sim.selectedId);el('selected-target').textContent=target&&target.id!=='hero'?`${target.team===2?'中立':target.team?'敌方':'己方'} ${target.name} · ${Math.ceil(target.hp)} / ${target.maxHp}`:'左键点敌军即可攻击';
    el('target-health').hidden=!target||target.id==='hero';if(target)el('target-health-fill').style.width=Math.max(0,target.hp/target.maxHp*100)+'%';
    el('attack-state').textContent=h.hp<=0?'等待泉水复活':target?.returning?'野怪脱战返回 · 暂时免伤':target&&target.invulnerableUntil>sim.time?'目标无敌':h.spinUntil>sim.time?'剑刃风暴 · 持续伤害':h.stormUntil>sim.time?'持续施法中':h.pendingHit?'攻击前摇':h.order==='attack'&&h.targetId?(h.action==='walk'?'正在追击':h.attackAt>sim.time?`攻击间隔 ${(h.attackAt-sim.time).toFixed(1)}s`:'持续攻击'):h.order==='move'||h.order==='steer'?'移动中':'准备就绪';
    drawMinimap(sim,view);
    for(const slot of ['q','w','r']as SkillSlot[]){const b=ui.querySelector<HTMLButtonElement>(`[data-skill="${slot}"]`)!,s=def.skills[slot],cooldown=Math.max(0,h.cooldowns[slot]-sim.time),locked=h.level<s.level;b.disabled=locked||cooldown>0||h.mana<s.mana||h.hp<=0||paused||sim.phase!=='playing';b.classList.toggle('armed',armed===slot);b.querySelector('.skill-time')!.textContent=locked?`Lv.${s.level}`:cooldown>0?cooldown.toFixed(1):'';(b.querySelector('.skill-shade')as HTMLElement).style.height=(locked?100:cooldown/s.cooldown*100)+'%';}
    el('battle-gold').textContent=`金币 ${sim.gold}`;el('battle-sound').textContent=actions.audioLabel?.()??(actions.isMuted()?'音效：关':'音效：开');
    el('shop-message').textContent=sim.message;
    ui.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(b=>{const id=b.dataset.buy!,error=sim.purchaseError(id);b.disabled=!!error;const item=itemById(id)!;b.title=error??(item.consumable?'购买后点击背包使用':'购买后立即生效');b.textContent=sim.inventory.includes(id)&&!item.consumable?'已拥有':sim.gold<item.cost?'金币不足':item.consumable&&sim.inventory.includes(id)?'再买一组':'购买';});
    const useError=sim.itemUseError('tango'),signature=JSON.stringify([sim.inventory,sim.itemCharges,sim.activeOrb,sim.canCommand(),useError]);if(signature!==inventorySignature){inventorySignature=signature;
      el('inventory-slots').innerHTML=Array.from({length:INVENTORY_SLOTS},(_,i)=>{
        const item=itemById(sim.inventory[i]);if(!item)return '<span class="inventory-empty" aria-hidden="true"></span>';
        if(item.consumable)return `<button data-use="${item.id}" class="consumable" title="${useError??item.description}" aria-label="使用 ${item.name}，剩余 ${sim.itemCharges[item.id]} 次" ${useError?'disabled':''}><img src="${icons[item.icon]}" alt="${item.name}"><b class="item-charges" aria-hidden="true">${sim.itemCharges[item.id]}</b></button>`;
        return `<button data-equip="${item.id}" class="${item.orb===sim.activeOrb?'equipped':''}" title="${item.name}：${item.description}${item.orb?'；点击切换法球':''}" aria-label="装备 ${item.name}${item.orb===sim.activeOrb?' 已启用':''}"><img src="${icons[item.icon]}" alt="${item.name}"></button>`;
      }).join('');
      el('shop-owned').innerHTML=sim.inventory.length?'<h3>已拥有</h3>'+sim.inventory.map(id=>{const item=itemById(id)!;return `<div class="owned-row"><span>${item.name}${item.consumable?' × '+sim.itemCharges[id]:item.orb===sim.activeOrb?' · 生效中':''}</span>${item.consumable?`<button data-use="${id}" aria-label="使用${item.name}" title="${useError??item.description}" ${useError?'disabled':''}>使用</button>`:item.orb?`<button data-equip="${id}" aria-label="启用${item.name}" ${!sim.canCommand()?'disabled':''}>启用</button>`:''}<button data-sell="${id}" aria-label="出售${item.name}" ${!sim.canCommand()?'disabled':''}>出售 ${sim.sellValue(id)}</button></div>`;}).join(''):'<p class="shop-rule">物品栏为空</p>';
      ui.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach(b=>b.onclick=()=>{if(itemById(b.dataset.equip!)?.orb)actions.equip(b.dataset.equip!);else toggleShop(true);});ui.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach(b=>b.onclick=()=>actions.sell(b.dataset.sell!));ui.querySelectorAll<HTMLButtonElement>('[data-use]').forEach(b=>b.onclick=()=>actions.use(b.dataset.use!));
    }
    for(const camp of sim.camps){const alive=camp.unitIds.filter(id=>(sim.unit(id)?.hp??0)>0).length;el('camp-'+camp.definition.id).textContent=alive?`${alive} 只 · 每只 ${camp.definition.gold} 金币 / ${camp.definition.xp} 经验`:`刷新 ${Math.max(0,Math.ceil(camp.respawnAt-sim.time))}s · 附近无人后刷新`;}
    el('battle-pause').querySelector('span')!.textContent=document.body.classList.contains('touch-battle')?'点击顶部「继续」恢复战斗':'点击「继续」或按 P 恢复战斗';el('battle-pause').hidden=!paused||sim.phase!=='playing';ui.querySelector<HTMLButtonElement>('[data-action="pause"]')!.textContent=paused?'继续':'暂停';result.hidden=!['won','lost'].includes(sim.phase);if(!result.hidden){el('result-title').textContent=sim.phase==='won'?'胜利':'基地失守';el('result-summary').textContent=`${sim.phase==='won'?'天灾基地已被摧毁':'近卫基地已被摧毁'}。${def.name} · 等级 ${h.level} · 击杀 ${sim.kills} · 阵亡 ${sim.deaths} · ${Math.floor(sim.time)} 秒`;}
  },dispose(){ui.remove();}};
}
