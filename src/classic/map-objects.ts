import * as THREE from 'three';
import {NativeModel} from './native-model';
import {loadModel,loadTexture} from './assets';
import {heightAt,type MapData,type Placement} from './map-data';
import {sampleNumber,sampleTrack} from './animation';
import {bakeWorld,disposeBaked,ParticleBatches} from './batching';

export async function createMapObjects(map:MapData,onProgress:(done:number,total:number)=>void,captureTime=4,profile=false,gpuSkinning=true,suppressedUnits:ReadonlySet<Placement>=new Set()){
  const root=new THREE.Group(),trees=new THREE.Group(),props=new THREE.Group(),units=new THREE.Group(),nearTrees=new THREE.Group(),nearProps=new THREE.Group(),nearUnits=new THREE.Group();
  root.add(trees,props,units);trees.add(nearTrees);props.add(nearProps);units.add(nearUnits);
  const groups=new Map<string,Placement[]>(),animated:{model:NativeModel;placement:Placement;warm:boolean;seed:number;pending:number;next:number;skinClock:number;cpu:number}[]=[],prototypes:NativeModel[]=[],failures:{path:string;reason:string;count:number}[]=[];
  for(const p of map.placements){if(p.kind==='unit'&&suppressedUnits.has(p))continue;const key=JSON.stringify([p.model,p.team,p.replacements,p.sequence]);if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(p);}
  let done=0,placedDoodads=0,placedUnits=0,animatedDoodads=0;
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),axis=new THREE.Vector3(0,0,1),position=new THREE.Vector3(),scale=new THREE.Vector3();
  const chunks:THREE.InstancedMesh[]=[],splats:THREE.Mesh[]=[];
  for(const list of groups.values()){
    const p=list[0];
    try{
      const source=await loadModel(p.model);
      if(p.kind==='unit'||source.ParticleEmitters2.length||source.TextureAnims.length||source.Lights.length){
        for(const placement of list){
          const model=await NativeModel.create(source,placement.team,placement.replacements);
          model.setSequence(placement.sequence);model.seek(.17);model.tint.fromArray(placement.color);model.root.position.fromArray(placement.position);
          if(placement.kind==='unit')model.root.position.z=heightAt(map,placement.position[0],placement.position[1])+(placement.moveHeight??0);
          model.root.rotation.z=placement.angle;model.root.scale.fromArray(placement.scale);model.update(0);
          (placement.kind==='unit'?nearUnits:nearProps).add(model.root);
          animated.push({model,placement,warm:false,pending:0,next:0,cpu:0,skinClock:(animated.length%8)/8/60,seed:(placement.editorId??placement.sourceLine??animated.length)+1});
          if(placement.kind==='unit')placedUnits++;else{placedDoodads++;animatedDoodads++;}
          if(placement.splat){
            const diameter=placement.splat.scale*2,geo=new THREE.PlaneGeometry(diameter,diameter,4,4),positions=geo.getAttribute('position');
            for(let i=0;i<positions.count;i++){const x=positions.getX(i)+placement.position[0],y=positions.getY(i)+placement.position[1];positions.setXYZ(i,x,y,heightAt(map,x,y)+.65);}
            const material=new THREE.MeshBasicMaterial({map:await loadTexture(placement.splat.path),transparent:true,depthWrite:false,toneMapped:false});
            const splat=new THREE.Mesh(geo,material);splat.renderOrder=11;nearUnits.add(splat);splats.push(splat);
          }
        }
      }else{
        const prototype=await NativeModel.create(source,p.team,p.replacements);prototype.setSequence(p.sequence);prototype.seek(p.sequence==='Death'?1:.19);prototype.update(0);prototypes.push(prototype);
        const cells=new Map<string,Placement[]>();for(const placement of list){const key=`${Math.floor(placement.position[0]/2048)},${Math.floor(placement.position[1]/2048)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(placement);}
        const parent=/\/terrain\/(ashentree|northrendtree|lordaerontree)/.test(p.model)?nearTrees:nearProps;
        for(const cell of cells.values())for(const surface of prototype.surfaces)for(const layer of surface.layers){
          if(!layer.mesh.visible)continue;
          const mesh=new THREE.InstancedMesh(surface.geometry,layer.material,cell.length);mesh.renderOrder=layer.mesh.renderOrder;
          cell.forEach((placement,i)=>{position.fromArray(placement.position);scale.fromArray(placement.scale);quaternion.setFromAxisAngle(axis,placement.angle);matrix.compose(position,quaternion,scale);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color().fromArray(placement.color));});
          mesh.computeBoundingSphere();parent.add(mesh);chunks.push(mesh);
        }
        placedDoodads+=list.length;
      }
    }catch(error){failures.push({path:p.model,reason:error instanceof Error?error.message:String(error),count:list.length});}
    onProgress(++done,groups.size);if(done%8===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const shadowTexture=await loadTexture('replaceabletextures/shadows/shadow.blp');
  const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,opacity:.4,toneMapped:false});
  const shadowGeometry=new THREE.PlaneGeometry(1,1),shadows=new THREE.Group();root.add(shadows);
  // Tree shadows follow the tree visibility control.
  const shadowPlacements=map.placements.filter(p=>!suppressedUnits.has(p)&&(p.kind==='unit'||/\/terrain\/(ashentree|northrendtree)/.test(p.model)));
  const cells=new Map<string,Placement[]>();for(const p of shadowPlacements){const key=`${p.kind},${Math.floor(p.position[0]/2048)},${Math.floor(p.position[1]/2048)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(p);}
  for(const cell of cells.values()){
    const mesh=new THREE.InstancedMesh(shadowGeometry,shadowMaterial,cell.length);mesh.renderOrder=12;
    cell.forEach((p,i)=>{const size=p.kind==='unit'?220:210;position.set(p.position[0],p.position[1],heightAt(map,p.position[0],p.position[1])+1);matrix.compose(position,new THREE.Quaternion(),scale.set(size*p.scale[0],size*p.scale[1],1));mesh.setMatrixAt(i,matrix);});mesh.computeBoundingSphere();(cell[0].kind==='unit'?shadows:nearTrees).add(mesh);chunks.push(mesh);
  }
  const overviewCamera=new THREE.PerspectiveCamera();overviewCamera.up.set(0,0,1);overviewCamera.position.set(0,-1820,32000);overviewCamera.lookAt(0,-1500,0);overviewCamera.updateMatrixWorld();
  animated.forEach(a=>a.model.update(0,overviewCamera));
  const farTrees=bakeWorld(nearTrees),farProps=bakeWorld(nearProps),farUnits=bakeWorld(nearUnits),farShadows=bakeWorld(shadows);
  trees.add(farTrees);props.add(farProps);units.add(farUnits);root.add(farShadows);
  animated.forEach(a=>{if(gpuSkinning)a.model.enableGpuSkinning();a.model.profile=profile;});
  const particleBatches=new ParticleBatches();root.add(particleBatches.root);
  let far=false;
  const setFar=(value:boolean)=>{far=value;animated.forEach((a,i)=>{a.pending=0;a.next=(i/animated.length)*.1;});nearTrees.visible=nearProps.visible=nearUnits.visible=shadows.visible=!far;farTrees.visible=farProps.visible=farUnits.visible=farShadows.visible=particleBatches.root.visible=far;};setFar(false);
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),lastCamera=new THREE.Matrix4(),sphere=new THREE.Sphere();let firstFrame=true;
  const counts={placedDoodads,placedUnits,animatedDoodads,instancedBatches:chunks.length,farBatches:farTrees.children.length+farProps.children.length+farUnits.children.length+farShadows.children.length};
  const localLights=animated.flatMap(({model})=>model.source.Lights.filter(s=>s.LightType===0).map(source=>({model,source,position:new THREE.Vector3(),color:new THREE.Color(),ambient:new THREE.Color(),start:0,end:0})));
  function updateLights(){for(const l of localLights){const clock=l.model.clock,visible=sampleNumber(l.source.Visibility,clock,1),color=(v:typeof l.source.Color)=>v instanceof Float32Array?Array.from(v):sampleTrack(v,clock,[1,1,1]);
    l.position.fromArray(l.source.PivotPoint).applyMatrix4(l.model.matrices.get(l.source.ObjectId)??matrix.identity()).applyMatrix4(l.model.root.matrixWorld);
    l.color.fromArray(color(l.source.Color)).multiplyScalar(sampleNumber(l.source.Intensity,clock,1)*visible);
    l.ambient.fromArray(color(l.source.AmbColor)).multiplyScalar(sampleNumber(l.source.AmbIntensity,clock,0)*visible);
    const scale=l.model.root.scale.length()/Math.sqrt(3);l.start=sampleNumber(l.source.AttenuationStart,clock,0)*scale;l.end=sampleNumber(l.source.AttenuationEnd,clock,0)*scale;
  }}
  let liveParticles=0,activeEmitters=0,droppedParticles=0,updatedModels=0,simulationMs=0,particleBatchMs=0,moved=false;
  return {root,trees,props,units,failures,counts,setFar,localLights,get stats(){return{tier:far?'overview':'near',expensiveModels:animated.filter(a=>a.model.root.visible).sort((a,b)=>b.cpu-a.cpu).slice(0,5).map(a=>({path:a.placement.model,ms:Math.round(a.cpu*100)/100,costs:a.model.costs})),updatedModels,simulationMs,particleBatchMs,cameraChanged:moved,liveParticles,activeEmitters,droppedParticles,particleBatches:far?particleBatches.root.children.filter(c=>c.visible).length:0,animationHz:far?10:60,skeletalHz:far?0:60,gpuSkinModels:gpuSkinning?animated.length:0,sharedNodeSamples:animated.filter(a=>a.model.root.visible).reduce((n,a)=>n+a.model.poseCacheHits,0)};},
    update(delta:number,camera:THREE.Camera,freeze=false){
      camera.updateMatrixWorld();const cameraChanged=firstFrame||lastCamera.elements.some((v,i)=>Math.abs(v-camera.matrixWorld.elements[i])>1e-6);moved=cameraChanged;firstFrame=false;lastCamera.copy(camera.matrixWorld);
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
      let effectsChanged=cameraChanged;const simulationStart=performance.now();updatedModels=0;
      liveParticles=activeEmitters=droppedParticles=0;const particleMeshes:THREE.Mesh[]=[];
      for(const a of animated){const {model}=a;sphere.center.copy(model.root.position);sphere.radius=Math.max(500,model.source.Info.BoundsRadius??0)*model.root.scale.length()/Math.sqrt(3);model.root.visible=frustum.intersectsSphere(sphere);
        if(!model.root.visible)continue;
        if(!a.warm){model.prewarm(captureTime,camera,a.seed);a.warm=true;}
        if(!freeze){a.pending+=delta;a.next-=delta;a.skinClock+=delta;}
        const tick=!freeze&&(!far||a.next<=0);
        if(tick||cameraChanged){updatedModels++;const modelStart=performance.now();
          // Spread the 10 Hz overview work over frames instead of a periodic CPU spike.
          const skin=!far&&(cameraChanged||a.skinClock>=1/60);if(skin)a.skinClock%=1/60;
          if(!far||model.particles.length||model.source.TextureAnims.length)model.update(tick?a.pending:0,camera,skin);
          a.cpu=a.cpu*.9+(performance.now()-modelStart)*.1;
          if(tick){a.pending=0;a.next=far?a.next+.1:0;effectsChanged=true;}
        }
        for(const p of model.particles){liveParticles+=p.particles.length;activeEmitters+=Number(p.particles.length>0);droppedParticles+=p.dropped;particleMeshes.push(p.mesh);}
      }
      simulationMs=performance.now()-simulationStart;const batchStart=performance.now();
      if(far&&effectsChanged)particleBatches.update(particleMeshes);
      particleBatchMs=performance.now()-batchStart;
      updateLights();
    },
    dispose(){chunks.forEach(c=>c.dispose());prototypes.forEach(p=>p.dispose());animated.forEach(a=>a.model.dispose());splats.forEach(s=>{s.geometry.dispose();(s.material as THREE.Material).dispose();});shadowMaterial.dispose();shadowGeometry.dispose();[farTrees,farProps,farUnits,farShadows].forEach(disposeBaked);particleBatches.dispose();root.removeFromParent();}
  };
}
