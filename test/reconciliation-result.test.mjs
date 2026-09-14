import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReconciliationFailure as fail, safeReconciliationSuccess as success }
  from '../lib/server/reconciliation-result.js';

const codes = ['REVIEW_SCOPE_INVALID','REVIEW_CONNECTION_NOT_FOUND',
  'SESSION_NOT_READY','RECONCILIATION_NOT_ALLOWED'];
for (const code of codes) {
  test(`exact SQLSTATE 22023 + ${code} is preserved`, () => {
    assert.deepEqual(fail({code:'22023',message:code}, 'RPC_ERROR_RESPONSE'), {
      ok:false,error:code,failure_stage:'RECONCILIATION_RPC',
      outcome:'BUSINESS_REJECTED',connection_effect:'NOT_APPLIED_BY_THIS_RPC',
    });
  });
}
for (const sqlstate of ['P0001','42501','08006','23505','PGRST202','',null,22023]) {
  test(`different SQLSTATE ${String(sqlstate)} is not a business rejection`, () => {
    const result = fail({code:sqlstate,message:'RECONCILIATION_NOT_ALLOWED'}, 'RPC_ERROR_RESPONSE');
    assert.equal(result.error,'RECONCILIATION_FAILED');
    assert.equal(result.connection_effect,'UNKNOWN');
  });
}
for (const message of [
  'RECONCILIATION_NOT_ALLOWED secret-canary',
  'prefix RECONCILIATION_NOT_ALLOWED',
  'reconciliation_not_allowed',
  'RECONCILIATION_NOT_ALLOWED\n',
  'ERROR: RECONCILIATION_NOT_ALLOWED',
  '', null, ['RECONCILIATION_NOT_ALLOWED'],
]) {
  test(`unknown/raw message is not substring matched: ${JSON.stringify(message)}`, () => {
    const result=fail({code:'22023',message},'RPC_ERROR_RESPONSE');
    assert.equal(result.error,'RECONCILIATION_FAILED');
    assert.equal(result.connection_effect,'UNKNOWN');
    assert.equal(JSON.stringify(result).includes('secret-canary'),false);
  });
}
for (const boundary of ['UNKNOWN','RPC_TRANSPORT_UNKNOWN','RPC_RESPONSE_INVALID','UNTRUSTED']) {
  test(`business-looking error at ${boundary} does not prove rollback`, () => {
    const result=fail({code:'22023',message:'SESSION_NOT_READY'},boundary);
    assert.equal(result.connection_effect,'UNKNOWN');
    assert.notEqual(result.outcome,'BUSINESS_REJECTED');
  });
}
test('pre-dispatch failure is explicitly not attempted', () => {
  const result=fail(new Error('synthetic-private-canary'),'BEFORE_RPC_DISPATCH');
  assert.equal(result.connection_effect,'NOT_ATTEMPTED');
  assert.equal(JSON.stringify(result).includes('synthetic-private-canary'),false);
});
test('raw error attributes are never returned', () => {
  const result=fail({code:'22023',message:'SESSION_NOT_READY',details:'SECRET_CANARY',
    hint:'SECRET_CANARY',stack:'SECRET_CANARY',cause:{token:'SECRET_CANARY'}},'RPC_ERROR_RESPONSE');
  assert.equal(JSON.stringify(result).includes('SECRET_CANARY'),false);
  assert.deepEqual(Object.keys(result).sort(),['connection_effect','error','failure_stage','ok','outcome']);
});
test('error with inherited fields is not trusted', () => {
  const result=fail(Object.create({code:'22023',message:'SESSION_NOT_READY'}),'RPC_ERROR_RESPONSE');
  assert.equal(result.error,'RECONCILIATION_FAILED');
});
test('getters are never executed', () => {
  let calls=0;
  const input={get code(){calls++;throw new Error('SYNTHETIC_SECRET');},
    get message(){calls++;return 'SESSION_NOT_READY';}};
  assert.doesNotThrow(()=>fail(input,'RPC_ERROR_RESPONSE'));
  assert.equal(calls,0);
});
test('throwing proxy cannot leak or crash failure mapping', () => {
  const input=new Proxy({}, {getOwnPropertyDescriptor(){throw new Error('SYNTHETIC_SECRET');}});
  assert.equal(fail(input,'RPC_ERROR_RESPONSE').error,'RECONCILIATION_FAILED');
});
for (const input of [null,undefined,'secret-canary',false,1]) {
  test(`non-object error ${typeof input}/${String(input)} maps safely`,()=>{
    const output=fail(input,'RPC_ERROR_RESPONSE');
    assert.equal(output.error,'RECONCILIATION_FAILED');
    assert.equal(output.connection_effect,'UNKNOWN');
  });
}
for (const changed of [true,false]) {
  test(`success changed=${changed} preserves exact boolean`,()=>{
    const output=success({ok:true,changed,status:'READY',session_state:'READY'});
    assert.equal(output.ok,true);
    assert.equal(output.changed,changed);
    assert.equal(output.outcome,changed?'CHANGED':'ALREADY_READY');
  });
}
const malformed=[null,undefined,'READY',[],{},
  {ok:true,status:'READY',session_state:'READY'},
  {ok:true,changed:'false',status:'READY',session_state:'READY'},
  {ok:true,changed:0,status:'READY',session_state:'READY'},
  {ok:'true',changed:true,status:'READY',session_state:'READY'},
  {ok:true,changed:true,status:'ERROR',session_state:'READY'},
  {ok:true,changed:false,status:'READY',session_state:'ERROR'},
  {ok:false,changed:false,status:'READY',session_state:'READY'}];
for (const [index,data] of malformed.entries()) {
  test(`invalid success #${index+1} leaves effect UNKNOWN`,()=>{
    const output=success(data);
    assert.equal(output.ok,false);
    assert.equal(output.error,'RECONCILIATION_CONTRACT_DRIFT');
    assert.equal(output.connection_effect,'UNKNOWN');
    assert.equal(Object.hasOwn(output,'changed'),false);
  });
}
test('extra success fields are projected out',()=>{
  const output=success({ok:true,changed:true,status:'READY',session_state:'READY',
    cookies:'SECRET_CANARY',raw_payload:'SECRET_CANARY',error:'SECRET_CANARY'});
  assert.equal(JSON.stringify(output).includes('SECRET_CANARY'),false);
});
test('missing fields do not become false or zero',()=>{
  const result=success({ok:true});
  assert.equal(result.connection_effect,'UNKNOWN');
  assert.equal(Object.hasOwn(result,'changed'),false);
});
test('inputs stay unchanged and output is frozen',()=>{
  const input=Object.freeze({code:'22023',message:'SESSION_NOT_READY'});
  const output=fail(input,'RPC_ERROR_RESPONSE');
  assert.equal(Object.isFrozen(output),true);
  assert.equal(input.message,'SESSION_NOT_READY');
});
test('transport timeout after a possible committed operation stays UNKNOWN',()=>{
  const result=fail({code:'ETIMEDOUT',message:'synthetic timeout'},'RPC_TRANSPORT_UNKNOWN');
  assert.equal(result.connection_effect,'UNKNOWN');
  assert.equal(Object.hasOwn(result,'changed'),false);
});
test('caller must explicitly identify a genuine RPC error response',()=>{
  const result=fail({code:'22023',message:'SESSION_NOT_READY'});
  assert.equal(result.connection_effect,'UNKNOWN');
});
