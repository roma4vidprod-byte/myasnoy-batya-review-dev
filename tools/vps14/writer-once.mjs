// Stage 5 entrypoint: no CLI credentials, no HTTP server, no CSRF/session adapter.
import {runVpsReplyRuntime} from './writer-runtime.mjs';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(process.argv.length!==2){
  emit({ok:false,status:'BLOCKED',code:'REPLY_RUNTIME_ARGUMENTS_DENIED',claimed:false,
    storageCalls:0,sessionReads:0,providerRequests:0,providerWrites:0});
  process.exitCode=64;
}else{
  try{
    const result=await runVpsReplyRuntime();
    emit(result);
    if(!result.ok)process.exitCode=78;
  }catch{
    // Never serialize arbitrary exceptions or imply zero calls after unknown errors.
    emit({ok:false,status:'ERROR',code:'REPLY_RUNTIME_FAILED'});
    process.exitCode=1;
  }
}
