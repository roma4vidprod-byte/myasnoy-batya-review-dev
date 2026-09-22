import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MANIFEST=JSON.parse(readFileSync(join(ROOT,'tools/yandex-account-bootstrap/bootstrap-manifest.json'),'utf8'));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9][a-z0-9-]{2,62}$/;
const LOGIN=/^[A-Za-z0-9@._+\-]{3,254}$/;
const LABEL=/^[a-z0-9][a-z0-9._-]{2,63}$/;
const ORG=/^[0-9]{5,20}$/;
const sha=data=>createHash('sha256').update(data).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};

function containsForbiddenKey(value){
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value))return value.some(containsForbiddenKey);
  for(const [key,child] of Object.entries(value)){
    if(MANIFEST.forbidden_profile_keys.includes(key.toLowerCase()))return true;
    if(containsForbiddenKey(child))return true;
  }
  return false;
}
function validateProfile(profile){
  if(!profile||typeof profile!=='object'||Array.isArray(profile))fail('BOOTSTRAP_PROFILE_INVALID');
  if(containsForbiddenKey(profile))fail('BOOTSTRAP_PROFILE_CONTAINS_SECRET');
  const keys=Object.keys(profile).sort();
  const expected=[...MANIFEST.required_profile_keys].sort();
  if(keys.join()!==expected.join())fail('BOOTSTRAP_PROFILE_KEYS_INVALID');
  if(profile.schema_version!==1)fail('BOOTSTRAP_PROFILE_VERSION_INVALID');
  if(!SLUG.test(profile.customer_slug))fail('BOOTSTRAP_CUSTOMER_SLUG_INVALID');
  if(!LOGIN.test(profile.technical_yandex_login))fail('BOOTSTRAP_LOGIN_INVALID');
  if(profile.representative_access==='CONFIRMED'&&/^CHANGE[-_]?ME$/i.test(profile.technical_yandex_login))
    fail('BOOTSTRAP_LOGIN_PLACEHOLDER');
  if(!LABEL.test(profile.session_account_label))fail('BOOTSTRAP_ACCOUNT_LABEL_INVALID');
  if(!UUID.test(profile.company_id)||!UUID.test(profile.location_id))fail('BOOTSTRAP_SCOPE_UUID_INVALID');
  if(!ORG.test(profile.yandex_organization_id))fail('BOOTSTRAP_ORG_INVALID');
  if(profile.provider!=='yandex')fail('BOOTSTRAP_PROVIDER_INVALID');
  if(typeof profile.location_label!=='string'||profile.location_label.length<1||profile.location_label.length>160)
    fail('BOOTSTRAP_LOCATION_LABEL_INVALID');
  if(!['PENDING','CONFIRMED'].includes(profile.representative_access))
    fail('BOOTSTRAP_REPRESENTATIVE_ACCESS_INVALID');
  return Object.freeze({...profile});
}
function safeTarget(root,relative){
  if(typeof relative!=='string'||relative.startsWith('/')||relative.includes('..')||relative.includes('\\'))
    fail('BOOTSTRAP_PATH_INVALID');
  return join(root,...relative.split('/'));
}
function build(profilePath,outPath){
  const profile=validateProfile(JSON.parse(readFileSync(resolve(profilePath),'utf8')));
  const out=resolve(outPath);
  mkdirSync(dirname(out),{recursive:true});
  mkdirSync(out);
  const sourceRoot=join(out,'source');
  const overlayRoot=join(out,'overlay');
  const verificationRoot=join(out,'verification');
  const referenceRoot=join(out,'reference');
  const bootstrapRoot=join(out,'bootstrap');
  mkdirSync(sourceRoot);mkdirSync(overlayRoot);mkdirSync(verificationRoot);mkdirSync(referenceRoot);mkdirSync(bootstrapRoot);
  const fileEvidence=[];
  for(const relative of MANIFEST.canonical_runtime_files){
    const src=safeTarget(ROOT,relative);
    const bytes=readFileSync(src);
    const dst=safeTarget(sourceRoot,relative);
    mkdirSync(dirname(dst),{recursive:true});
    copyFileSync(src,dst);
    fileEvidence.push({path:relative,sha256:sha(bytes),bytes:bytes.length});
  }
  const bootstrapEvidence=[];
  for(const relative of MANIFEST.bootstrap_pack_files){
    const src=safeTarget(ROOT,relative),bytes=readFileSync(src);
    const dst=safeTarget(bootstrapRoot,relative);
    mkdirSync(dirname(dst),{recursive:true});copyFileSync(src,dst);
    bootstrapEvidence.push({path:relative,sha256:sha(bytes),bytes:bytes.length});
  }
  const verificationEvidence=[];
  for(const relative of MANIFEST.verification_files){
    const src=safeTarget(ROOT,relative),bytes=readFileSync(src);
    const dst=safeTarget(verificationRoot,relative);
    mkdirSync(dirname(dst),{recursive:true});copyFileSync(src,dst);
    verificationEvidence.push({path:relative,sha256:sha(bytes),bytes:bytes.length});
  }
  const referenceEvidence=[];
  for(const relative of MANIFEST.reference_docs){
    const src=safeTarget(ROOT,relative),bytes=readFileSync(src);
    const dst=safeTarget(referenceRoot,relative);
    mkdirSync(dirname(dst),{recursive:true});copyFileSync(src,dst);
    referenceEvidence.push({path:relative,sha256:sha(bytes),bytes:bytes.length});
  }
  const replacements=new Map([
    [MANIFEST.parameter_tokens.company_id,profile.company_id],
    [MANIFEST.parameter_tokens.location_id,profile.location_id],
    [MANIFEST.parameter_tokens.yandex_organization_id,profile.yandex_organization_id],
    [MANIFEST.parameter_tokens.session_account_label,profile.session_account_label]
  ]);
  const overlayEvidence=[];
  for(const relative of MANIFEST.parameterization_targets){
    const src=safeTarget(ROOT,relative);
    let text=readFileSync(src,'utf8');
    let touches=0;
    for(const [from,to] of replacements){
      if(from===to)continue;
      const count=text.split(from).length-1;
      if(count){text=text.split(from).join(to);touches+=count;}
    }
    const dst=safeTarget(overlayRoot,relative);
    mkdirSync(dirname(dst),{recursive:true});
    writeFileSync(dst,text,'utf8');
    overlayEvidence.push({
      path:relative,touches,sha256:sha(Buffer.from(text,'utf8')),
      source_sha256:sha(readFileSync(src))
    });
  }
  const sanitized={...profile};
  writeFileSync(join(out,'ACCOUNT_PROFILE.json'),JSON.stringify(sanitized,null,2)+'\n');
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  writeFileSync(join(out,'BOOTSTRAP_FILES.json'),JSON.stringify({
    schema_version:1,source_commit:sourceCommit,files:fileEvidence,
    bootstrap:bootstrapEvidence,overlays:overlayEvidence,
    verification:verificationEvidence,references:referenceEvidence
  },null,2)+'\n');
  const plan={
    schema_version:1,
    customer_slug:profile.customer_slug,
    technical_yandex_login:profile.technical_yandex_login,
    representative_access:profile.representative_access,
    write_enabled:false,
    next_action:profile.representative_access==='CONFIRMED'
      ?'READY_FOR_ONE_STAGE_ACCOUNT_PREPARATION'
      :'WAIT_FOR_REPRESENTATIVE_ACCESS_CONFIRMATION',
    gates:MANIFEST.one_stage_gates.map(name=>({
      name,
      status:name==='REPRESENTATIVE_ACCESS_CONFIRMED'
        ?(profile.representative_access==='CONFIRMED'?'READY':'BLOCKED')
        :'PENDING'
    })),
    prohibition:'NO_YANDEX_REPLY_WRITE_WITHOUT_SEPARATE_EXACT_APPROVAL'
  };
  writeFileSync(join(out,'BOOTSTRAP_PLAN.json'),JSON.stringify(plan,null,2)+'\n');
  return {ok:true,out,files:fileEvidence.length,bootstrap:bootstrapEvidence.length,
    overlays:overlayEvidence.length,verification:verificationEvidence.length,
    references:referenceEvidence.length,representative_access:profile.representative_access,
    next_action:plan.next_action};
}

try{
  if(process.argv.length!==4)fail('BOOTSTRAP_ARGUMENTS_INVALID');
  process.stdout.write(JSON.stringify(build(process.argv[2],process.argv[3]))+'\n');
}catch(error){
  process.stdout.write(JSON.stringify({ok:false,code:error?.code||'BOOTSTRAP_BUILD_FAILED'})+'\n');
  process.exitCode=1;
}
