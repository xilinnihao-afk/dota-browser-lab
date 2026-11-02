import * as THREE from 'three';
import type { model } from 'war3-model';
import {NativeParticles} from './particles';
import {textureAnimationMatrix} from './texture-animation';
import { modelTextures } from './assets';
import { nodeMatrix, sampleNumber, sampleTrack, type AnimationClock } from './animation';

const localPoseCache=new WeakMap<model.Model,{key:string;matrices:Map<number,THREE.Matrix4>}>();

type NativeMaterial = THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;
interface Surface {
  geometry: THREE.BufferGeometry;
  source: model.Geoset;
  layers: { mesh: THREE.Mesh; material: NativeMaterial; source: model.Layer; uvMatrix?: THREE.Matrix3 }[];
  animation?: model.GeosetAnim;
  blended:THREE.Matrix4[];
  groupTexture?:THREE.DataTexture;
}

function makeMaterial(layer: model.Layer, textures: THREE.Texture[]) {
  const flags = layer.Shading ?? 0, mode = layer.FilterMode ?? 0;
  const settings: THREE.MeshBasicMaterialParameters = {
    map: textures[typeof layer.TextureID === 'number' ? layer.TextureID : 0],
    side: flags & 16 ? THREE.DoubleSide : THREE.FrontSide,
    transparent: mode >= 2,
    depthWrite: mode <= 1 && !(flags & 128),
    depthTest: !(flags & 64),
    alphaTest: mode === 1 ? 0.75 : 0,
    fog: !(flags & 32),
    toneMapped: false,
  };
  const material = flags & 1 ? new THREE.MeshBasicMaterial(settings) : new THREE.MeshLambertMaterial(settings);
  material.forceSinglePass = true;
  if (mode >= 3) {
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = [THREE.SrcColorFactor, THREE.SrcAlphaFactor, THREE.ZeroFactor, THREE.DstColorFactor][mode - 3];
    material.blendDst = mode <= 4 ? THREE.OneFactor : THREE.SrcColorFactor;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
  }
  return material;
}

/** Classic MDX 800 renderer built from Three.js meshes. Both CPU and GPU paths
 * preserve equal weights over every MDX matrix-group member. */
