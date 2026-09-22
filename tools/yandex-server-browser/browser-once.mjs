import {runServerBrowserRead,publicBrowserError} from './browser-read.mjs';

const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(process.argv.length!==2){
  emit({ok:false,operation:'server_browser_read',error:'BROWSER_ARGUMENTS_DENIED',provider_writes:0});
  process.exitCode=64;
}else{
  try{
    emit(await runServerBrowserRead());
  }catch(error){
    emit({ok:false,operation:'server_browser_read',error:publicBrowserError(error),provider_writes:0});
    process.exitCode=1;
  }
}
