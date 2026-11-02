import * as THREE from 'three';
export function fallback(message:string){const node=document.getElementById('minitool-recovery')!;node.hidden=false;node.querySelector('p')!.textContent=message;}
export async function guard(boot:()=>Promise<void>){
 document.getElementById('minitool-retry')!.addEventListener('click',()=>location.reload());
 const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');if(!gl){fallback('当前设备暂不支持此 3D 战场。请更新小红书或换一台支持 WebGL 2 的设备后重试。');return;}
 gl.getExtension('WEBGL_lose_context')?.loseContext();
 try{await boot();}catch(e){fallback('游戏加载未完成：'+(e instanceof Error?e.message:String(e)));}
}
export function createRenderBudget(renderer:THREE.WebGLRenderer,onLow:()=>void){
 let low=false,slow=0,severe=0,stopped=false;const hidden:THREE.Object3D[]=[],pool=new WeakMap<THREE.Mesh,{o:THREE.Mesh;cost:number;calls:number;score:number}>();
 const candidates:{o:THREE.Mesh;cost:number;calls:number;score:number}[]=[];
 const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),center=new THREE.Vector3();
 const restore=()=>{for(const o of hidden)o.visible=true;hidden.length=0;};
 function limit(scene:THREE.Scene,camera:THREE.Camera,target:THREE.Vector3){
  scene.updateMatrixWorld();camera.updateMatrixWorld();frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  candidates.length=0;
  scene.traverseVisible(o=>{const m=o as THREE.Mesh;if(!m.isMesh||(m.frustumCulled&&!frustum.intersectsObject(m)))return;const g=m.geometry,instances=(m as THREE.InstancedMesh).isInstancedMesh?(m as THREE.InstancedMesh).count:1;
   if(!g.boundingSphere)g.computeBoundingSphere();center.copy(g.boundingSphere!.center).applyMatrix4(m.matrixWorld);const horizontal=Math.hypot(center.x-target.x,center.y-target.y);
   const material=Array.isArray(m.material)?m.material[0]:m.material,terrain=(material as THREE.MeshLambertMaterial).map?.name==='minitool/terrain-atlas.webp';
   for(const mat of Array.isArray(m.material)?m.material:[m.material])if(mat.transparent&&mat.side===THREE.DoubleSide)mat.forceSinglePass=true;
   let item=pool.get(m);if(!item){item={o:m,cost:0,calls:0,score:0};pool.set(m,item);}item.cost=Math.min(g.index?.count??g.attributes.position.count,g.drawRange.count)/3*instances;item.calls=Array.isArray(m.material)?g.groups.length:1;item.score=horizontal+(terrain?-100000:0);candidates.push(item);
  });
  candidates.sort((a,b)=>a.score-b.score);let calls=0,tris=0;
  for(const c of candidates){if(calls+c.calls>(low?50:100)||tris+c.cost>(low?50000:100000)){c.o.visible=false;hidden.push(c.o);}else{calls+=c.calls;tris+=c.cost;}}
 }
 function observe(elapsed:number){if(elapsed>.048)slow++;else slow=Math.max(0,slow-1);if(slow>90&&!low){low=true;slow=0;onLow();}if(low&&elapsed>.16)severe++;else severe=Math.max(0,severe-1);if(severe>100){stopped=true;fallback('当前设备运行较吃力，已暂停画面。关闭其他应用后可重新进入。');}return!stopped;}
 renderer.debug.onShaderError=()=>{stopped=true;fallback('当前设备无法显示战场画面，请更新小红书后重试。');};
 return {restore,limit,observe,setLow(value:boolean){low=value;slow=0;severe=0;},get stopped(){return stopped;},stop(){stopped=true;}};
}
