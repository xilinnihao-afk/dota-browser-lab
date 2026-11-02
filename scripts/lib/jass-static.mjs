// Read only the unconditional, literal part of main. This is NOT a JASS VM.
// No eval, triggers, timers, user functions, random spawns or branches execute.
export function staticUnits(script) {
  const text=script.replace(/\r\n?/g,'\n');
  const match=/^function main takes nothing returns nothing\n([\s\S]*?)^endfunction/m.exec(text);
  if(!match) throw new Error('No main initialization function');
  const values=new Map([['bj_UNIT_FACING',270]]), units=[], unresolved=[];
  let nesting=0, line=text.slice(0,match.index).split('\n').length;
  function value(s) {
    if(/^[-+]?\d*\.?\d+$/.test(s))return Number(s);
    if(/^'.{4}'$/.test(s))return s.slice(1,-1);
    const arithmetic=/^([\w\[\]]+)([+-])([\d.]+)$/.exec(s);
    if(arithmetic){const base=value(arithmetic[1]);if(Number.isFinite(base))return base+(arithmetic[2]==='+'?1:-1)*Number(arithmetic[3]);}
    let m=/^Player\((\d+)\)$/.exec(s);if(m)return {player:Number(m[1])};
    m=/^ConvertPlayerColor\((\d+)\)$/.exec(s);if(m)return Number(m[1]);
    m=/^GetUnit([XY])\(([^)]+)\)$/.exec(s);if(m)return values.get(m[2])?.position?.[m[1]==='X'?0:1];
    m=/^Rect\(([-.\d]+),([-.\d]+),([-.\d]+),([-.\d]+)\)$/.exec(s);if(m)return {rect:m.slice(1).map(Number)};
    m=/^GetRectCenter([XY])\(([^)]+)\)$/.exec(s);if(m){const r=values.get(m[2])?.rect;if(r)return (r[m[1]==='X'?0:1]+r[m[1]==='X'?2:3])/2;}
    return values.get(s);
  }
  for(const raw of match[1].split('\n')){
    line++;const s=raw.trim();
    if(/^(endif|endloop)\b/.test(s)){nesting--;continue;}
    if(/^(if\b|loop$)/.test(s)){nesting++;continue;}
    if(nesting>0){if(s.includes('CreateUnit('))unresolved.push({line,reason:'conditional-or-loop',statement:s});continue;}
    const assignment=/^set ([\w\[\]]+)=(.*)$/.exec(s);
    if(assignment){
      const [,key,rhs]=assignment;
      const create=/^CreateUnit\((Player\(\d+\)|[\w\[\]]+),([^,]+),([^,]+),([^,]+),([^,]+)\)$/.exec(rhs);
      if(create){
        const owner=value(create[1]), id=value(create[2]),x=value(create[3]),y=value(create[4]),angle=value(create[5]);
        if(owner?.player!==undefined&&id!==undefined&&[x,y,angle].every(Number.isFinite)){
          const b=Buffer.alloc(4);if(typeof id==='number')b.writeUInt32BE(id>>>0);
          const unit={id:typeof id==='string'?id:b.toString('latin1'),position:[x,y,0],angle:angle*Math.PI/180,team:owner.player,scale:[1,1,1],color:[1,1,1],sourceLine:line,variable:key,removed:false};
          units.push(unit);values.set(key,unit);
        }else{values.delete(key);unresolved.push({line,reason:'dynamic-argument',statement:s});}
      }else{const v=value(rhs);if(v!==undefined)values.set(key,v);else values.delete(key);}
    }
    let m=/^call RemoveUnit\(([^)]+)\)$/.exec(s);if(m&&values.get(m[1])?.id)values.get(m[1]).removed=true;
    m=/^call SetUnitColor\(([^,]+),(.+)\)$/.exec(s);if(m&&values.get(m[1])?.id&&Number.isFinite(value(m[2])))values.get(m[1]).team=value(m[2]);
    m=/^call SetUnitScale\(([^,]+),([-.\d]+),([-.\d]+),([-.\d]+)\)$/.exec(s);if(m&&values.get(m[1])?.id)values.get(m[1]).scale=m.slice(2).map(Number);
    m=/^call SetUnitVertexColor\(([^,]+),(\d+),(\d+),(\d+),(\d+)\)$/.exec(s);if(m&&values.get(m[1])?.id)values.get(m[1]).color=m.slice(2,5).map(x=>Number(x)/255);
    m=/^call ShowUnit\(([^,]+),false\)$/.exec(s);if(m&&values.get(m[1])?.id)values.get(m[1]).removed=true;
  }
  return {units:units.filter(u=>!u.removed),created:units.length,removed:units.filter(u=>u.removed).length,unresolved};
}
