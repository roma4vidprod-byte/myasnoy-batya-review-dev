'use strict';
const fs=require('fs');
const {Client}=require('ssh2');

const HOST='83.217.214.29';
const USER='root';
const KEY='C:/Users/tasfo/BusinessOS/Review-Activator-Tools/vps/reviewadmin_ed25519';
const HOSTKEY='SHA256:ji67KADy5JFkBqWMOX6N8hSvknW8Tznlj9zDCJ2dwaQ';
const COMMAND=[
  '/usr/sbin/runuser -u review-yandex-import --',
  '/usr/bin/env -i PATH=/usr/bin:/bin',
  'RA_RUNTIME_PROFILE=vps-lab',
  'RA_YANDEX_MODE=read-only-admin',
  '/opt/node/bin/node',
  '/opt/review-activator-yandex/tools/vps14/session-refresh.mjs'
].join(' ');

let stream;
let stdinBytes=0;
let finished=false;

function stop(code=1){
  if(finished)return;
  finished=true;
  try{stream?.end();}catch{}
  try{conn.end();}catch{}
  process.exitCode=code;
}
const conn=new Client();

conn.on('ready',()=>{
  conn.exec(COMMAND,(error,remote)=>{
    if(error)return stop(1);
    stream=remote;

    process.stdin.on('data',chunk=>{
      stdinBytes+=chunk.length;
      if(stdinBytes>70_000)return stop(1);
      if(!finished)remote.write(chunk);
    });
    process.stdin.on('end',()=>{if(!finished)remote.end();});

    remote.on('data',chunk=>{
      if(!finished)process.stdout.write(chunk);
    });
    remote.stderr.on('data',()=>{});
    remote.on('close',code=>stop(Number.isInteger(code)?code:1));
  });
});

conn.on('error',()=>stop(1));

const key=fs.readFileSync(KEY);
conn.connect({
  host:HOST,
  port:22,
  username:USER,
  privateKey:key,
  hostHash:'sha256',
  hostVerifier:hash=>{
    const actual='SHA256:'+Buffer.from(hash,'hex')
      .toString('base64').replace(/=+$/,'');
    return actual===HOSTKEY;
  },
  readyTimeout:15_000,
  keepaliveInterval:10_000,
  keepaliveCountMax:2
});

process.on('SIGINT',()=>stop(130));
process.on('SIGTERM',()=>stop(143));
