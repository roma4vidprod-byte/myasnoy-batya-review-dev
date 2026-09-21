import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const cli=fileURLToPath(new URL('../tools/vps14/verify-writer-release.mjs',import.meta.url));
function fixture(change=()=>{}){
  const root=mkdtempSync(join(tmpdir(),'vps14-manifest-'));
  const files={};
  for(let i=0;i<10;i++){
    const name=`source-${i}.js`,body=`// synthetic source ${i}\n`;
    writeFileSync(join(root,name),body);
    files[name]=createHash('sha256').update(body).digest('hex');
  }
  const m={stage:5,sourceSha:'a'.repeat(40),writeEnabled:false,files};
  change(m,root);writeFileSync(join(root,'MANIFEST.json'),JSON.stringify(m));
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  try{return spawnSync(process.execPath,[cli,root],{env,encoding:'utf8',timeout:10000});}
  finally{rmSync(root,{recursive:true,force:true});}
}
test('stage5 release verifier accepts exact immutable source hashes',()=>{
  const p=fixture();assert.equal(p.status,0,p.stderr);
  assert.equal(JSON.parse(p.stdout).fileCount,10);
});
test('stage5 release verifier rejects changed file content',()=>{
  const p=fixture((m,root)=>writeFileSync(join(root,'source-0.js'),'changed'));
  assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).status,'MANIFEST_FAILED');
});
test('stage5 release verifier rejects path traversal',()=>{
  const p=fixture(m=>{m.files['../outside.js']='0'.repeat(64);});
  assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).status,'MANIFEST_FAILED');
});
test('stage5 release verifier rejects write-enabled package marker',()=>{
  const p=fixture(m=>{m.writeEnabled=true;});
  assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).status,'MANIFEST_FAILED');
});
