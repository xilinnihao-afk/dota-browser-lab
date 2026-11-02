import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {parseMDX,decodeBLP,getBLPImageData} from 'war3-model';

const project=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('./classic-assets.json',import.meta.url),'utf8'));
const destination=resolve(project,'public/assets/original');
const args=process.argv.slice(2),fromIndex=args.indexOf('--from');
const source=fromIndex>=0?args[fromIndex+1]:undefined,reference=args.includes('--reference');
if((fromIndex>=0&&!source)||(reference&&source)||args.some((arg,i)=>!['--check','--from','--reference'].includes(arg)&&!(fromIndex>=0&&i===fromIndex+1))){
  throw new Error('Usage: npm run assets:prepare -- --from /path/to/extracted-resources | --reference | --check');
}
const localFiles=new Map();
if(source){
  const sourceRoot=resolve(source);
  async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isDirectory())await scan(path);else if(entry.isFile()&&/\.(mdx|blp)$/i.test(entry.name))localFiles.set(relative(sourceRoot,path).replaceAll('\\','/').toLowerCase(),path);}}
  await scan(sourceRoot);
}
const actual=[];
for(const file of manifest.files){
  const target=resolve(destination,file.path);
  if(!target.startsWith(destination+'/'))throw new Error(`Invalid asset path: ${file.path}`);
  if(source||reference)await mkdir(dirname(target),{recursive:true});
  if(source){const path=localFiles.get(file.path);if(!path)throw new Error(`Missing extracted resource: ${file.path}`);if(path!==target)await copyFile(path,target);}
  if(reference){
    let bytes;
    for(let attempt=0;attempt<3;attempt++){
      try{const response=await fetch(file.sourceUrl,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());break;}
      catch(error){if(attempt===2)throw new Error(`Download failed: ${file.path}: ${error.message}`);}
    }
    if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error(`Reference resource changed: ${file.path}; inspect its provenance before updating the manifest`);
    await writeFile(target,bytes);
  }
  let bytes;
  try{bytes=await readFile(target);}catch{throw new Error(`Missing ${file.path}. Run assets:prepare with --from or --reference; see README.`);}
  const signature=bytes.toString('ascii',0,4),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  if(file.path.endsWith('.mdx')){
    if(signature!=='MDLX')throw new Error(`Invalid MDX: ${file.path}`);
    const model=parseMDX(buffer);if(model.Version!==800)throw new Error(`Only classic MDX 800 is supported: ${file.path}`);
    const ids=new Set(model.Nodes.map(node=>node.ObjectId));
    for(const geoset of model.Geosets){
      if(geoset.Normals.length!==geoset.Vertices.length||geoset.VertexGroup.length!==geoset.Vertices.length/3)throw new Error(`Invalid vertex data: ${file.path}`);
      if(geoset.Faces.some(index=>index>=geoset.Vertices.length/3))throw new Error(`Invalid face index: ${file.path}`);
      if(geoset.Groups.some(group=>group.some(id=>!ids.has(id))))throw new Error(`Missing skin matrix: ${file.path}`);
    }
    for(const texture of model.Textures){
      if(texture.Image&&!manifest.files.some(f=>f.path===texture.Image.replaceAll('\\','/').toLowerCase()))throw new Error(`Unmapped texture ${texture.Image} in ${file.path}`);
      if(!texture.Image&&![1,2,31].includes(texture.ReplaceableId))throw new Error(`Unmapped replaceable texture ${texture.ReplaceableId} in ${file.path}`);
    }
  }else{
    if(signature!=='BLP1')throw new Error(`Invalid classic BLP1: ${file.path}`);
    const blp=decodeBLP(buffer);if(blp.width>8192||blp.height>8192)throw new Error(`Unexpected texture size: ${file.path}`);
    const image=getBLPImageData(blp,0);if(image.data.length!==image.width*image.height*4)throw new Error(`Incomplete texture decode: ${file.path}`);
  }
  actual.push({path:file.path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
if(source||reference)await writeFile(resolve(destination,'provenance.local.json'),JSON.stringify({preparedAt:new Date().toISOString(),source:source?resolve(source):manifest.origin,gamePatch:null,files:actual},null,2)+'\n');
const matched=actual.filter(file=>manifest.files.find(reference=>reference.path===file.path)?.sha256===file.sha256).length;
console.log(`Verified ${actual.length} original resource files (${(actual.reduce((n,f)=>n+f.bytes,0)/1024/1024).toFixed(2)} MiB); ${matched}/${actual.length} match the recorded reference hashes.`);
console.log('This validates resource integrity and dependencies, not DotA map fidelity or redistribution rights.');
