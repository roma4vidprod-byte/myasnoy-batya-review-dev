// Explicit profile selection. Cloud behavior is the default only when unset.
export const CLOUD_DEV = Object.freeze({profile:'cloud-dev',projectRef:'ykiubttldgyjpajmsuas',
  url:'https://ykiubttldgyjpajmsuas.supabase.co',publicKey:'sb_publishable_JoMwOnfv-S3MQ5Kr9QKFCQ_NBgvm0fY'});
export function runtimeProfile(env=process.env) {
  const name=env.RA_RUNTIME_PROFILE===undefined?'cloud-dev':env.RA_RUNTIME_PROFILE;
  if(name==='cloud-dev') return CLOUD_DEV;
  if(name!=='vps-lab') throw new Error('RUNTIME_PROFILE_INVALID');
  if(env.VERCEL==='1'||env.RA_LAB_ORIGIN!=='http://127.0.0.1:13000'||env.RA_LAB_ISSUER!=='http://127.0.0.1:13000/auth/v1'||
     !env.RA_LAB_ANON_TOKEN||env.SUPABASE_URL||env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_ANON_KEY||env.SUPABASE_SECRET_KEY)
    throw new Error('VPS_LAB_CONFIG_INVALID');
  return Object.freeze({profile:name,projectRef:null,url:env.RA_LAB_ORIGIN,publicKey:env.RA_LAB_ANON_TOKEN});
}
export function requireCloudProfile(env=process.env) {
  if(runtimeProfile(env).profile!=='cloud-dev') throw Object.assign(new Error('PROVIDER_DISABLED_IN_VPS_LAB'),{code:'PROVIDER_DISABLED_IN_VPS_LAB'});
}
