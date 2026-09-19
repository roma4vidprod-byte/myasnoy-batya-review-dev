// Source-only stage, no env/credential discovery. Does not deploy or run providers.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out=resolve(process.argv[2]);
if(!out.includes('Review-Activator-Tools')||! /vps08[bcd]-diagnostic-20260919$/.test(out))throw Error('OUTPUT_DENIED');
const phase=out.endsWith('vps08d-diagnostic-20260919')?'VPS08D':out.endsWith('vps08c-diagnostic-20260919')?'VPS08C':'VPS08B';
const root=process.cwd(),hash=b=>createHash('sha256').update(b).digest('hex');
const names=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/))];
const files=names.filter(p=>/^(lib\/|api\/|scripts\/|test\/|tools\/vps08a\/(session.mjs|session-access.sql)$|tools\/vps06\/worker.mjs$|tools\/vps08[bcd]\/apply-runtime.py$)/.test(p)&&/\.(mjs|js|json|ps1|py|sql)$/.test(p));
const manifest={base_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:[]};
for(const path of [...files,'package.json']){
  const data=path==='package.json'?Buffer.from('{"type":"module"}\n'):readFileSync(resolve(root,path));
  const target=resolve(out,'source',path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});
  manifest.files.push({path,sha256:hash(data)});
}
writeFileSync(resolve(out,'source/'+phase+'_SOURCE.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const preserved=JSON.parse(readFileSync('C:/Users/tasfo/BusinessOS/Review-Activator-Tools/reports/vps06-20260919/untracked-before.json'));
if(!preserved.every(e=>hash(readFileSync(resolve(root,e.path)))===e.sha256))throw Error('USER_FILE_CHANGED');
console.log(JSON.stringify({source_files:manifest.files.length,base_sha:manifest.base_sha,user_files_preserved:preserved.length}));
