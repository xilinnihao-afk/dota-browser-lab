import * as THREE from 'three';

/** Short contact accents supplement the original MDX weapon animation/ribbon.
 * Slots and geometry are reused: clicking faster cannot accumulate emitters. */
export class AttackEffects {
  private readonly geometry:THREE.BufferGeometry;
  private readonly slots:{arc:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;flash:THREE.Sprite;life:number;duration:number;direction:number;size:number;axe:boolean}[]=[];
  spawned=0;
  constructor(root:THREE.Object3D,glow:THREE.Texture,capacity=16){
    const positions:number[]=[],colors:number[]=[],indices:number[]=[],segments=24;
    for(let i=0;i<=segments;i++){
      const t=i/segments,angle=(t-.5)*1.9,tip=Math.sin(Math.PI*t),width=.18*tip;
      for(const radius of [1-width,1]){
        positions.push(Math.cos(angle)*radius,Math.sin(angle)*radius,0);
        const brightness=Math.pow(tip,.6);colors.push(brightness,brightness,brightness);
      }
      if(i<segments){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
    }
    this.geometry=new THREE.BufferGeometry();
    this.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    this.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.geometry.setIndex(indices);
    for(let i=0;i<capacity;i++){
      const material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false});
      const arc=new THREE.Mesh(this.geometry,material);arc.name='weapon-contact-arc';arc.visible=false;arc.renderOrder=36;
      const flash=new THREE.Sprite(new THREE.SpriteMaterial({map:glow,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
      flash.name='weapon-contact-flash';flash.visible=false;flash.renderOrder=37;root.add(arc,flash);
      this.slots.push({arc,flash,life:0,duration:.24,direction:0,size:1,axe:false});
    }
  }
  impact(kind:'blade'|'axe',x:number,y:number,z:number,direction:number){
    const slot=this.slots.find(s=>s.life<=0)??this.slots.reduce((a,b)=>a.life<b.life?a:b);
    slot.axe=kind==='axe';slot.duration=slot.axe?.3:.24;slot.life=slot.duration;slot.direction=direction;slot.size=slot.axe?100:88;
    // The arc terminates at the contact point and follows the attack heading.
    slot.arc.position.set(x-Math.cos(direction)*slot.size*.7,y-Math.sin(direction)*slot.size*.7,z);
    slot.arc.material.color.setHex(slot.axe?0xffb36d:0xe9f2bd);
    slot.flash.material.color.copy(slot.arc.material.color);slot.flash.position.set(x,y,z);
    this.spawned++;this.paint(slot);
  }
  private paint(slot:typeof this.slots[number]){
    const age=1-slot.life/slot.duration,envelope=Math.pow(1-age,1.5);
    slot.arc.visible=slot.flash.visible=slot.life>0;
    slot.arc.rotation.set(slot.axe?-.55:.14,slot.axe?.42:0,slot.direction+(age-.5)*.55);
    slot.arc.scale.setScalar(slot.size*(.85+age*.22));slot.arc.material.opacity=envelope*.9;
    slot.flash.material.opacity=Math.pow(1-age,3)*.68;slot.flash.scale.setScalar((slot.axe?76:64)*(1+age*.5));
  }
  update(delta:number){for(const slot of this.slots)if(slot.life>0){slot.life=Math.max(0,slot.life-delta);this.paint(slot);}}
  get active(){return this.slots.filter(s=>s.life>0).length;}
  clear(){for(const slot of this.slots){slot.life=0;slot.arc.visible=slot.flash.visible=false;}this.spawned=0;}
  dispose(){this.clear();this.geometry.dispose();for(const slot of this.slots){slot.arc.removeFromParent();slot.flash.removeFromParent();slot.arc.material.dispose();slot.flash.material.dispose();}this.slots.length=0;}
}
