import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

const dir=process.argv[2]||'artifacts/pass-1';
const filename=path.join(dir,'desktop-1440-initial.png');
const png=PNG.sync.read(fs.readFileSync(filename));
const histogram=new Map();let count=0,sum=0,squares=0,edges=0,pairs=0;
const luminance=(x,y)=>{const i=(y*png.width+x)*4;return png.data[i]*.2126+png.data[i+1]*.7152+png.data[i+2]*.0722;};
for(let y=140;y<png.height-245;y+=2)for(let x=30;x<png.width-30;x+=2){
  const i=(y*png.width+x)*4,key=`${png.data[i]>>4},${png.data[i+1]>>4},${png.data[i+2]>>4}`;
  histogram.set(key,(histogram.get(key)||0)+1);const l=luminance(x,y);sum+=l;squares+=l*l;count++;
  if(Math.abs(l-luminance(x+1,y))>14)edges++;pairs++;
}
let entropy=0;for(const n of histogram.values()){const p=n/count;entropy-=p*Math.log2(p);}
const result={source:filename,viewport:{width:png.width,height:png.height},region:'world crop, excluding main HUD',pixels:count,quantizedColors:histogram.size,colorEntropy:entropy,dominantColorShare:Math.max(...histogram.values())/count,luminanceMean:sum/count,luminanceStdDev:Math.sqrt(squares/count-(sum/count)**2),edgeDensity:edges/pairs,blank:histogram.size<8};
fs.writeFileSync(path.join(dir,'pixel-analysis.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));

const frames=[['movement-1.png',[540,420,750,610]],['movement-2.png',[570,390,780,580]],['attack-0.png',[650,350,770,470]],['attack-1.png',[650,350,770,470]],['attack-5.png',[650,350,770,470]],['attack-6.png',[650,350,770,470]]];
const sheet=new PNG({width:1200,height:340});sheet.data.fill(255);
for(let n=0;n<frames.length;n++){
  const [file,box]=frames[n],frame=PNG.sync.read(fs.readFileSync(path.join(dir,file)));
  const [left,top,right,bottom]=box;
  for(let y=0;y<320;y++)for(let x=0;x<190;x++){
    const sx=Math.floor(left+x/190*(right-left)),sy=Math.floor(top+y/320*(bottom-top)),si=(sy*frame.width+sx)*4,di=((y+10)*sheet.width+n*200+x+5)*4;
    frame.data.copy(sheet.data,di,si,si+4);
  }
}
fs.writeFileSync(path.join(dir,'motion-contact-sheet.png'),PNG.sync.write(sheet));
