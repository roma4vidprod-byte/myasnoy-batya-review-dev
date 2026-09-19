import {ROOT,ETC,run,secretFile,sha} from './bootstrap.mjs';
import {readFileSync,writeFileSync,mkdirSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
const src=resolve(process.argv[2]||'');
const files=['lib/server/runtime-profile.js','lib/server/vps/http-adapter.js','lib/server/vps/foundation.js',
 'lib/server/vps/foundation-config.js','lib/server/vps/lab-config.js','lib/server/vps/lab.js',
 'scripts/start-vps-lab.mjs','scripts/verify-vps-lab.mjs','admin.html'];
let stage='GUARD';
try{
  if(process.getuid()!==0||run('hostname',[]).trim()!=='hiplet-120706')throw new Error();
  for(const name of ['AUTH_TESTS','API_TESTS','RLS_HTTP']){
    const report=JSON.parse(readFileSync(ROOT+'/VPS04_'+name+'.json','utf8'));
    if(report.fail!==0||report.pass<7)throw new Error('OFFICIAL_BOUNDARY_GATE_REQUIRED');
  }
  stage='RELEASE';
  const release=ROOT+'/releases/vps04-initial';mkdirSync(release,{recursive:true,mode:0o755});
  const entries=[];
  for(const path of files){
    if(lstatSync(join(src,path)).isSymbolicLink())throw new Error();
    const data=readFileSync(join(src,path));mkdirSync(dirname(join(release,path)),{recursive:true,mode:0o755});
    writeFileSync(join(release,path),data,{flag:'wx',mode:0o644});entries.push({path,sha256:sha(data)});
  }
  const pkg=Buffer.from('{"private":true,"type":"module"}\n');
  writeFileSync(release+'/package.json',pkg,{flag:'wx',mode:0o644});entries.push({path:'package.json',sha256:sha(pkg)});
  writeFileSync(release+'/VPS04_RELEASE.json',JSON.stringify({profile:'vps-lab',files:entries},null,2)+'\n',{flag:'wx',mode:0o644});
  run('/opt/node/bin/node',[release+'/scripts/verify-vps-lab.mjs']);
  const state=JSON.parse(readFileSync(ETC+'/bootstrap.json','utf8'));
  stage='PUBLIC_ONLY_NODE_ENV';
  secretFile('node.env',Object.entries({RA_RUNTIME_PROFILE:'vps-lab',RA_VPS_PROFILE:'vps-lab',RA_LAB_ORIGIN:'http://127.0.0.1:13000',
    RA_LAB_ISSUER:'http://127.0.0.1:13000/auth/v1',RA_LAB_ANON_TOKEN:state.anon,RA_LAB_PUBLIC_JWK:JSON.stringify(state.pub)
  }).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n');
  stage='EXISTING_FOUNDATION_SERVICE';
  const drop='/etc/systemd/system/review-activator-foundation.service.d';mkdirSync(drop,{mode:0o755});
  writeFileSync(drop+'/vps04.conf',`[Unit]\nAfter=review-lab-auth.service review-lab-api.service\n[Service]\nWorkingDirectory=${release}\nEnvironmentFile=${ETC}/node.env\nExecStartPre=\nExecStartPre=/opt/node/bin/node ${release}/scripts/verify-vps-lab.mjs\nExecStart=\nExecStart=/opt/node/bin/node ${release}/scripts/start-vps-lab.mjs\n`,{flag:'wx',mode:0o644});
  run('systemctl',['daemon-reload']);run('systemctl',['restart','review-activator-foundation']);
  console.log(JSON.stringify({node_install:'PASS',release,source_files:entries.length,signing_key_in_node:false}));
}catch{console.log(JSON.stringify({ok:false,stage,error:'LAB_NODE_INSTALL_STOPPED'}));process.exitCode=1;}
