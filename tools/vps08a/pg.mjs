// Private Unix-peer adapter to the EXISTING storage/CAS contract. Only encrypted
// envelopes cross stdin to psql; no SQL or subprocess errors are printed.
import {spawn} from 'node:child_process';
import {userInfo} from 'node:os';
import {VPS_SESSION_SCOPE} from '../../lib/server/yandex-session/profile-context.js';
import {fail} from '../../lib/server/yandex-session/crypto.js';

export function createVpsRpc() {
  const role=userInfo().username;
  if(process.platform!=='linux'||!['review-yandex-reader','review-yandex-import'].includes(role))fail('SESSION_ROLE_DENIED');
  return async function rpc(name,args) {
    if(name!=='review_yandex_session_store'||args.p_company_id!==VPS_SESSION_SCOPE.companyId||
      args.p_location_id!==VPS_SESSION_SCOPE.locationId||args.p_org_id!==VPS_SESSION_SCOPE.organizationId||
      !['status','read','replace','transition'].includes(args.p_action))fail('SESSION_SCOPE_INVALID');
    const revision=args.p_expected_revision;
    if(revision!==null&&(!Number.isSafeInteger(revision)||revision<0))fail('SESSION_REVISION_REQUIRED');
    const data=JSON.stringify(args.p_data);
    if(!data||Buffer.byteLength(data)>100000)fail('SESSION_INPUT_INVALID');
    const quoted="'"+data.replaceAll("'","''")+"'::jsonb";
    const sql=`select vps_yandex_private.session_call('${args.p_company_id}'::uuid,'${args.p_location_id}'::uuid,'${args.p_org_id}','${args.p_action}',${revision??'null'},${quoted});\n`;
    return new Promise((resolve,reject)=>{
      const child=spawn('/usr/lib/postgresql/17/bin/psql',['-XqAtw','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-U',role,'-d','review_activator_lab'],
        {env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',PGCLIENTENCODING:'UTF8',PGAPPNAME:'vps08a-session',PGCONNECT_TIMEOUT:'3',PGOPTIONS:'-c statement_timeout=10000 -c lock_timeout=3000 -c standard_conforming_strings=on'},stdio:['pipe','pipe','pipe']});
      let output='',errors='',oversize=false;
      const timer=setTimeout(()=>{oversize=true;child.kill('SIGKILL');},15000);
      const stop=()=>{clearTimeout(timer);reject(Object.assign(new Error('SESSION_STORAGE_FAILED'),{code:'SESSION_STORAGE_FAILED'}));};
      child.on('error',stop);child.stdin.on('error',()=>{});
      child.stdout.on('data',b=>{output+=b.toString('utf8');if(output.length>130000){oversize=true;child.kill('SIGKILL');}});
      child.stderr.on('data',b=>{if(errors.length<4096)errors+=b.toString('utf8');});
      child.on('close',code=>{
        clearTimeout(timer);
        if(code!==0||oversize){
          const safe=['SESSION_CHANGED','SESSION_SCOPE_INVALID','SESSION_ROLE_DENIED','SESSION_TRANSITION_INVALID'].find(c=>errors.includes('ERROR:  '+c))??'SESSION_STORAGE_FAILED';
          errors='';output='';reject(Object.assign(new Error(safe),{code:safe}));return;
        }
        try{const value=output.trim()?JSON.parse(output):null;output='';resolve(value);}catch{stop();}
      });
      child.stdin.end(sql);
    });
  };
}
