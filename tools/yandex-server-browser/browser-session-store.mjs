import {spawn} from 'node:child_process';
import {userInfo} from 'node:os';

const SAFE_DB_ERRORS=new Set(['BROWSER_ROLE_DENIED','SESSION_NOT_READY']);
function fail(code){throw Object.assign(new Error(code),{code});}

function runPsql(sql,{maxBytes=140000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/lib/postgresql/17/bin/psql',[
      '-XqAtw','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql',
      '-U','review-yandex-browser','-d','review_activator_lab'
    ],{
      env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',PGCLIENTENCODING:'UTF8',
        PGAPPNAME:'stage13-yandex-browser',PGCONNECT_TIMEOUT:'3',
        PGOPTIONS:'-c statement_timeout=8000 -c lock_timeout=3000'},
      stdio:['pipe','pipe','pipe']
    });
    let output='',errors='',closed=false;
    const done=(error,value)=>{
      if(closed)return;closed=true;clearTimeout(timer);output='';errors='';
      error?reject(Object.assign(new Error(error),{code:error})):resolve(value);
    };
    const timer=setTimeout(()=>{child.kill('SIGKILL');done('BROWSER_SESSION_READ_FAILED');},12000);
    child.on('error',()=>done('BROWSER_SESSION_READ_FAILED'));
    child.stdout.on('data',buffer=>{
      output+=buffer.toString('utf8');
      if(Buffer.byteLength(output,'utf8')>maxBytes){child.kill('SIGKILL');done('BROWSER_SESSION_READ_FAILED');}
    });
    child.stderr.on('data',buffer=>{if(errors.length<4096)errors+=buffer.toString('utf8');});
    child.on('close',code=>{
      if(closed)return;
      if(code!==0){
        const safe=[...SAFE_DB_ERRORS].find(value=>errors.includes('ERROR:  '+value));
        return done(safe||'BROWSER_SESSION_READ_FAILED');
      }
      try{
        const text=output.trim();
        const value=text?JSON.parse(text):null;
        if(!value||typeof value!=='object'||Array.isArray(value))return done('BROWSER_SESSION_READ_FAILED');
        return done(null,value);
      }catch{return done('BROWSER_SESSION_READ_FAILED');}
    });
    child.stdin.end(sql);
  });
}

export function createBrowserSessionStore(){
  if(process.platform!=='linux'||userInfo().username!=='review-yandex-browser')
    fail('BROWSER_ROLE_DENIED');
  return Object.freeze({
    async readSession(){
      const value=await runPsql('select vps_yandex_private.browser_session_read();\n');
      if(value.state!=='READY'||!Number.isSafeInteger(Number(value.revision))||Number(value.revision)<1||
         typeof value.credential_version!=='string'||!value.envelope||typeof value.envelope!=='object'||Array.isArray(value.envelope))
        fail('SESSION_NOT_READY');
      return value;
    }
  });
}
