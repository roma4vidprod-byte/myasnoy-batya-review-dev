import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('existing Native Messaging protocol dispatches explicit VPS once, never Cloud or local AES',()=>{
  const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','test/support/yandex-vps-import.test.ps1'],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(result.status,0,'synthetic PowerShell dispatcher failed');
  assert.equal(result.stdout.trim(),'VPS_NATIVE_DISPATCH_PASS');
});
