import {readFileSync} from 'node:fs';
import {readLabConfig} from '../lib/server/vps/lab-config.js';
import {createLabServer} from '../lib/server/vps/lab.js';

try {
  if(typeof process.getuid!=='function'||process.getuid()===0)throw new Error();
  const config=readLabConfig();
  const admin=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
  const publicConfig={profile:'vps-lab',url:config.target.url,publicKey:config.target.publicKey,scope:config.adminScope};
  const escaped=JSON.stringify(publicConfig).replaceAll('<','\\u003c');
  const adminHtml=admin.replace('<head>',`<head><script>window.REVIEW_ACTIVATOR_RUNTIME=${escaped};</script>`);
  const app=createLabServer({config,adminHtml,logger:e=>process.stdout.write(JSON.stringify(e)+'\n')});
  app.server.on('error',()=>{process.stderr.write('LAB_LISTENER_FAILED\n');process.exitCode=1;});
  app.server.listen(config.port,config.host);
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.stop().catch(()=>{process.exitCode=1;});});
}catch {process.stderr.write('LAB_CONFIG_OR_STARTUP_FAILED\n');process.exitCode=1;}
