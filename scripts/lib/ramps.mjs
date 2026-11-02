/** W3E ramp topology in native MDX coordinates: BL, TL, TR, BR.
 * Native cliff vertices occupy [-width, 0] × [0, height]. */
export function rampTopology(corners,width,height){
  const at=(x,y)=>corners[y*width+x],tile=(x,y)=>y*(width-1)+x;
  const entrances=[],raised=new Set(),candidates=[];
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const c=[at(x,y),at(x,y+1),at(x+1,y+1),at(x+1,y)];
    if(c.every(p=>p[7])&&!(c[0][4]===c[2][4]&&c[1][4]===c[3][4])){
      entrances.push(tile(x,y));const base=Math.min(...c.map(p=>p[4]));
      for(const [dx,dy]of [[0,0],[0,1],[1,1],[1,0]])if(at(x+dx,y+dy)[4]===base)raised.add((y+dy)*width+x+dx);
    }
    for(const [sx,sy]of [[1,2],[2,1]]){
      if(x+sx>=width||y+sy>=height)continue;
      const ends=[at(x,y),at(x,y+sy),at(x+sx,y+sy),at(x+sx,y)];
      const rows=sx===2?[[at(x,y),at(x+1,y),at(x+2,y)],[at(x,y+1),at(x+1,y+1),at(x+2,y+1)]]:
        [[at(x,y),at(x,y+1),at(x,y+2)],[at(x+1,y),at(x+1,y+1),at(x+1,y+2)]];
      if(rows[0][0][7]===rows[1][0][7]||!rows.every(r=>r.every(p=>p[7]===r[0][7])&&r[1][4]===Math.min(r[0][4],r[2][4])))continue;
      if(!rows.filter(r=>r[0][7]).every(r=>Math.abs(r[0][4]-r[2][4])===1))continue;
      const base=Math.min(...ends.map(p=>p[4])),max=Math.max(...ends.map(p=>p[4]));
      if(max-base!==1)continue;
      const shape=ends.map(p=>String.fromCharCode((p[7]?76:65)+(p[4]-base)*(p[7]?-4:1))).join('');
      candidates.push({x,y,sx,sy,base:(base-2)*128,type:at(x,y)[5]===15?1:at(x,y)[5],path:`doodads/terrain/clifftrans/clifftrans${shape.toLowerCase()}0.mdx`,cells:[tile(x,y),tile(x+sx-1,y+sy-1)]});
    }
  }
  return{entrances,raised:[...raised],candidates};
}
