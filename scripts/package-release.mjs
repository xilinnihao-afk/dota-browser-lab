#!/usr/bin/env node
// Package only the built public site. No shell, SSH, credential access or deployment.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const args=process.argv.slice(2);
let release,output=path.join(root,'.local/releases');
for(let i=0;i<args.length;i++){
  if(args[i]==='--release'){release=args[++i];if(!release||release.startsWith('--'))throw new Error('--release requires a value.');}
  else if(args[i]==='--out'){const value=args[++i];if(!value||value.startsWith('--'))throw new Error('--out requires a directory.');output=path.resolve(value);}
  else if(args[i]==='--help'){console.log('node scripts/package-release.mjs [--release v2d-20261023] [--out .local/releases]');process.exit(0);}
  else throw new Error('Unknown argument: '+args[i]);
}
if(release!==undefined&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(release))throw new Error('Release must be 1–80 ASCII letters, numbers, dots, hyphens or underscores; begin with a letter or number.');
if(output===dist||output.startsWith(dist+path.sep))throw new Error('Release output must be outside dist.');
const sha=data=>createHash('sha256').update(data).digest('hex');
const files=[],excluded=[];
const allowed=new Set(['.html','.js','.css','.json','.png','.jpg','.jpeg','.webp','.svg','.ico','.mdx','.blp','.tga','.wpm','.shd','.wav','.mp3','.ogg','.woff','.woff2']);
const distStat=await fs.lstat(dist);
if(!distStat.isDirectory()||distStat.isSymbolicLink())throw new Error('dist must be a real build directory, not a symbolic link.');
async function collect(directory,prefix=''){
  for(const item of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const relative=prefix+item.name,absolute=path.join(directory,item.name);
    if(item.isSymbolicLink())throw new Error('Symlinks are not permitted in dist: '+relative);
    if(/[\r\n\\]/.test(relative)||relative.split('/').some(p=>p.startsWith('.'))||/(^|\/)(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/i.test(relative)||/\.(?:pem|key|p12|pfx)$/i.test(relative))throw new Error('Non-public or unsafe file in dist: '+relative);
    if(item.isDirectory()){await collect(absolute,relative+'/');continue;}
    if(!item.isFile())throw new Error('Unsupported file type in dist: '+relative);
    const data=await fs.readFile(absolute),extension=path.extname(relative).toLowerCase();
    // These are importer inputs/reference tables, never browser runtime requests.
    if(['.mpq','.w3x','.w3m','.slk','.txt','.md','.map'].includes(extension)){
      excluded.push({path:relative,bytes:data.length,reason:'archive, offline reference table, documentation or source map'});continue;
    }
    if(!allowed.has(extension))throw new Error('Unreviewed public extension: '+relative);
    if(['.html','.js','.css','.json'].includes(extension)&&/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|LTAI[A-Za-z0-9]{12,}/.test(data.toString('utf8')))throw new Error('Possible embedded credential; inspect this file before publishing: '+relative);
    files.push({path:'site/'+relative,bytes:data.length,sha256:sha(data),data});
  }
}
await collect(dist);
if(!files.some(f=>f.path==='site/index.html')||!files.some(f=>f.path==='site/assets/imba/map.json'))throw new Error('Missing built index.html or imported map.json; build and prepare resources first.');
const contentSha256=sha(files.map(({path,bytes,sha256})=>`${path}\0${bytes}\0${sha256}\n`).join(''));
release??='dota-'+contentSha256.slice(0,12);
const manifest={format:1,release,contentSha256,files:files.map(({path,bytes,sha256})=>({path,bytes,sha256})),totalBytes:files.reduce((n,f)=>n+f.bytes,0),excluded};
const manifestData=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
const sums=Buffer.from([...files.map(f=>`${f.sha256}  ${f.path}`),`${sha(manifestData)}  manifest.json`].join('\n')+'\n');

// Deterministic POSIX ustar: sorted names, fixed uid/gid/mode and epoch mtime.
function tarHeader(name,size,directory=false){
  const header=Buffer.alloc(512);let prefix='';
  if(Buffer.byteLength(name)>100){const splits=[...name.matchAll(/\//g)].map(x=>x.index).reverse();const split=splits.find(i=>Buffer.byteLength(name.slice(0,i))<=155&&Buffer.byteLength(name.slice(i+1))<=100);if(split===undefined)throw new Error('Path too long for ustar: '+name);prefix=name.slice(0,split);name=name.slice(split+1);}
  const write=(text,offset,length)=>{if(Buffer.byteLength(text)>length)throw new Error('Tar field overflow');header.write(text,offset,length,'utf8');};
  const octal=(number,length)=>number.toString(8).padStart(length-1,'0')+'\0';
  write(name,0,100);write(octal(directory?0o755:0o644,8),100,8);write(octal(0,8),108,8);write(octal(0,8),116,8);write(octal(size,12),124,12);write(octal(0,12),136,12);
  header.fill(32,148,156);write(directory?'5':'0',156,1);write('ustar\0',257,6);write('00',263,2);write(prefix,345,155);
  write([...header].reduce((sum,value)=>sum+value,0).toString(8).padStart(6,'0')+'\0 ',148,8);return header;
}
const chunks=[],directories=new Set();
for(const file of files){const parts=file.path.split('/');for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/')+'/');}
for(const directory of [...directories].sort())chunks.push(tarHeader(directory,0,true));
for(const file of [...files,{path:'manifest.json',data:manifestData},{path:'SHA256SUMS',data:sums}]){chunks.push(tarHeader(file.path,file.data.length),file.data);if(file.data.length%512)chunks.push(Buffer.alloc(512-file.data.length%512));}
chunks.push(Buffer.alloc(1024));
const archive=gzipSync(Buffer.concat(chunks),{level:9});archive[9]=255; // Fixed OS byte; gzip timestamp is zero in Node.
const archiveName=release+'.tar.gz',archiveSha256=sha(archive);
await fs.mkdir(output,{recursive:true});
async function writeOnce(name,data){const destination=path.join(output,name);try{await fs.writeFile(destination,data,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(!Buffer.from(await fs.readFile(destination)).equals(Buffer.from(data)))throw new Error('Refusing to replace a different existing release file: '+destination);}}
await writeOnce(archiveName,archive);await writeOnce(archiveName+'.sha256',`${archiveSha256}  ${archiveName}\n`);await writeOnce(release+'.manifest.json',manifestData);
console.log(JSON.stringify({release,archive:path.join(output,archiveName),sha256:archiveSha256,archiveBytes:archive.length,publicFiles:files.length,publicBytes:manifest.totalBytes,excludedFiles:excluded.length,excludedBytes:excluded.reduce((n,f)=>n+f.bytes,0),contentSha256},null,2));
