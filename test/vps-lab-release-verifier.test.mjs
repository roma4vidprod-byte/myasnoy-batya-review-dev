import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const verifier=readFileSync(new URL('../scripts/verify-vps-lab.mjs',import.meta.url),'utf8');
const sha=data=>createHash('sha256').update(data).digest('hex');

function fixture(count=11){
  const root=mkdtempSync(join(tmpdir(),'vps-lab-verifier-'));
  mkdirSync(join(root,'scripts'));
  writeFileSync(join(root,'scripts','verify-vps-lab.mjs'),verifier);
  const files=[];
  for(let i=0;i<count;i++){
    const path=`file-${i}.txt`,data=Buffer.from(`payload-${i}`);
    writeFileSync(join(root,path),data);files.push({path,sha256:sha(data)});
  }
  writeFileSync(join(root,'VPS04_RELEASE.json'),JSON.stringify({profile:'vps-lab',files}));
  return {root,files};
}

test('LAB release verifier accepts a hashed 11-file evolving manifest',()=>{
  const f=fixture(11);
  try{
    const r=spawnSync(process.execPath,[join(f.root,'scripts','verify-vps-lab.mjs')],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('LAB release verifier still rejects tampering and duplicate paths',()=>{
  const f=fixture(11);
  try{
    writeFileSync(join(f.root,'file-10.txt'),'tampered');
    let r=spawnSync(process.execPath,[join(f.root,'scripts','verify-vps-lab.mjs')],{encoding:'utf8'});
    assert.notEqual(r.status,0);assert.match(r.stderr,/LAB_RELEASE_VERIFICATION_FAILED/);
    const data=Buffer.from('payload-10');writeFileSync(join(f.root,'file-10.txt'),data);
    const manifest={profile:'vps-lab',files:[...f.files,{...f.files[0]}]};
    writeFileSync(join(f.root,'VPS04_RELEASE.json'),JSON.stringify(manifest));
    r=spawnSync(process.execPath,[join(f.root,'scripts','verify-vps-lab.mjs')],{encoding:'utf8'});
    assert.notEqual(r.status,0);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
