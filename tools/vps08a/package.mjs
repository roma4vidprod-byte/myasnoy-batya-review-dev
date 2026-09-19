// Source-only packaging. Never traverses env, keys, browser state or node_modules.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=resolve(process.argv[2]);
if(!out.includes('Review-Activator-Tools')||!out.endsWith('vps08a-continuation-20260919'))throw Error('OUTPUT_DENIED');
const files=new Map(),hash=b=>createHash('sha256').update(b).digest('hex');
function visit(path){
  const full=resolve(root,path),rel=relative(root,full).replaceAll('\\','/');
  if(rel.startsWith('../')||!rel.match(/^(lib|api|tools\/vps08a)\/.*\.(js|mjs)$/))throw Error('SOURCE_DENIED');
  if(files.has(rel))return;
  const data=readFileSync(full);files.set(rel,{data,runtime:true});
  for(const match of data.toString().matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g))if(match[1].startsWith('.'))visit(relative(root,resolve(dirname(full),match[1])));
}
visit('tools/vps08a/session.mjs');
files.set('package.json',{data:Buffer.from('{"type":"module"}\n'),runtime:true});
for(const path of ['tools/vps08a/install.py','tools/vps08a/session-access.sql','tools/vps08a/native-session.py','tools/vps08a/deployed-smoke.mjs','tools/vps08a/test_backup_scope.py','tools/vps05/ops.py','tools/vps05/test_ops.py','tools/vps05/review-activator-backup.service','tools/vps05/review-activator-monitor.service','supabase/migrations/20260912103803_yandex_session_transport_v1.sql'])files.set(path,{data:readFileSync(path),runtime:false});
mkdirSync(out,{recursive:true});
const manifest={base_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),previous_ops_sha256:hash(execFileSync('git',['show','HEAD:tools/vps05/ops.py'])),files:[]};
for(const [path,{data,runtime}]of files){const dest=resolve(out,'source',path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,data,{flag:'wx'});manifest.files.push({path,sha256:hash(data),runtime});}
writeFileSync(resolve(out,'source/VPS08A_INSTALL_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runtime_files:manifest.files.filter(e=>e.runtime).length,files:manifest.files.length,base_sha:manifest.base_sha}));
