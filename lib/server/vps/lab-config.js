import { createPublicKey, verify } from 'node:crypto';
import { runtimeProfile } from '../runtime-profile.js';
import { readFoundationConfig, BLOCKED_CREDENTIAL_NAMES } from './foundation-config.js';

export function readLabConfig(env=process.env,now=Date.now()) {
  const target=runtimeProfile(env);
  if(target.profile!=='vps-lab'||env.RA_VPS_PROFILE!=='vps-lab') throw new Error('VPS_LAB_OPT_IN_REQUIRED');
  if(BLOCKED_CREDENTIAL_NAMES.some(k=>env[k])||Object.keys(env).some(k=>/^(GOTRUE_|PGRST_|RA_LAB_(PRIVATE|SERVICE|SIGNING))/.test(k))) throw new Error('VPS_LAB_SECRET_FORBIDDEN');
  const base=readFoundationConfig({...env,RA_VPS_PROFILE:'foundation'});
  if(base.port!==13000) throw new Error('VPS_LAB_PORT_INVALID');
  let jwk;
  try {
    jwk=JSON.parse(env.RA_LAB_PUBLIC_JWK);
    if(Object.keys(jwk).some(k=>!['kty','crv','x','y','kid','alg','use','key_ops'].includes(k))||jwk.kty!=='EC'||jwk.crv!=='P-256'||jwk.alg!=='ES256') throw new Error();
    const parts=target.publicKey.split('.');if(parts.length!==3)throw new Error();
    const header=JSON.parse(Buffer.from(parts[0],'base64url'));
    const c=JSON.parse(Buffer.from(parts[1],'base64url'));
    if(header.alg!=='ES256'||header.kid!==jwk.kid||c.iss!==env.RA_LAB_ISSUER||c.aud!=='authenticated'||c.role!=='anon'||!(c.exp>now/1000))throw new Error();
    if(!verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key:createPublicKey({key:jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')))throw new Error();
  }catch {throw new Error('VPS_LAB_PUBLIC_JWT_INVALID');}
  return Object.freeze({...base,profile:'vps-lab',target,issuer:env.RA_LAB_ISSUER,jwk:Object.freeze(jwk),
    authUrl:'http://127.0.0.1:19999',apiUrl:'http://127.0.0.1:13001',schemaVersion:'vps04-auth-api-v1'});
}
