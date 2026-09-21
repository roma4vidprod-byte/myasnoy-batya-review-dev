// Verify a bounded immutable stage-5 package, never credentials or database rows.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
try{
  if(process.argv.length!==3)throw Error();
  const root=realpathSync(process.argv[2]);
  const m=JSON.parse(readFileSync(resolve(root,'MANIFEST.json'),'utf8'));
  if(m.stage!==6.5||m.writeEnabled!==false||!/^[a-f0-9]{40}$/.test(m.sourceSha)||
    !m.files||Object.keys(m.files).length<10||Object.keys(m.files).length>30)throw Error();
  for(const [name,hash] of Object.entries(m.files)){
    if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.startsWith('/')||name.split('/').includes('..'))throw Error();
    const path=resolve(root,name),st=lstatSync(path);
    if(!st.isFile()||st.isSymbolicLink()||st.size>500000||!path.startsWith(root+sep))throw Error();
    if(createHash('sha256').update(readFileSync(path)).digest('hex')!==hash)throw Error();
  }
  console.log(JSON.stringify({ok:true,status:'MANIFEST_PASS',sourceSha:m.sourceSha,
    fileCount:Object.keys(m.files).length,writeEnabled:false}));
}catch{
  console.log(JSON.stringify({ok:false,status:'MANIFEST_FAILED'}));process.exitCode=1;
}
