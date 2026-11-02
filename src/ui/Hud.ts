import type { HudActions, HudSnapshot, MapDefinition } from '../game/types';
import { riverCenter, laneCenter } from '../game/map';

const icons = {
  pause: '<path d="M8 5v14M16 5v14"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 8q5 4 0 8M19 4q9 8 0 16"/>',
  muted: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6"/>',
  path: '<path d="M5 18c-5-8 17-3 13-12M15 6h3V3"/><circle cx="5" cy="19" r="2"/>',
  restart: '<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>',
  sword: '<path d="m6 18 12-12 2-3-3 2L5 17m-2-3 7 7M3 21l3-3"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  center: '<circle cx="12" cy="12" r="5"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
  gold: '<path d="m12 3 9 9-9 9-9-9zM12 8v8m-3-4h6"/>',
};
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const portrait = `<svg viewBox="0 0 130 160" role="img" aria-label="蓝色铠甲的渡口守卫"><defs><linearGradient id="armor" x2="1" y2="1"><stop stop-color="#839eac"/><stop offset=".45" stop-color="#35546a"/><stop offset="1" stop-color="#142833"/></linearGradient><linearGradient id="helm"><stop stop-color="#203641"/><stop offset=".5" stop-color="#99aeb4"/><stop offset=".55" stop-color="#3a596b"/><stop offset="1" stop-color="#172c3a"/></linearGradient><radialGradient id="halo"><stop stop-color="#4d7281" stop-opacity=".6"/><stop offset="1" stop-color="#0c161c" stop-opacity="0"/></radialGradient></defs><rect width="130" height="160" fill="#121c23"/><circle cx="65" cy="66" r="68" fill="url(#halo)"/><path d="M18 160V111l23-19h48l23 19v49" fill="#142933"/><path d="m1 151 8-40 27-13 19 17-8 45H0m130-9-8-40-27-13-19 17 8 45h46" fill="url(#armor)" stroke="#9b977a" stroke-width="1.3"/><path d="m18 113 17-9 11 11-17 13zm94 0-17-9-11 11 17 13z" fill="#536b7a"/><path d="m47 111 18 11 18-11 4 49H43z" fill="url(#armor)" stroke="#8a876c"/><path d="m65 123-6 15 6 10 6-10z" fill="#71bec2"/><path d="m36 53 8-20 21-10 21 10 8 20-6 43-23 17-23-17z" fill="url(#helm)" stroke="#9da597" stroke-width="1.2"/><path d="m37 57 19 7 9-3 9 3 19-7-4 24-15 4-9 18-9-18-15-4z" fill="#101d23"/><path d="m42 64 17 5-2 5-14-4zm46 0-17 5 2 5 14-4z" fill="#8bdad7"/><path d="m61 24 4-13 4 13 3 39-7 35-7-35z" fill="#a0aaa2"/><path d="m65 13 4 11 3 39-7 35z" fill="#527180"/><path d="M40 44 25 33l8 27 9 4m48-20 15-11-8 27-9 4" fill="url(#armor)" stroke="#9b977a"/><path d="M10 146h28m54 0h28" stroke="#8b8d79"/><path d="m0 158 130 0" stroke="#b0a379"/></svg>`;

export class Hud {
  private root: HTMLDivElement;
  private signal = new AbortController();
  private refs = new Map<string, HTMLElement>();
  private minimap: HTMLCanvasElement;
  private mapBackground: HTMLCanvasElement;
  private lastDraw = -Infinity;

