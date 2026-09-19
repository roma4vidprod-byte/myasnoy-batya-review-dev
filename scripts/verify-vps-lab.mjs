import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
try {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const manifest=JSON.parse(readFileSync(join(root,'VPS04_RELEASE.json'),'utf8'));
  if(manifest.profile!=='vps-lab'||!Array.isArray(manifest.files)||manifest.files.length!==10)throw new Error();
  for(const entry of manifest.files){
    if(!/^[a-zA-Z0-9_./-]+$/.test(entry.path)||entry.path.startsWith('/')||entry.path.split('/').some(p=>p==='..'||p===''))throw new Error();
    let path=root;for(const piece of entry.path.split('/')){path=join(path,piece);if(lstatSync(path).isSymbolicLink())throw new Error();}
    if(createHash('sha256').update(readFileSync(path)).digest('hex')!==entry.sha256)throw new Error();
  }
}catch{process.stderr.write('LAB_RELEASE_VERIFICATION_FAILED\n');process.exitCode=1;}
