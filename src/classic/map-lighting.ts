import * as THREE from 'three';
import type {model} from 'war3-model';
import {loadModel} from './assets';
import {sampleNumber,sampleTrack,nodeMatrix,type AnimationClock} from './animation';
import type {MapData} from './map-data';

export function sampleDayNight(source:model.Model,hour:number){
  const interval=source.Sequences[0].Interval,duration=interval[1]-interval[0];
  const clock:AnimationClock={interval,frame:interval[0]+((hour%24+24)%24)/24*duration,elapsed:hour/24*duration,globalSequences:source.GlobalSequences};
  const ambient=new THREE.Color(0,0,0),diffuse=new THREE.Color(0,0,0),direction=new THREE.Vector3(0,0,1);
  const color=(v:model.AnimVector|Float32Array|undefined)=>ArrayBuffer.isView(v)?Array.from(v as Float32Array):sampleTrack(v as model.AnimVector,clock,[1,1,1]);
  for(const l of source.Lights){
    const visible=sampleNumber(l.Visibility,clock,1);if(!visible)continue;
    const a=color(l.AmbColor),d=color(l.Color);
    ambient.add(new THREE.Color().setRGB(a[0],a[1],a[2]).multiplyScalar(sampleNumber(l.AmbIntensity,clock,0)*visible));
    if(l.LightType===1){diffuse.add(new THREE.Color().setRGB(d[0],d[1],d[2]).multiplyScalar(sampleNumber(l.Intensity,clock,1)*visible));direction.set(0,0,1).transformDirection(nodeMatrix(l,clock));}
  }
  return{ambient,diffuse,direction};
}
/** Separate terrain and unit DNC values, with classic diffuse + ambient lighting.
 * Keep native unshaded layers untouched. No modern tone mapping or bloom. */
export async function createMapLighting(map:MapData){
  const models=await Promise.all([loadModel(map.lighting.terrain),loadModel(map.lighting.unit)]);
  const sets=models.map(()=>({nativeAmbient:{value:new THREE.Color()},nativeDiffuse:{value:new THREE.Color()},nativeDirection:{value:new THREE.Vector3()}}));
  const pointUniforms={nativePointPosition:{value:Array.from({length:8},()=>new THREE.Vector3())},nativePointColor:{value:Array.from({length:8},()=>new THREE.Color(0,0,0))},nativePointAmbient:{value:Array.from({length:8},()=>new THREE.Color(0,0,0))},nativePointRange:{value:Array.from({length:8},()=>new THREE.Vector2())}};
  let localCount=0;
  function updateLocal(lights:{position:THREE.Vector3;color:THREE.Color;ambient:THREE.Color;start:number;end:number}[],target:THREE.Vector3){
    const selected=lights.filter(l=>l.end>0).sort((a,b)=>a.position.distanceToSquared(target)-b.position.distanceToSquared(target)).slice(0,8);localCount=selected.length;
    for(let i=0;i<8;i++){const l=selected[i];pointUniforms.nativePointColor.value[i].setRGB(0,0,0);pointUniforms.nativePointAmbient.value[i].setRGB(0,0,0);
      if(l){pointUniforms.nativePointPosition.value[i].copy(l.position);pointUniforms.nativePointColor.value[i].copy(l.color);pointUniforms.nativePointAmbient.value[i].copy(l.ambient);pointUniforms.nativePointRange.value[i].set(l.start,l.end);}
    }
  }
  const attached=new WeakSet<THREE.Material>();let hour=map.lighting.initialHour;
  function setHour(value:number){hour=((value%24)+24)%24;models.forEach((source,i)=>{const light=sampleDayNight(source,hour);sets[i].nativeAmbient.value.copy(light.ambient);sets[i].nativeDiffuse.value.copy(light.diffuse);sets[i].nativeDirection.value.copy(light.direction);});}
  setHour(hour);
  function attach(root:THREE.Object3D,kind:'terrain'|'unit'){
    root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
      if(!(m instanceof THREE.MeshLambertMaterial)||attached.has(m))continue;attached.add(m);
      const previous=m.onBeforeCompile,cache=m.customProgramCacheKey.bind(m),key=cache();
      m.onBeforeCompile=(shader,renderer)=>{previous.call(m,shader,renderer);Object.assign(shader.uniforms,sets[kind==='terrain'?0:1],pointUniforms);
        shader.vertexShader='varying vec3 nativeWorldPosition;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvec4 nativeWorld=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nnativeWorld=instanceMatrix*nativeWorld;\n#endif\nnativeWorldPosition=(modelMatrix*nativeWorld).xyz;');
        shader.fragmentShader='varying vec3 nativeWorldPosition;\nuniform vec3 nativePointPosition[8];\nuniform vec3 nativePointColor[8];\nuniform vec3 nativePointAmbient[8];\nuniform vec2 nativePointRange[8];\nuniform vec3 nativeAmbient;\nuniform vec3 nativeDiffuse;\nuniform vec3 nativeDirection;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', 'vec3 nativeLight = nativeAmbient + nativeDiffuse * max(dot(normal, normalize(mat3(viewMatrix) * nativeDirection)), 0.0);\nfor(int i=0;i<8;i++){vec3 toward=nativePointPosition[i]-nativeWorldPosition;float distanceToLight=length(toward);float falloff=clamp((nativePointRange[i].y-distanceToLight)/max(0.001,nativePointRange[i].y-nativePointRange[i].x),0.0,1.0);nativeLight+=falloff*(nativePointAmbient[i]+nativePointColor[i]*max(dot(normal,mat3(viewMatrix)*toward/max(0.001,distanceToLight)),0.0));}\nvec3 outgoingLight = diffuseColor.rgb * nativeLight + totalEmissiveRadiance;');};
      m.customProgramCacheKey=()=>key+'|dnc-'+kind;m.needsUpdate=true;
    }});
  }
  return{setHour,attach,updateLocal,get hour(){return hour;},get diagnostics(){return{hour,localLights:localCount,localLightLimit:8,terrain:{ambient:sets[0].nativeAmbient.value.toArray(),diffuse:sets[0].nativeDiffuse.value.toArray(),direction:sets[0].nativeDirection.value.toArray()},unit:{ambient:sets[1].nativeAmbient.value.toArray(),diffuse:sets[1].nativeDiffuse.value.toArray()}};}};
}
