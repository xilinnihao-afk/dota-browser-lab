import manifest from '../generated/resources.json';
const records=manifest as Record<string,{script?:string;image?:string}>;
const pending=new Map<string,Promise<any>>(),rawValues=new Map<string,any>();
const scripts=new Map<string,Promise<void>>(),members=new Map<string,string[]>();
for(const key of Object.keys(records)){const file=records[key].script;if(file){if(!members.has(file))members.set(file,[]);members.get(file)!.push(key);}}
const constructors:Record<string,any>={Float32Array,Float64Array,Uint32Array,Int32Array,Uint16Array,Int16Array,Uint8Array,Int8Array};
export function revive(value:any):any{
 if(!value||typeof value!=='object')return value;
 if(ArrayBuffer.isView(value))return value;
 if(value.$type){const C=constructors[value.$type];if(!C)throw Error('未知模型字段');if(value.values)return new C(value.values);const raw=atob(value.base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new C(bytes.buffer);}
 if(value.$keys){const {fields,types,rows}=value.$keys;value.Keys=rows.map((row:any[])=>{const key:any={};fields.forEach((field:string,i:number)=>{key[field]=types[i]?new constructors[types[i]](row[i]):row[i];});return key;});delete value.$keys;}
 for(const k of Object.keys(value))value[k]=revive(value[k]);return value;
}
(window as any).__dotaData=(key:string,data:any)=>{rawValues.set(key,data);};
let active=0;const queue:(()=>void)[]=[];
function release(){active--;const next=queue.shift();if(next)next();}
function loadScript(file:string):Promise<void>{
 const existing=scripts.get(file);if(existing)return existing;
 let resolve!:()=>void,reject!:(error:Error)=>void;
 const task=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});scripts.set(file,task);
 const run=()=>{
  active++;const script=document.createElement('script');let finished=false;
  const done=(error?:Error)=>{
   if(finished)return;finished=true;clearTimeout(timer);script.onload=null;script.onerror=null;script.remove();
   if(error){scripts.delete(file);for(const key of members.get(file)!)rawValues.delete(key);reject(error);}else resolve();
   release();
  };
  const timer=setTimeout(()=>done(Error('包内资源读取超时：'+file)),20000);
  script.onload=()=>done(members.get(file)!.every(key=>rawValues.has(key))?undefined:Error('包内资源格式错误：'+file));
  script.onerror=()=>done(Error('包内资源读取失败：'+file));script.src='./'+file;
  try{document.head.appendChild(script);}catch(error){done(error instanceof Error?error:Error(String(error)));}
 };
 if(active<4)run();else queue.push(run);return task;
}
export function loadData(key:string):Promise<any>{
 const file=records[key]?.script;if(!file)return Promise.reject(Error('缺少包内资源：'+key));
 if(!pending.has(key)){
  const task=loadScript(file).then(()=>{if(!rawValues.has(key))throw Error('缺少包内数据：'+key);const data=revive(rawValues.get(key));rawValues.delete(key);return data;}).catch(error=>{pending.delete(key);throw error;});
  pending.set(key,task);
 }
 return pending.get(key)!;
}
export async function imagePath(key:string):Promise<string>{
 const entry=records[key];if(entry?.image)return './'+entry.image;
 if(entry?.script){const source=await loadData(key);if(typeof source==='string'&&source.indexOf('data:image/webp;base64,')===0)return source;}
 throw Error('缺少贴图：'+key);
}
export async function loadMap(){const map=await loadData('map');map.corners=await loadData('corners');map.placements=await loadData('placements');return map;}
export async function loadNavigation(){const g=await loadData('navigation'),b=new Uint8Array(16+g.cells.length),v=new DataView(b.buffer);b.set([77,80,51,87]);v.setUint32(4,0,true);v.setUint32(8,g.width,true);v.setUint32(12,g.height,true);b.set(g.cells,16);return b.buffer;}
export function pcmBuffer(ctx:AudioContext,data:{rate:number;blocks:Int16Array[]}){const size=data.blocks.reduce((n,b)=>n+b.length,0),buffer=ctx.createBuffer(1,size,data.rate),channel=buffer.getChannelData(0);let offset=0;for(const block of data.blocks)for(const value of block)channel[offset++]=value/32768;return buffer;}