export class NativeModel {
  readonly tint = new THREE.Color(1,1,1);
  readonly root = new THREE.Group();
  readonly surfaces: Surface[] = [];
  readonly matrices = new Map<number, THREE.Matrix4>();
  readonly sequences: string[];
  readonly particles:NativeParticles[]=[];
  poseCacheHits=0;
  profile=false;
  readonly costs={nodes:0,surfaces:0,effects:0};
  boneTexture?:THREE.DataTexture;
  private gpuBones:THREE.Matrix4[]=[];
  private nodes = new Map<number, model.Node>();
  private locals=new Map<number,THREE.Matrix4>();
  private dynamicNodes=new Set<number>();
  private sequenceIndex = 0;
  private elapsed = 0;
  private localTime = 0;
  private readonly billboardPivot=new THREE.Vector3();
  private readonly billboardScale=new THREE.Vector3();
  private readonly billboardRotation=new THREE.Quaternion();
  private readonly cameraPosition=new THREE.Vector3();
  private readonly cameraRotation=new THREE.Quaternion();
  private readonly rootRotation=new THREE.Quaternion();
  private readonly cameraBasis=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2);
  private readonly position = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly ribbons: { source: model.RibbonEmitter; mesh: THREE.Mesh; points: { time: number; a: THREE.Vector3; b: THREE.Vector3 }[]; last: number }[] = [];

  private constructor(readonly source: model.Model, readonly textures: THREE.Texture[]) {
    if (!source.Sequences.length) source.Sequences.push({Name:'Stand',Interval:new Uint32Array([0,1000]),NonLooping:false,MoveSpeed:0,Rarity:0,MinimumExtent:new Float32Array(3),MaximumExtent:new Float32Array(3),BoundsRadius:0} as model.Sequence);
    this.sequences = source.Sequences.map(s => s.Name);
    this.root.name = source.Info.Name;
    for (const node of source.Nodes) { this.nodes.set(node.ObjectId, node); this.matrices.set(node.ObjectId, new THREE.Matrix4()); }
    source.Geosets.forEach((geoset, index) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(geoset.Vertices.slice(), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('normal', new THREE.BufferAttribute(geoset.Normals.slice(), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('uv', new THREE.BufferAttribute(geoset.TVertices[0].slice(), 2));
      geometry.setIndex(new THREE.BufferAttribute(geoset.Faces, 1));
      const materialSource = source.Materials[geoset.MaterialID];
      const layers = materialSource.Layers.map((layer, layerIndex) => {
        const material = makeMaterial(layer, textures);
        const uvMatrix=typeof layer.TVertexAnimId==='number'?new THREE.Matrix3():undefined;
        if(uvMatrix){material.userData.nativeUV=true;material.onBeforeCompile=shader=>{shader.uniforms.nativeUV={value:uvMatrix};shader.vertexShader='uniform mat3 nativeUV;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv=(nativeUV*vec3(vMapUv,1.0)).xy;\n#endif');};material.customProgramCacheKey=()=> 'mdx-uv';}
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${source.Info.Name}/geoset-${index}/layer-${layerIndex}`;
        mesh.frustumCulled = false; // Animated extents can exceed bind-pose bounds.
        mesh.renderOrder = (materialSource.PriorityPlane ?? 0) * 100 + layerIndex;
        this.root.add(mesh);
        return { mesh, material, source: layer, uvMatrix };
      });
      this.surfaces.push({ geometry, source: geoset, layers, animation: source.GeosetAnims.find(a => a.GeosetId === index),blended:geoset.Groups.map(()=>new THREE.Matrix4()) });
    });
    for (const ribbon of source.RibbonEmitters) {
      const layer = source.Materials[ribbon.MaterialID ?? 0]?.Layers[0];
      if (!layer) continue;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), makeMaterial(layer, textures));
      mesh.name='ribbon/'+ribbon.Name;mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.visible = false;
      this.root.add(mesh); this.ribbons.push({source:ribbon, mesh, points:[], last:0});
    }
    for(const emitter of source.ParticleEmitters2){const particles=new NativeParticles(emitter,textures,emitter.ObjectId+1);this.particles.push(particles);this.root.add(particles.mesh);}
    this.setSequence('Stand');
    this.update(0);
  }

  static async create(source: model.Model, team = 0, replacements: Record<number,string> = {}) { return new NativeModel(source, await modelTextures(source, team, replacements)); }
  static fromParsed(source: model.Model, textures: THREE.Texture[]) { return new NativeModel(source, textures); }
  get sequence() { return this.source.Sequences[this.sequenceIndex]; }
  get progress() { return this.localTime / Math.max(1, this.sequence.Interval[1] - this.sequence.Interval[0]); }
  get frame() { return this.sequence.Interval[0] + this.localTime; }
  get clock(): AnimationClock { return {frame:this.frame, interval:this.sequence.Interval, elapsed:this.elapsed, globalSequences:this.source.GlobalSequences,nonLooping:this.sequence.NonLooping}; }

  setSequence(name: string) {
    const exact = this.sequences.findIndex(s => s.toLowerCase() === name.toLowerCase());
    const words=name.toLowerCase().split(/\s+/);
    const prefix = this.sequences.findIndex(s => words.every(w=>s.toLowerCase().split(/[\s-]+/).includes(w)));
    this.sequenceIndex = Math.max(0, exact >= 0 ? exact : prefix);
    this.localTime = this.elapsed = 0;
    this.locals.clear();this.dynamicNodes.clear();
    const varies=(track:model.AnimVector|undefined)=>{
      if(!track)return false;
      if(typeof track.GlobalSeqId==='number')return (this.source.GlobalSequences[track.GlobalSeqId]??0)>0&&track.Keys.length>1;
      return track.Keys.filter(k=>k.Frame>=this.sequence.Interval[0]&&k.Frame<=this.sequence.Interval[1]).length>1;
    };
    for(const [id,node]of this.nodes){this.locals.set(id,nodeMatrix(node,this.clock));if(varies(node.Translation)||varies(node.Rotation)||varies(node.Scaling))this.dynamicNodes.add(id);}
    this.particles.forEach(p=>p.reset());
    this.clearRibbons();
  }

  seek(progress: number) {
    this.localTime = Math.max(0, Math.min(1, progress)) * (this.sequence.Interval[1] - this.sequence.Interval[0]);
    this.elapsed=this.localTime;this.particles.forEach(p=>p.reset());
    this.clearRibbons();
    this.update(0);
  }

  private clearRibbons() { for (const ribbon of this.ribbons) {ribbon.points.length = 0; ribbon.last = this.elapsed; ribbon.mesh.visible = false;} }

  update(deltaSeconds: number, camera?: THREE.Camera, skin=true) {
    const profileStart=this.profile?performance.now():0;
    const delta = deltaSeconds * 1000;
    this.elapsed += delta; this.localTime += delta;
    const duration = Math.max(1, this.sequence.Interval[1] - this.sequence.Interval[0]);
    if (this.localTime > duration) {
      if (this.sequence.NonLooping) this.localTime = duration;
      else { this.localTime %= duration; this.clearRibbons(); }
    }
    const clock = this.clock, done = new Set<number>();
    // Local animation tracks depend on model/sequence/time, not placement or
    // camera. Share their samples; parent composition and billboards stay local.
    const poseKey=`${this.sequenceIndex}/${Math.round(clock.frame*1000)}/${Math.round(clock.elapsed*1000)}`;
    let shared=localPoseCache.get(this.source);
    if(!shared){shared={key:'',matrices:new Map()};localPoseCache.set(this.source,shared);}
    const reuse=shared.key===poseKey;shared.key=poseKey;this.poseCacheHits=0;
    this.root.updateWorldMatrix(true, false);
    const cameraPosition = camera ? this.root.worldToLocal(camera.getWorldPosition(this.cameraPosition)) : null;
    const cameraRotation = camera ? this.root.getWorldQuaternion(this.rootRotation).invert()
      .multiply(camera.getWorldQuaternion(this.cameraRotation)).multiply(this.cameraBasis) : null;
    const updateNode = (id: number) => {
      if (done.has(id)) return;
      const node = this.nodes.get(id); if (!node) return;
      // Mark first so malformed cyclic hierarchies cannot recurse forever.
      done.add(id);
      const local=this.locals.get(id)!;
      if(this.dynamicNodes.has(id)){
        const cached=shared!.matrices.get(id);
        if(reuse&&cached){local.copy(cached);this.poseCacheHits++;}
        else{nodeMatrix(node,clock,local);if(cached)cached.copy(local);else shared!.matrices.set(id,local.clone());}
      }
      const matrix=this.matrices.get(id)!.copy(local);
      if (typeof node.Parent === 'number' && this.nodes.has(node.Parent)) {
        updateNode(node.Parent); matrix.premultiply(this.matrices.get(node.Parent)!);
      }
      if (cameraPosition && cameraRotation && (node.Flags & (8 | 16 | 32 | 64))) {
        const pivot = this.billboardPivot.fromArray(node.PivotPoint).applyMatrix4(matrix);
        const rotation = this.billboardRotation, scale = this.billboardScale.setFromMatrixScale(matrix);
        if(matrix.determinant()<0)scale.x=-scale.x;
        let facing = cameraRotation;
        if (!(node.Flags & 8)) {
          matrix.decompose(this.position,rotation,scale);
          const axis = node.Flags & 16 ? new THREE.Vector3(1,0,0) : node.Flags & 32 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
          axis.applyQuaternion(rotation);
          const x = new THREE.Vector3(1,0,0).applyQuaternion(rotation);
          const toward = cameraPosition.clone().sub(pivot).projectOnPlane(axis).normalize();
          const current = x.projectOnPlane(axis).normalize();
          facing = new THREE.Quaternion().setFromUnitVectors(current, toward).multiply(rotation);
        }
        matrix.compose(pivot, facing, scale);
        const e=matrix.elements,[px,py,pz]=node.PivotPoint;
        e[12]-=e[0]*px+e[4]*py+e[8]*pz;e[13]-=e[1]*px+e[5]*py+e[9]*pz;e[14]-=e[2]*px+e[6]*py+e[10]*pz;
      }
    };
    for (const id of this.nodes.keys()) updateNode(id);
    if(skin&&this.boneTexture){
      const data=this.boneTexture.image.data as Float32Array;
      this.gpuBones.forEach((matrix,i)=>data.set(matrix.elements,i*16));
      this.boneTexture.needsUpdate=true;
    }
    const nodeEnd=this.profile?performance.now():0;
    for (const surface of this.surfaces) {
      const {source, geometry, animation} = surface;
      const alpha = sampleNumber(animation?.Alpha, clock);
      const color = animation?.Color instanceof Float32Array ? Array.from(animation.Color) : sampleTrack(animation?.Color, clock, [1,1,1]);
      for (const layer of surface.layers) {
        if(layer.uvMatrix)textureAnimationMatrix(this.source.TextureAnims[layer.source.TVertexAnimId!],clock,layer.uvMatrix);
        layer.mesh.visible = alpha > 0.001;
        layer.material.opacity = alpha * sampleNumber(layer.source.Alpha, clock);
        layer.mesh.visible &&= layer.material.opacity > 0.001;
        if ((layer.source.FilterMode ?? 0) <= 1) {
          layer.material.transparent = layer.material.opacity < .999;
          layer.material.depthWrite = !layer.material.transparent && !((layer.source.Shading ?? 0) & 128);
        }
        layer.material.color.setRGB(color[0], color[1], color[2]).multiply(this.tint);
        const textureId = Math.round(sampleNumber(layer.source.TextureID, clock, 0));
        if (layer.material.map !== this.textures[textureId]) { layer.material.map = this.textures[textureId]; layer.material.needsUpdate = true; }
      }
      if (!skin || this.boneTexture || !surface.layers.some(l => l.mesh.visible)) continue;
      const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
      const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
      // Every MDX vertex uses one equal-weight matrix group. Blend each group
      // once, instead of repeating the same bone sum for every vertex.
      source.Groups.forEach((group,i)=>{
        const blended=surface.blended[i],e=blended.elements;e.fill(0);let count=0;
        for(const id of group){const matrix=this.matrices.get(id);if(!matrix)continue;count++;for(let k=0;k<16;k++)e[k]+=matrix.elements[k];}
        if(count){for(let k=0;k<16;k++)e[k]/=count;}else blended.identity();
      });
      for (let v = 0; v < source.Vertices.length / 3; v++) {
        const transform=surface.blended[source.VertexGroup[v]];
        this.position.fromArray(source.Vertices,v*3);this.normal.fromArray(source.Normals,v*3);
        if(transform){this.position.applyMatrix4(transform);this.normal.transformDirection(transform);}
        positions.setXYZ(v,this.position.x,this.position.y,this.position.z);
        normals.setXYZ(v,this.normal.x,this.normal.y,this.normal.z);
      }
      positions.needsUpdate = normals.needsUpdate = true;
    }
    const surfaceEnd=this.profile?performance.now():0;
    this.updateRibbons(deltaSeconds);
    for(const p of this.particles)p.update(deltaSeconds,clock,this.matrices.get(p.source.ObjectId)??new THREE.Matrix4(),this.root,camera);
    if(this.profile){this.costs.nodes=this.costs.nodes*.9+(nodeEnd-profileStart)*.1;this.costs.surfaces=this.costs.surfaces*.9+(surfaceEnd-nodeEnd)*.1;this.costs.effects=this.costs.effects*.9+(performance.now()-surfaceEnd)*.1;}
  }

  private updateRibbons(delta: number) {
    for (const ribbon of this.ribbons) {
      const {source, points, mesh} = ribbon, life = (source.LifeSpan ?? .3) * 1000;
      while (points.length && this.elapsed - points[0].time > life) points.shift();
      const visible = sampleNumber(source.Visibility, this.clock, 1) > 0 && sampleNumber(source.Alpha, this.clock, 1) > 0;
      if (delta > 0 && visible && this.elapsed - ribbon.last >= 1000 / (source.EmissionRate || 30)) {
        const pivot = new THREE.Vector3().fromArray(source.PivotPoint), matrix = this.matrices.get(source.ObjectId)!;
        points.push({time:this.elapsed,
          a:pivot.clone().add(new THREE.Vector3(0,0,sampleNumber(source.HeightAbove,this.clock,0))).applyMatrix4(matrix),
          b:pivot.clone().add(new THREE.Vector3(0,0,-sampleNumber(source.HeightBelow,this.clock,0))).applyMatrix4(matrix)});
        ribbon.last = this.elapsed;
      }
      mesh.visible = points.length > 1;
      if (!mesh.visible) continue;
      const positions:number[] = [], uvs:number[] = [], indices:number[] = [];
      for (let i=0;i<points.length;i++) { positions.push(...points[i].a.toArray(),...points[i].b.toArray()); const u=i/(points.length-1);uvs.push(u,0,u,1);if(i>0){const n=i*2;indices.push(n-2,n-1,n,n-1,n+1,n);} }
      mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry();
      mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));mesh.geometry.setIndex(indices);
      (mesh.material as NativeMaterial).opacity = sampleNumber(source.Alpha,this.clock,1);
      if(source.Color)(mesh.material as NativeMaterial).color.setRGB(source.Color[0],source.Color[1],source.Color[2]);
    }
  }

  /** Upload each node once; the vertex shader blends the original groups.
   * A static lookup texture supports every group member, including >4 joints.
   * Enable after making any CPU-baked distant representation. */
  enableGpuSkinning(){
    if(this.boneTexture)return;
    const ids=new Map([...this.matrices.keys()].map((id,i)=>[id,i]));
    this.gpuBones=[...this.matrices.values(),new THREE.Matrix4()];
    const count=this.gpuBones.length,data=new Float32Array(count*16);
    this.gpuBones.forEach((matrix,i)=>data.set(matrix.elements,i*16));
    const texture=this.boneTexture=new THREE.DataTexture(data,4,count,THREE.RGBAFormat,THREE.FloatType);
    texture.name='MDX node matrices';texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
    for(const surface of this.surfaces){
      const {geometry,source}=surface,rows=source.Groups.length+1,maxMembers=Math.max(1,...source.Groups.map(g=>g.length)),columns=Math.ceil(maxMembers/4);
      const lookup=new Float32Array(rows*columns*4).fill(-1);
      source.Groups.forEach((group,row)=>{const members=group.filter(id=>ids.has(id));if(members.length)members.forEach((id,slot)=>lookup[row*columns*4+slot]=ids.get(id)!);else lookup[row*columns*4]=count-1;});
      lookup[(rows-1)*columns*4]=count-1;
      const groupTexture=surface.groupTexture=new THREE.DataTexture(lookup,columns,rows,THREE.RGBAFormat,THREE.FloatType);
      groupTexture.name='MDX group indices';groupTexture.minFilter=groupTexture.magFilter=THREE.NearestFilter;groupTexture.generateMipmaps=false;groupTexture.needsUpdate=true;
      const groups=new Float32Array(source.Vertices.length/3);for(let i=0;i<groups.length;i++)groups[i]=source.VertexGroup[i]<source.Groups.length?source.VertexGroup[i]:rows-1;
      geometry.setAttribute('nativeGroup',new THREE.BufferAttribute(groups,1));
      const positions=geometry.getAttribute('position')as THREE.BufferAttribute,normals=geometry.getAttribute('normal')as THREE.BufferAttribute;
      (positions.array as Float32Array).set(source.Vertices);(normals.array as Float32Array).set(source.Normals);positions.needsUpdate=normals.needsUpdate=true;
      for(const layer of surface.layers){
        const material=layer.material,previous=material.onBeforeCompile,key=material.customProgramCacheKey();
        material.onBeforeCompile=(shader,renderer)=>{
          previous.call(material,shader,renderer);shader.uniforms.nativeBones={value:texture};shader.uniforms.nativeBoneCount={value:count};
          shader.uniforms.nativeGroups={value:groupTexture};shader.uniforms.nativeGroupSize={value:new THREE.Vector2(columns,rows)};
          shader.vertexShader=`attribute float nativeGroup;
            uniform sampler2D nativeBones;
            uniform float nativeBoneCount;
            uniform sampler2D nativeGroups;
            uniform vec2 nativeGroupSize;
            mat4 nativeSkinMatrix(){
              mat4 result=mat4(0.0);float weights=0.0;
              for(int slot=0;slot<${maxMembers};slot++){
                vec4 members=texture2D(nativeGroups,vec2((float(slot/4)+0.5)/nativeGroupSize.x,(nativeGroup+0.5)/nativeGroupSize.y));
                float index=members[slot-4*(slot/4)];
                if(index<0.0)break;
                float v=(index+0.5)/nativeBoneCount;
                result+=mat4(texture2D(nativeBones,vec2(0.125,v)),texture2D(nativeBones,vec2(0.375,v)),texture2D(nativeBones,vec2(0.625,v)),texture2D(nativeBones,vec2(0.875,v)));weights+=1.0;
              }
              return result/max(weights,1.0);
            }
            `+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','mat4 nativeTransform=nativeSkinMatrix();\n#include <uv_vertex>');
          shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=mat3(nativeTransform)*objectNormal;\nobjectNormal/=max(length(objectNormal),0.000001);');
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=(nativeTransform*vec4(transformed,1.0)).xyz;');
        };
        material.customProgramCacheKey=()=>key+'|native-gpu-groups-'+maxMembers;material.needsUpdate=true;
      }
    }
  }

  prewarm(seconds:number,camera:THREE.Camera,seed=1){
    this.particles.forEach((p,i)=>p.reset(seed+i*7919));
    const steps=Math.round(seconds*60);for(let i=0;i<steps;i++)this.update(1/60,camera,false);this.update(0,camera);
  }

  dispose() {
    this.boneTexture?.dispose();
    this.particles.forEach(p=>p.dispose());
    for (const surface of this.surfaces) { surface.geometry.dispose(); surface.groupTexture?.dispose(); surface.layers.forEach(layer => layer.material.dispose()); }
    for (const ribbon of this.ribbons) { ribbon.mesh.geometry.dispose(); (ribbon.mesh.material as THREE.Material).dispose(); }
    this.root.removeFromParent();
  }
}
