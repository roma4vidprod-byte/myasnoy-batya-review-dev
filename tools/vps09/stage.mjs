// Source-only package; no credentials, real sessions or provider data.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=process.cwd(),out=resolve(process.argv[2]),hash=b=>createHash('sha256').update(b).digest('hex');
if(!/vps09-20260919(?:-v[23])?$/.test(out)||!out.includes('Review-Activator-Tools'))throw Error('OUTPUT_DENIED');
const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/);
const files=[...new Set(names)].filter(p=>/^(lib|api|test|scripts|tools\/vps05|tools\/vps06|tools\/vps08a|tools\/vps09|supabase\/migrations)\//.test(p)&&/\.(js|mjs|json|sql|py|ps1|service|timer)$/.test(p));
const manifest={source_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:[]};
for(const p of [...files,'package.json']){const data=p==='package.json'?Buffer.from('{"type":"module"}\n'):readFileSync(p);const dest=resolve(out,'source',p);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,data,{flag:'wx'});manifest.files.push({path:p,sha256:hash(data)});}
writeFileSync(resolve(out,'source/VPS09_SOURCE.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({files:manifest.files.length,source_sha:manifest.source_sha}));
