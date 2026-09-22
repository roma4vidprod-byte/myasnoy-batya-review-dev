import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';

const ROOT=new URL('../',import.meta.url);
const script=new URL('../scripts/build-yandex-account-bootstrap.mjs',import.meta.url);
const example=new URL('../tools/yandex-account-bootstrap/bootstrap-profile.example.json',import.meta.url);
const source=readFileSync(script,'utf8');

test('account bootstrap builder has no network/provider execution',()=>{
  assert.doesNotMatch(source,/globalThis\.fetch|\bfetch\s*\(|node:https|node:http|node:net|business-answer/);
  assert.match(source,/BOOTSTRAP_PROFILE_CONTAINS_SECRET/);
  assert.match(source,/NO_YANDEX_REPLY_WRITE_WITHOUT_SEPARATE_EXACT_APPROVAL/);
});

test('account bootstrap example builds immutable evidence and account overlay',()=>{
  const base=mkdtempSync(join(tmpdir(),'slukh-yandex-bootstrap-'));
  const out=join(base,'bundle');
  try{
    const result=spawnSync(process.execPath,[script.pathname.slice(1),example.pathname.slice(1),out],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
    const response=JSON.parse(result.stdout.trim());
    assert.equal(response.ok,true);
    const profile=JSON.parse(readFileSync(join(out,'ACCOUNT_PROFILE.json'),'utf8'));
    assert.equal(profile.customer_slug,'example-client');
    const files=JSON.parse(readFileSync(join(out,'BOOTSTRAP_FILES.json'),'utf8'));
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).trim();
    assert.equal(files.source_commit,head);
    assert.ok(files.files.length>=30);
    assert.ok(files.bootstrap.length>=7);
    assert.ok(files.verification.length>=10);
    assert.ok(files.references.length>=5);
    const overlay=readFileSync(join(out,'overlay/lib/server/yandex-session/crypto.js'),'utf8');
    assert.match(overlay,/slukh-example-client-01/);
    assert.doesNotMatch(overlay,/myasnoibatya-zakaz/);
    const scope=readFileSync(join(out,'overlay/lib/server/yandex-session/profile-context.js'),'utf8');
    assert.match(scope,/12345678901/);
    const plan=JSON.parse(readFileSync(join(out,'BOOTSTRAP_PLAN.json'),'utf8'));
    assert.equal(plan.write_enabled,false);
    assert.equal(plan.next_action,'WAIT_FOR_REPRESENTATIVE_ACCESS_CONFIRMATION');
  }finally{rmSync(base,{recursive:true,force:true});}
});

test('account bootstrap rejects secret-bearing profile before bundle creation',()=>{
  const base=mkdtempSync(join(tmpdir(),'slukh-yandex-bootstrap-secret-'));
  const profile=JSON.parse(readFileSync(example,'utf8'));
  profile.password='DO_NOT_STORE_THIS';
  const input=join(base,'profile.json'),out=join(base,'bundle');
  writeFileSync(input,JSON.stringify(profile));
  try{
    const result=spawnSync(process.execPath,[script.pathname.slice(1),input,out],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.equal(JSON.parse(result.stdout.trim()).code,'BOOTSTRAP_PROFILE_CONTAINS_SECRET');
  }finally{rmSync(base,{recursive:true,force:true});}
});

test('confirmed Meat Father template cannot keep CHANGE-ME login',()=>{
  const base=mkdtempSync(join(tmpdir(),'slukh-yandex-bootstrap-placeholder-'));
  const profile=JSON.parse(readFileSync(new URL('../tools/yandex-account-bootstrap/meatfather-profile.template.json',import.meta.url),'utf8'));
  profile.representative_access='CONFIRMED';
  const input=join(base,'profile.json'),out=join(base,'bundle');
  writeFileSync(input,JSON.stringify(profile));
  try{
    const result=spawnSync(process.execPath,[script.pathname.slice(1),input,out],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.equal(JSON.parse(result.stdout.trim()).code,'BOOTSTRAP_LOGIN_PLACEHOLDER');
  }finally{rmSync(base,{recursive:true,force:true});}
});