  constructor(container: HTMLElement, private actions: HudActions, private map: MapDefinition) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <header class="world-title"><span class="eyebrow">ANCIENT CROSSING</span><h1>远古渡口</h1><span class="prototype-label">DotA Browser Lab <i></i> 原型 01</span></header>
      <section class="mission" aria-label="任务"><div class="mission-kicker"><span></span>渡口试炼<span></span></div><p data-ref="objective">越过河道，击败守卫，摧毁敌方塔楼</p><div class="mission-progress"><span data-ref="mission-cross">01 <b>渡河</b></span><i></i><span data-ref="mission-guards">02 <b>清敌</b></span><i></i><span data-ref="mission-tower">03 <b>破塔</b></span></div></section>
      <div class="top-controls"><div class="match-clock"><span class="live-dot"></span><span data-ref="time">00:00</span><span class="fps" data-ref="fps">60 FPS</span></div><div class="utility-controls"><button data-action="pause" data-ref="pause" title="暂停 / 继续（Esc）" aria-label="暂停游戏">${icon('pause')}</button><button data-action="mute" data-ref="mute" title="切换音效（M）" aria-label="切换音效">${icon('sound')}</button><button data-action="paths" data-ref="paths" title="显示寻路路径（P）" aria-label="显示寻路路径">${icon('path')}</button><button data-action="reset" title="重新开始" aria-label="重新开始">${icon('restart')}</button></div></div>
      <div class="command-message" data-ref="command" role="status"></div>
      <footer class="command-deck">
        <section class="map-panel"><div class="panel-heading"><span>渡口战区</span><span class="map-hint">点击定位</span></div><canvas class="minimap" width="320" height="256" tabindex="0" aria-label="战术小地图，点击移动镜头，按回车定位英雄" title="点击地图移动镜头"></canvas><div class="map-legend"><span><i class="allied-dot"></i>友军</span><span><i class="enemy-dot"></i>敌军</span><span>北 ↑</span></div></section>
        <section class="hero-panel"><div class="hero-portrait">${portrait}<div class="portrait-title">I</div></div><div class="hero-details"><div class="hero-heading"><div><span class="eyebrow">THE WARDEN</span><h2 data-ref="hero-name">渡口守卫</h2></div><span class="hero-class">近战 · 守卫</span></div><div class="health-label"><span>生命值</span><strong data-ref="hero-health">920 / 920</strong></div><div class="health-track"><div data-ref="hero-fill"></div></div><div class="hero-stats"><span>${icon('sword')}攻击 <b data-ref="damage">48</b></span><span>${icon('shield')}射程 <b data-ref="range">2.6</b></span><span>移速 <b data-ref="speed">7.0</b></span></div><div class="hero-status"><span class="status-light"></span><span data-ref="hero-status">等待指令</span><span class="camera-status" data-ref="camera-status">自由镜头</span></div></div></section>
        <section class="orders-panel"><div class="panel-heading"><span>作战指令</span><span class="order-note" data-ref="order-note">右键下达指令</span></div><div class="orders"><button data-action="attack" data-ref="attack" title="进入攻击模式，再左键指定目标或地面"><span class="key-cap">A</span>${icon('sword')}<span>攻击</span></button><button data-action="stop" title="停止移动与攻击（S）"><span class="key-cap">S</span>${icon('stop')}<span>停止</span></button><button data-action="center" data-ref="center" title="镜头定位英雄（Space）"><span class="key-cap wide">Space</span>${icon('center')}<span>定位</span></button></div><div class="resources"><span>${icon('sword')}击败 <b data-ref="kills">0</b></span><span class="gold">${icon('gold')}金币 <b data-ref="gold">0</b></span></div></section>
        <section class="target-panel"><div class="panel-heading"><span>当前选择</span><span data-ref="target-team">友军</span></div><div class="target-heading">${icon('shield')}<div><h3 data-ref="target-name">渡口守卫</h3><span data-ref="target-kind">英雄</span></div></div><div class="target-health-track"><div data-ref="target-fill"></div></div><div class="target-health" data-ref="target-health">920 / 920</div><p class="target-hint" data-ref="target-hint">右键地面移动，右键敌人攻击</p></section>
      </footer>
      <div class="input-guide"><span><b>右键</b> 移动 / 攻击</span><span><b>左键</b> 选择</span><span><b>A + 左键</b> 指定攻击</span><span><b>滚轮</b> 缩放</span><span><b>方向键</b> 平移镜头</span><span><b>Space</b> 定位英雄</span><span class="desktop-hint">推荐键盘与鼠标</span></div>
      <div class="state-overlay" data-ref="overlay" hidden><section class="state-dialog" role="dialog" aria-modal="true" aria-labelledby="state-title"><span class="eyebrow" data-ref="overlay-kicker">BATTLE PAUSED</span><div class="dialog-emblem">${icon('shield')}</div><h2 id="state-title" data-ref="overlay-title">战局暂停</h2><p data-ref="overlay-text">稍作休整，渡口仍在等待。</p><div class="dialog-buttons"><button class="primary-button" data-action="resume" data-ref="resume">继续战斗 <span>Esc</span></button><button class="secondary-button" data-action="reset" data-ref="retry">重新开始</button></div><span class="dialog-footnote">ANCIENT CROSSING · PROTOTYPE 01</span></section></div>
    `;
    container.append(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-ref]').forEach(el => this.refs.set(el.dataset.ref!, el));
    const callbacks: Record<string, () => void> = { attack: actions.onAttackMode, stop: actions.onStop, center: actions.onCenter, reset: actions.onReset, pause: actions.onPause, resume: actions.onPause, mute: actions.onMute, paths: actions.onTogglePaths };
    this.root.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(button => button.addEventListener('click', () => callbacks[button.dataset.action!](), { signal: this.signal.signal }));
    this.minimap = this.root.querySelector<HTMLCanvasElement>('.minimap')!;
    this.minimap.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = this.minimap.getBoundingClientRect();
      actions.onMinimap(((event.clientX-rect.left)/rect.width-.5)*map.size, ((event.clientY-rect.top)/rect.height-.5)*map.size);
    }, { signal: this.signal.signal });
    this.minimap.addEventListener('keydown', event => { if (event.key === 'Enter') actions.onCenter(); }, { signal: this.signal.signal });
    this.mapBackground = document.createElement('canvas');
    this.mapBackground.width = 320; this.mapBackground.height = 256;
    this.paintMapBackground();
  }

  private ref(name: string) { return this.refs.get(name)!; }
  private text(name: string, value: string) { const el = this.ref(name); if (el.textContent !== value) el.textContent = value; }
  private toggle(name: string, active: boolean) { const el = this.ref(name); el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); }

  update(snapshot: HudSnapshot): void {
    const { state, hero, selected } = snapshot;
    this.toggle('attack', state.attackMode); this.toggle('pause', state.paused); this.toggle('paths', snapshot.showPaths); this.toggle('center', snapshot.cameraLocked);
    const mute = this.ref('mute');
    if (mute.dataset.muted !== String(snapshot.muted)) { mute.innerHTML = icon(snapshot.muted ? 'muted' : 'sound'); mute.dataset.muted = String(snapshot.muted); mute.setAttribute('aria-label', snapshot.muted ? '开启音效' : '关闭音效'); }
    this.toggle('mute', !snapshot.muted);
    this.text('camera-status', snapshot.cameraLocked ? '跟随镜头' : '自由镜头');
    this.text('objective', state.objective || '越过河道，击败守卫，摧毁敌方塔楼');
    this.text('hero-name', hero.name); this.text('hero-health', `${Math.ceil(hero.hp)} / ${hero.maxHp}`);
    this.ref('hero-fill').style.width = `${Math.max(0, hero.hp / hero.maxHp * 100)}%`;
    this.ref('hero-fill').classList.toggle('critical', hero.hp / hero.maxHp < .25);
    this.text('damage', String(hero.damage)); this.text('range', hero.attackRange.toFixed(1)); this.text('speed', hero.speed.toFixed(1));
    this.text('hero-status', ({ idle: '等待指令', moving: '行进中', windup: '攻击准备', attacking: '交战中', dead: '已倒下' })[hero.status]);
    this.text('order-note', state.attackMode ? '左键指定攻击目标' : '右键下达指令');
    this.text('kills', String(state.kills)); this.text('gold', String(state.gold));
    this.text('target-name', selected.name); this.text('target-team', selected.team === 'enemy' ? '敌军' : '友军');
    this.text('target-kind', ({ hero: '英雄', creep: '守卫', tower: '防御塔' })[selected.kind]);
    this.text('target-health', `${Math.ceil(selected.hp)} / ${selected.maxHp}`);
    this.ref('target-fill').style.width = `${Math.max(0, selected.hp / selected.maxHp * 100)}%`;
    this.ref('target-fill').classList.toggle('enemy', selected.team === 'enemy');
    this.text('target-hint', selected.hp <= 0 ? '目标已清除，选择下一个目标' : selected.team === 'enemy' ? '右键目标，发起攻击' : selected.kind === 'tower' ? '靠近此塔可恢复生命' : '右键地面移动，右键敌人攻击');
    this.text('time', `${Math.floor(state.time / 60).toString().padStart(2, '0')}:${Math.floor(state.time % 60).toString().padStart(2, '0')}`);
    this.text('command', state.command); this.ref('command').classList.toggle('attack-command', state.attackMode);
    this.ref('mission-cross').classList.toggle('complete', hero.z < -7 || state.phase === 'won');
    this.ref('mission-guards').classList.toggle('complete', !state.units.some(u => u.team === 'enemy' && u.kind === 'creep' && u.hp > 0));
    this.ref('mission-tower').classList.toggle('complete', state.phase === 'won');
    const overlay = this.ref('overlay'); const visible = state.paused || state.phase !== 'playing';
    overlay.hidden = !visible;
    if (visible) {
      const won = state.phase === 'won'; const lost = state.phase === 'lost';
      this.text('overlay-kicker', won ? 'CROSSING SECURED' : lost ? 'THE WARDEN HAS FALLEN' : 'BATTLE PAUSED');
      this.text('overlay-title', won ? '渡口已夺回' : lost ? '守卫倒下了' : '战局暂停');
      this.text('overlay-text', won ? `敌方塔楼已摧毁。本次试炼清除 ${state.kills} 个目标。` : lost ? '调整路线与攻击时机，再次发起挑战。' : '稍作休整，渡口仍在等待。');
      this.ref('resume').hidden = won || lost;
      this.ref('retry').classList.toggle('primary-button', won || lost);
      this.ref('retry').classList.toggle('secondary-button', !won && !lost);
      this.text('retry', won ? '再次试炼' : lost ? '重新挑战' : '重新开始');
    }
    if (performance.now() - this.lastDraw > 120) {
      this.lastDraw = performance.now();
      this.text('fps', snapshot.metrics.fps > 0 ? `${Math.round(snapshot.metrics.fps)} FPS` : '— FPS');
      this.paintMinimap(snapshot);
    }
  }

  private paintMapBackground(): void {
    const ctx = this.mapBackground.getContext('2d')!; const w=320, h=256, size=this.map.size;
    const px=(x:number)=>(x/size+.5)*w, pz=(z:number)=>(z/size+.5)*h;
    ctx.fillStyle='#26332b'; ctx.fillRect(0,0,w,h);
    ctx.beginPath();
    for(let x=-size/2;x<=size/2;x+=2) { const z=riverCenter(x)-7; if(x===-size/2) ctx.moveTo(px(x),pz(z)); else ctx.lineTo(px(x),pz(z)); }
    for(let x=size/2;x>=-size/2;x-=2) ctx.lineTo(px(x),pz(riverCenter(x)+7));
    ctx.closePath(); ctx.fillStyle='#315660'; ctx.fill();
    ctx.beginPath();
    for(let z=-size/2;z<=size/2;z+=2) { if(z===-size/2) ctx.moveTo(px(laneCenter(z)),pz(z)); else ctx.lineTo(px(laneCenter(z)),pz(z)); }
    ctx.strokeStyle='#716c50'; ctx.lineWidth=22; ctx.stroke();
    for(const o of this.map.obstacles) { if(o.kind==='tower') continue; ctx.beginPath(); ctx.arc(px(o.x),pz(o.z),o.kind==='tree'?3.5:2.3,0,Math.PI*2); ctx.fillStyle=o.kind==='tree'?'#14271f':'#7e8070'; ctx.fill(); }
    ctx.strokeStyle='rgba(182,173,134,.15)'; ctx.lineWidth=1; ctx.strokeRect(8,8,w-16,h-16);
  }

  private paintMinimap(snapshot: HudSnapshot): void {
    const ctx=this.minimap.getContext('2d')!; const w=this.minimap.width,h=this.minimap.height;
    ctx.drawImage(this.mapBackground,0,0);
    const pos=(x:number,z:number)=>[(x/this.map.size+.5)*w,(z/this.map.size+.5)*h];
    if(snapshot.state.destination) { const [x,y]=pos(snapshot.state.destination.x,snapshot.state.destination.z); ctx.strokeStyle='#c4dba8'; ctx.lineWidth=2; ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.stroke(); }
    for(const unit of snapshot.state.units) {
      if(unit.hp<=0)continue;
      const [x,y]=pos(unit.x,unit.z); ctx.fillStyle=unit.team==='allied'?'#77c9bf':'#dc826d'; ctx.strokeStyle='#0b191b'; ctx.lineWidth=2;
      if(unit.kind==='tower') { ctx.fillRect(x-5,y-5,10,10); ctx.strokeRect(x-5,y-5,10,10); }
      else if(unit.kind==='hero') { ctx.save();ctx.translate(x,y);ctx.rotate(-unit.facing);ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(-5,-5);ctx.lineTo(0,-2);ctx.lineTo(5,-5);ctx.closePath();ctx.fillStyle='#eff4ca';ctx.fill();ctx.stroke();ctx.restore();ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.strokeStyle='#dae5bd88';ctx.stroke(); }
      else {ctx.beginPath();ctx.arc(x,y,3.6,0,Math.PI*2);ctx.fill();ctx.stroke();}
    }
  }

  dispose(): void { this.signal.abort(); this.root.remove(); }
}
