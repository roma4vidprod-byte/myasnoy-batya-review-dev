'use strict';
const fs=require('fs');
const {Client}=require('ssh2');

const HOST='83.217.214.29';
const USER='root';
const KEY='C:/Users/tasfo/BusinessOS/Review-Activator-Tools/vps/reviewadmin_ed25519';
const HOSTKEY='SHA256:ji67KADy5JFkBqWMOX6N8hSvknW8Tznlj9zDCJ2dwaQ';
const COMMAND=[
  '/usr/bin/systemd-run','--quiet','--wait','--collect','--pipe',
  '--service-type=exec',
  '--uid=review-yandex-writer','--gid=review-yandex-writer',
  '-p','NoNewPrivileges=yes',
  '-p','PrivateNetwork=yes',
  '-p','RestrictAddressFamilies=AF_UNIX',
  '-p','ProtectSystem=strict',
  '-p','ProtectHome=yes',
  '-p','PrivateTmp=yes',
  '-p','PrivateDevices=yes',
  '-p','CapabilityBoundingSet=',
  '-p','LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
  '-E','RA_RUNTIME_PROFILE=vps-lab',
  '-E','RA_YANDEX_MODE=read-only-admin',
  '/opt/node/bin/node',
  '/opt/review-activator-reply/current/tools/vps14/writer-readiness.mjs'
].join(' ');
let stream,finished=false,stdinBytes=0,stdoutBytes=0;
function stop(code=1){
  if(finished)return;
  finished=true;
  try{stream?.end();}catch{}
  try{conn.end();}catch{}
  process.exitCode=code;
}
const conn=new Client();
conn.on('ready',()=>conn.exec(COMMAND,(error,remote)=>{
  if(error)return stop(1);
  stream=remote;
  process.stdin.on('data',chunk=>{
    stdinBytes+=chunk.length;
    if(stdinBytes>4096)return stop(1);
    if(!finished)remote.write(chunk);
  });
  process.stdin.on('end',()=>{if(!finished)remote.end();});
  remote.on('data',chunk=>{
    stdoutBytes+=chunk.length;
    if(stdoutBytes>4096)return stop(1);
    if(!finished)process.stdout.write(chunk);
  });
  remote.stderr.on('data',()=>{});
  remote.on('close',code=>stop(Number.isInteger(code)?code:1));
}));
conn.on('error',()=>stop(1));
conn.connect({
  host:HOST,port:22,username:USER,privateKey:fs.readFileSync(KEY),
  hostHash:'sha256',
  hostVerifier:hash=>'SHA256:'+Buffer.from(hash,'hex')
    .toString('base64').replace(/=+$/,'')===HOSTKEY,
  readyTimeout:15000,keepaliveInterval:10000,keepaliveCountMax:2
});
process.on('SIGINT',()=>stop(130));
process.on('SIGTERM',()=>stop(143));
