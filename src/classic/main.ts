import {gamePoint} from './viewport';
import {gameViewport} from './viewport';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadModel,loadTexture,paths,textureDataUrl,disposeAssets} from './assets';
import {NativeModel} from './native-model';
import {createTerrain} from './terrain';
import './style.css';

const app=document.querySelector<HTMLDivElement>('#app')!;
document.title='经典魔兽 · 原版资源预览';
app.innerHTML=`<canvas id="classic-canvas" aria-label="Warcraft III 经典模型与地表材质预览"></canvas>
  <header class="topbar"><div class="brand">经典魔兽 <small>WARCRAFT III · CLASSIC ASSET STUDY</small></div><nav class="view-controls" aria-label="观察视角">
  <button id="close-view" aria-pressed="true">模型近景</button><button id="game-view" aria-pressed="false">游戏视角</button><button id="texture-view" aria-pressed="false">原贴图</button></nav></header>
  <aside class="status"><strong>原版模型与地表材质</strong><span>剑圣 · 树木 · 远古守护者</span><br><span class="subtle">资源样区 · 尚非 DotA 地图</span></aside>
  <section class="bottom-panel" aria-label="模型与动画控制">
    <div class="identity"><img class="portrait" id="portrait" alt="经典剑圣头像"><div class="unit-name"><span id="unit-name">剑圣</span><small id="model-name">HeroBladeMaster · Classic</small>
      <select id="model-select" class="unit-select" aria-label="选择原版模型"><option value="hero">剑圣</option><option value="footman">步兵</option><option value="ghoul">食尸鬼</option><option value="tower">远古守护者</option></select></div></div>
    <div class="divider"></div><div class="animation-controls"><div class="clip-row"><label for="sequence">原版动画</label><select id="sequence" aria-label="动画序列"></select><button id="pause">暂停</button><button id="restart">重播</button><button id="team">切换队色</button></div>
      <div class="timeline-row"><input id="timeline" aria-label="动画进度" type="range" min="0" max="1000" value="0"><output class="time-label" id="time-label">0 / 0 ms</output></div></div>
    <div class="help"><p>左键拖动观察 · 中键平移<br>滚轮缩放 · 右键地面行走</p><div class="subtle" id="clip-note">原始模型、贴图与骨骼动画已接入。<br>地图布局与原版画面对照仍待校准。</div></div>
  </section><div id="loading" class="loading" role="status"><h1>正在载入经典资源</h1><p>读取原始模型、贴图与动画……</p></div>`;
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('classic-canvas'), loading=$('loading');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NoToneMapping; // Hand-painted classic textures are not PBR assets.
const scene=new THREE.Scene();scene.background=new THREE.Color('#172617');
scene.fog=new THREE.Fog('#172617',2300,4200);
const ambient=new THREE.AmbientLight(0xffffff,1.25);scene.add(ambient);
const sun=new THREE.DirectionalLight(0xfff6df,1.1);sun.position.set(-700,-900,1600);scene.add(sun);
const camera=new THREE.PerspectiveCamera(42,1,4,9000);camera.up.set(0,0,1);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.12;
controls.minDistance=240;controls.maxDistance=3000;controls.minPolarAngle=.15;controls.maxPolarAngle=Math.PI*.45;
controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
let view:'close'|'game'='close';
function setView(next:'close'|'game') {
  view=next;
  if(next==='close'){camera.position.set(460,-740,530);controls.target.set(0,0,85);}
  else{camera.position.set(0,-1050,1550);controls.target.set(0,190,0);}
  controls.update();$('close-view').setAttribute('aria-pressed',String(next==='close'));$('game-view').setAttribute('aria-pressed',String(next==='game'));
}
setView('close');
function resize(){renderer.setSize(gameViewport.width,gameViewport.height);camera.aspect=gameViewport.width/gameViewport.height;camera.updateProjectionMatrix();}
resize();window.addEventListener('resize',resize);
$('close-view').onclick=()=>setView('close');$('game-view').onclick=()=>setView('game');
let unlit=false;
$('texture-view').onclick=()=>{unlit=!unlit;ambient.intensity=unlit?Math.PI:1.25;sun.intensity=unlit?0:1.1;$('texture-view').setAttribute('aria-pressed',String(unlit));};

