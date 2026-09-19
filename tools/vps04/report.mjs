// Safe read-only final inventory and evidence files. No credential reads.
import {ROOT,run,sql} from './bootstrap.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.getuid(),0);assert.equal(run('hostname',[]).trim(),'hiplet-120706');
const reboot={status:'NOT_RUN',reason:'RESCUE_NOT_VERIFIED',evidence:'HipHosting authenticated panel available; VNC canvas zero size and Ctrl+Alt+Del disabled.',
  reboots:0,services_enabled:['ssh.socket','postgresql.service','review-lab-auth','review-lab-api','review-activator-foundation']};
writeFileSync(ROOT+'/VPS04_REBOOT.json',JSON.stringify(reboot,null,2)+'\n',{flag:'wx',mode:0o644});
const counts=sql(`select jsonb_build_object('auth_users',(select count(*) from auth.users),'auth_migrations',(select count(*) from auth.schema_migrations),
  'reviews',(select count(*) from public.review_external_reviews),'admins',(select count(*) from public.review_admins),
  'companies',(select count(*) from public.review_companies),'locations',(select count(*) from public.review_locations),
  'sync_runs',(select count(*) from public.review_sync_runs),'provider_connections',(select count(*) from public.review_provider_connections),
  'yandex_sessions',(select count(*) from review_private.yandex_sessions),'cron_jobs',(select count(*) from cron.job));`).trim().split('\n').at(-1);
const resources={memory:run('free',['-m']),disk:run('df',['-h','/']),load:run('cat',['/proc/loadavg'])};
const r={status:'AUTH_PLATFORM_PASS / APP_BACKEND_PASS / ACCEPTANCE_BLOCKED',counts:JSON.parse(counts),resources,
  enabled:run('systemctl',['is-enabled',...reboot.services_enabled]).trim().split('\n'),
  listeners:run('ss',['-lnt']),firewall:run('ufw',['status']),
  versions:{postgresql:sql('show server_version_num;').trim().split('\n').at(-1),auth:'v2.196.0',postgrest:'14.17',node:run('/opt/node/bin/node',['--version']).trim()},
  tests:{targeted_windows:{pass:88,fail:0,skip:0},native_direct:{pass:29,fail:0},native_node:{pass:29,fail:0},failure:{pass:8,fail:0},windows_full:{pass:479,fail:10,skip:0,reason:'V8_PGLITE_OOM'},checks:125},
  effects:{yandex_reads:0,yandex_writes:0,twogis:0,external_email:0,telegram:0,ai:0,promo:0,supabase_cloud_writes:0,vercel_writes:0,business_os:0,production:0,
    official_components_installed:2,lab_bootstrap:1,synthetic_users_created:3,synthetic_review_rows_created:2,marker_failure_test_writes:2,auth_synthetic_session_writes:'OFFICIAL_AUTH_ONLY_NOT_ROW_COUNTED',reboots:0,
    effective_enqueue:0,worker_runs:0,recovery_executions:0},
  blockers:['WORKING_RESCUE_CONSOLE_REQUIRED_FOR_REBOOT','WINDOWS_MEMORY_REQUIRED_FOR_COMPLETE_FULL_SUITE'],
  release:JSON.parse(readFileSync(ROOT+'/releases/vps04-initial/VPS04_RELEASE.json','utf8'))};
writeFileSync(ROOT+'/VPS04_STATUS.json',JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o644});
const md=`# VPS04 actual result\n\nSTATUS = ${r.status}\n\nOfficial Auth + PostgREST + native PG17 + existing Node adapter are running only on loopback. Auth/JWT/RLS real HTTP: 29/29 direct and 29/29 through Node. Failure tests 8/8. healthz=200, readyz=200. This is synthetic LAB only, not production ready.\n\nReboot NOT_RUN: rescue console not verified. Full Windows suite: 479 PASS / 10 file-level OOM failures; historical 36 Recovery09A failures not reclassified as fixed. Targeted 88/88; checks 125; diff-check PASS.\n\nNew synthetic credentials exist only in strict root-owned files; Node has public token/JWK only. No Cloud secrets/Yandex keys imported. Counts and individual tests are in adjacent safe JSON. Auth normal session/refresh DB writes occurred; do not claim DB writes=0. Supabase Cloud/Vercel/Production/Business OS/provider/delivery effects all zero.\n\nSource baseline 1db4d3ea836c663278307d5b846b0ff484e578e9; runtime snapshot is identified by VPS04_RELEASE.json per-file hashes. Original foundation unit/release retained; one explicit LAB drop-in. Worker/timer absent.\n\nNext: restore verified rescue access and local Windows memory; finish reboot and full suite. Then separately approve backup/restore, monitoring, HTTPS, worker/provider acceptance. No automatic provider or scheduler follow-up.\n`;
writeFileSync(ROOT+'/VPS04_FINAL_REPORT.md',md,{flag:'wx',mode:0o644});
console.log(JSON.stringify({status:r.status,counts:r.counts,versions:r.versions,effects:r.effects,blockers:r.blockers}));
