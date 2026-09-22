'use strict';
const fs=require('fs');
const {Client}=require('ssh2');

const HOST='83.217.214.29';
const USER='root';
const KEY='C:/Users/tasfo/BusinessOS/Review-Activator-Tools/vps/reviewadmin_ed25519';
const HOSTKEY='SHA256:ji67KADy5JFkBqWMOX6N8hSvknW8Tznlj9zDCJ2dwaQ';
const ACTION='bd961975-5f88-44b6-b6b6-19ae626199b4';
const REVIEW='pYsoi9xLPVyvlP5aiXNdI-oUAYxJI0';
const FINGERPRINT='fd3cec79843a55631abc7fb81d8fc70a33a0ae18a5ed76f78c453f02d1bfcd08';
const IDEMPOTENCY='703eafa5-be32-4480-9909-fd50a1a2b20b';
const COMMAND=[
  '/usr/bin/systemd-run','--quiet','--wait','--collect','--pipe',
  '--service-type=exec','--uid=review-yandex-writer','--gid=review-yandex-writer',
  '-p','NoNewPrivileges=yes','-p',"'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'",
  '-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','PrivateTmp=yes',
  '-p','PrivateDevices=yes','-p','CapabilityBoundingSet=',
  '-p','LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
  '-E','RA_RUNTIME_PROFILE=vps-lab','-E','RA_YANDEX_MODE=reply-write-one-shot',
  '-E','RA_YANDEX_REPLY_WRITE_ENABLED=true','-E',`RA_STAGE9_ACTION_ID=${ACTION}`,
  '-E',`RA_STAGE9_REVIEW_ID=${REVIEW}`,'-E',`RA_STAGE9_FINGERPRINT=${FINGERPRINT}`,
  '-E',`RA_STAGE9_IDEMPOTENCY_KEY=${IDEMPOTENCY}`,
  '/opt/node/bin/node','/opt/review-activator-reply/current/tools/vps14/writer-approved-once.mjs'
].join(' ');

let stream,finished=false,stdinBytes=0,stdoutBytes=0;
function stop(code=1){
  if(finished)return;finished=true;
  try{stream?.end();}catch{} try{conn.end();}catch{}
  process.exitCode=code;
}
const conn=new Client();
conn.on('ready',()=>conn.exec(COMMAND,(error,remote)=>{
  if(error)return stop(1);stream=remote;
  process.stdin.on('data',chunk=>{
    stdinBytes+=chunk.length;if(stdinBytes>8192)return stop(1);
    if(!finished)remote.write(chunk);
  });
  process.stdin.on('end',()=>{if(!finished)remote.end();});
  remote.on('data',chunk=>{
    stdoutBytes+=chunk.length;if(stdoutBytes>8192)return stop(1);
    if(!finished)process.stdout.write(chunk);
  });
  remote.stderr.on('data',()=>{});
  remote.on('close',code=>stop(Number.isInteger(code)?code:1));
}));
conn.on('error',()=>stop(1));
conn.connect({host:HOST,port:22,username:USER,privateKey:fs.readFileSync(KEY),
  hostHash:'sha256',hostVerifier:hash=>'SHA256:'+Buffer.from(hash,'hex')
    .toString('base64').replace(/=+$/,'')===HOSTKEY,
  readyTimeout:15000});
process.on('SIGINT',()=>stop(130));process.on('SIGTERM',()=>stop(143));