try {await start();} catch(error) {
  loading.innerHTML='<h1>原版资源尚未就绪</h1><p id="load-error"></p><p>请按 README 的资源准备步骤导入经典版文件，再刷新页面。</p>';
  $('load-error').textContent=error instanceof Error?error.message:String(error);loading.style.display='block';
  console.error(error);
}

async function start() {
  const [heroSource,footmanSource,ghoulSource,towerSource,treeSources,terrain,portrait]=await Promise.all([
    loadModel(paths.hero),loadModel(paths.footman),loadModel(paths.ghoul),loadModel(paths.tower),
    Promise.all(paths.trees.map(loadModel)),createTerrain(),loadTexture(paths.portrait),
  ]);
  scene.add(terrain.root);
  const sources={hero:heroSource,footman:footmanSource,ghoul:ghoulSource,tower:towerSource};
  const names={hero:'剑圣',footman:'步兵',ghoul:'食尸鬼',tower:'远古守护者'};
  type ModelKey=keyof typeof sources;
  let activeKey:ModelKey='hero',team=0,active=await NativeModel.create(heroSource,team);
  active.root.rotation.z=-Math.PI/2;scene.add(active.root);
  const trees:NativeModel[]=[];
  // Fixed placements exist solely to inspect real model silhouettes together.
  const placements=[[-600,-200],[-740,20],[-570,170],[-790,290],[-590,430],[-800,580],[-560,710],[-330,850],[-110,1010],[100,1110],[330,1040],[530,970],[710,850],[880,730],[740,560],[940,410],[810,240],[990,70],[-960,-340],[1050,-160],[-1010,780],[1110,870],[-780,1020],[1200,500]];
  for(let i=0;i<placements.length;i++){
    const tree=await NativeModel.create(treeSources[i%3]);tree.root.position.set(...placements[i] as [number,number],0);
    tree.root.scale.setScalar(.95+(i%5)*.07);tree.root.rotation.z=i*2.399;tree.update(0,camera);scene.add(tree.root);trees.push(tree);
  }
  const backgroundTower=await NativeModel.create(towerSource,1);backgroundTower.root.position.set(470,540,0);backgroundTower.root.rotation.z=-1.9;scene.add(backgroundTower.root);
  const escort=await NativeModel.create(footmanSource,0);escort.root.position.set(-180,310,0);escort.root.rotation.z=-1.5;scene.add(escort.root);
  const shadowMaterial=new THREE.MeshBasicMaterial({map:await loadTexture(paths.shadow),transparent:true,opacity:.65,depthWrite:false,toneMapped:false});
  const shadowGeometry=new THREE.PlaneGeometry(1,1);
  const shadow=new THREE.Mesh(shadowGeometry,shadowMaterial);shadow.scale.set(160,160,1);shadow.position.z=.7;shadow.renderOrder=2;scene.add(shadow);
  const staticShadows=new THREE.InstancedMesh(shadowGeometry,shadowMaterial,placements.length+2);staticShadows.renderOrder=2;
  [...placements,[-180,310],[470,540]].forEach(([x,y],index)=>{
    const size=index===placements.length?140:index===placements.length+1?300:240;
    staticShadows.setMatrixAt(index,new THREE.Matrix4().compose(new THREE.Vector3(x,y,.7),new THREE.Quaternion(),new THREE.Vector3(size,size,1)));
  });scene.add(staticShadows);
  const selection=new THREE.Mesh(new THREE.PlaneGeometry(132,132),new THREE.MeshBasicMaterial({map:await loadTexture(paths.selection),color:0x5cff20,transparent:true,depthWrite:false,toneMapped:false}));
  selection.position.z=1;selection.renderOrder=3;scene.add(selection);
  $<HTMLImageElement>('portrait').src=textureDataUrl(portrait);
  const sequence=$<HTMLSelectElement>('sequence'), timeline=$<HTMLInputElement>('timeline');
  let paused=false,moving=false,moveTarget=new THREE.Vector3(),switchVersion=0;
  const setPause=(value:boolean)=>{paused=value;$('pause').textContent=paused?'播放':'暂停';};
  function updateSequences(){sequence.replaceChildren();for(const name of active.sequences){const option=document.createElement('option');option.value=name;option.textContent=name;sequence.append(option);}sequence.value=active.sequence.Name;}
  updateSequences();
  sequence.onchange=()=>{moving=false;active.setSequence(sequence.value);active.update(0,camera);
    $('clip-note').textContent=/Spin|Slam/i.test(sequence.value)?'此动作的 ParticleEmitter2 粒子尚未接入，当前仅检查网格、贴图与骨骼动画。':'原始模型、贴图与骨骼动画已接入。地图布局与原版画面对照仍待校准。';};
  $('pause').onclick=()=>setPause(!paused);
  $('restart').onclick=()=>{active.seek(0);setPause(false);};
  timeline.oninput=()=>{setPause(true);moving=false;active.seek(Number(timeline.value)/1000);active.update(0,camera);};
  async function replaceModel() {
    const version=++switchVersion;
    const replacement=await NativeModel.create(sources[activeKey],team);
    if(version!==switchVersion){replacement.dispose();return;}
    replacement.root.position.copy(active.root.position);replacement.root.rotation.copy(active.root.rotation);
    active.dispose();active=replacement;scene.add(active.root);moving=false;updateSequences();
    $('unit-name').textContent=names[activeKey];$('model-name').textContent=active.source.Info.Name+' · Classic';
    // Only the source-matched portrait is displayed; don't reuse a hero face for other units.
    $<HTMLImageElement>('portrait').style.display=activeKey==='hero'?'block':'none';
    backgroundTower.root.visible=activeKey!=='tower';
    const backgroundShadowSize=activeKey==='tower'?0:300;
    staticShadows.setMatrixAt(placements.length+1,new THREE.Matrix4().compose(new THREE.Vector3(470,540,.7),new THREE.Quaternion(),new THREE.Vector3(backgroundShadowSize,backgroundShadowSize,1)));
    staticShadows.instanceMatrix.needsUpdate=true;
    selection.scale.setScalar(activeKey==='tower'?2:1);shadow.scale.set(activeKey==='tower'?300:160,activeKey==='tower'?300:160,1);
  }
  $<HTMLSelectElement>('model-select').onchange=async()=>{activeKey=$<HTMLSelectElement>('model-select').value as ModelKey;await replaceModel();};
  $('team').onclick=async()=>{team=1-team;await replaceModel();};
  // Reproducible reference captures start from an explicit pose and camera.
  // This is a viewer feature; it does not change the archived game simulation.
  const capture=new URLSearchParams(location.search);
  if(capture.has('capture')){
    const modelKey=capture.get('model');if(modelKey&&Object.hasOwn(sources,modelKey)){activeKey=modelKey as ModelKey;await replaceModel();$<HTMLSelectElement>('model-select').value=activeKey;}
    if(capture.get('team')==='1'){team=1;await replaceModel();}
    active.setSequence(capture.get('animation')??'Stand');
    const phase=Number(capture.get('phase')??0);active.seek(Number.isFinite(phase)?phase:0);
    sequence.value=active.sequence.Name;setPause(true);backgroundTower.seek(0);escort.seek(0);
    setView(capture.get('view')==='game'?'game':'close');
  }
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  let pointerStart={x:0,y:0};
  canvas.addEventListener('pointerdown',event=>{pointerStart={x:gamePoint(event).x,y:gamePoint(event).y};});
  const raycaster=new THREE.Raycaster();
  canvas.addEventListener('pointerup',event=>{
    if(event.button!==2||Math.hypot(gamePoint(event).x-pointerStart.x,gamePoint(event).y-pointerStart.y)>5||activeKey==='tower')return;
    raycaster.setFromCamera(new THREE.Vector2(gamePoint(event).x/gameViewport.width*2-1,1-gamePoint(event).y/gameViewport.height*2),camera);
    const hit=raycaster.intersectObject(terrain.ground)[0];if(!hit)return;
    moveTarget.copy(hit.point);moveTarget.x=THREE.MathUtils.clamp(moveTarget.x,-350,350);moveTarget.y=THREE.MathUtils.clamp(moveTarget.y,-400,400);
    moving=true;active.setSequence('Walk');sequence.value=active.sequence.Name;setPause(false);
  });
  const diagnostic=document.createElement('output');diagnostic.id='classic-diagnostics';diagnostic.hidden=true;
  if(import.meta.env.DEV||new URLSearchParams(location.search).has('diagnostics'))app.append(diagnostic);
  loading.remove();let previous=performance.now(),uiElapsed=0,frames=0,sample=0,fps=0,disposed=false;
  function frame(now:number){
    const delta=Math.min((now-previous)/1000,.05);previous=now;
    controls.update();
    if(moving&&!paused){const direction=moveTarget.clone().sub(active.root.position);direction.z=0;const distance=direction.length(),speed=active.sequence.MoveSpeed||240;
      if(distance<speed*delta){active.root.position.copy(moveTarget);moving=false;active.setSequence('Stand');sequence.value=active.sequence.Name;}
      else{active.root.position.addScaledVector(direction.normalize(),speed*delta);active.root.rotation.z=Math.atan2(direction.y,direction.x);}}
    active.update(paused?0:delta,camera);backgroundTower.update(paused?0:delta,camera);escort.update(paused?0:delta,camera);
    selection.position.set(active.root.position.x,active.root.position.y,1);selection.visible=!active.sequence.Name.toLowerCase().includes('death');
    shadow.position.set(active.root.position.x,active.root.position.y,.7);
    renderer.render(scene,camera);frames++;sample+=delta;uiElapsed+=delta;
    if(sample>.6){fps=Math.round(frames/sample);sample=0;frames=0;}
    if(uiElapsed>.08){
      timeline.value=String(Math.round(active.progress*1000));$('time-label').textContent=`${Math.round(active.frame-active.sequence.Interval[0])} / ${active.sequence.Interval[1]-active.sequence.Interval[0]} ms`;
      if(diagnostic.isConnected)diagnostic.textContent=JSON.stringify({source:'original-mdx-blp',map:'material-calibration-patch-not-dota',model:active.source.Info.Name,version:active.source.Version,sequence:active.sequence.Name,frame:active.frame,paused,team,view,unlit,geosets:active.source.Geosets.length,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,fps,camera:{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov},viewport:[gameViewport.width,gameViewport.height],position:active.root.position.toArray(),unsupported:{particleEmitters2:active.source.ParticleEmitters2.length,textureAnims:active.source.TextureAnims.length}});
      uiElapsed=0;
    }
  }
  renderer.setAnimationLoop(frame);
  const onVisibility=()=>{previous=performance.now();};document.addEventListener('visibilitychange',onVisibility);
  window.addEventListener('pagehide',event=>{
    renderer.setAnimationLoop(null);if(event.persisted)return;disposed=true;
    active.dispose();trees.forEach(t=>t.dispose());backgroundTower.dispose();escort.dispose();terrain.dispose();selection.geometry.dispose();(selection.material as THREE.Material).dispose();
    staticShadows.dispose();shadowGeometry.dispose();shadowMaterial.dispose();
    controls.dispose();renderer.dispose();void disposeAssets();window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',onVisibility);
  });
  window.addEventListener('pageshow',()=>{if(!disposed){previous=performance.now();renderer.setAnimationLoop(frame);}});
}
