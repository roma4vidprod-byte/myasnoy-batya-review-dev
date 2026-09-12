// One operator invocation in the existing key-bearing PS7. No secret arguments.
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { createSessionStore } from '../lib/server/yandex-session/store.js';
import { keyringFromEnv } from '../lib/server/yandex-session/crypto.js';
try {
  if(process.argv.length!==2)throw new Error('ARGUMENTS_FORBIDDEN');
  const service=createYandexSessionService({store:createSessionStore(),keyring:keyringFromEnv(),
    allowRead:true,notify:async()=> 'MOCKED_NO_DELIVERY'});
  const result=await service.run({organizationId:'54309413522',
    companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
    locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae'},
    {mode:'dry_run',pageBase:1,maxPages:20,safeReport:true});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.ok)process.exitCode=1;
} catch {
  process.stdout.write('DRY-RUN STOPPED — safe status check required; do not retry.\n');
  process.exitCode=1;
}
