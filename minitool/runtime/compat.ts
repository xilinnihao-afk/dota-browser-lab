// Small fallbacks for APIs actually used by this game. Syntax is compiled.
if(typeof globalThis==='undefined')(window as any).globalThis=window;
if(!Object.hasOwn)Object.hasOwn=(o:object,k:PropertyKey)=>Object.prototype.hasOwnProperty.call(o,k);
if(!Object.fromEntries)Object.fromEntries=function(entries:any){const o:any={};for(const [k,v]of entries)o[k]=v;return o;};
if(!Array.prototype.flatMap)Object.defineProperty(Array.prototype,'flatMap',{configurable:true,writable:true,value:function(fn:any,self:any){const out:any[]=[];this.forEach((v:any,i:number)=>{const a=fn.call(self,v,i,this);if(Array.isArray(a))a.forEach(v=>out.push(v));else out.push(a);});return out;}});
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{configurable:true,writable:true,value:function(n:number){n=Math.trunc(Number(n)||0);return this[n<0?this.length+n:n];}});
if(!String.prototype.replaceAll)Object.defineProperty(String.prototype,'replaceAll',{configurable:true,writable:true,value:function(a:string,b:string){return String(this).split(a).join(b);}});
