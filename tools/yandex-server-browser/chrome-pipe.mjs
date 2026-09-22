function fail(code){throw Object.assign(new Error(code),{code});}

export function createCdpPipe({input,output,timeoutMs=8000,onEvent=()=>{}}={}){
  if(!input||typeof input.write!=='function'||!output||typeof output.on!=='function')
    fail('BROWSER_CDP_INVALID');
  let nextId=1,buffer=Buffer.alloc(0),closed=false;
  const pending=new Map();
  const rejectAll=()=>{
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Object.assign(new Error('BROWSER_CDP_CLOSED'),{code:'BROWSER_CDP_CLOSED'}));}
    pending.clear();
  };
  const handle=raw=>{
    let value;
    try{value=JSON.parse(raw.toString('utf8'));}catch{return fail('BROWSER_CDP_PROTOCOL_INVALID');}
    if(value&&Number.isSafeInteger(value.id)){
      const item=pending.get(value.id);if(!item)return;
      pending.delete(value.id);clearTimeout(item.timer);
      if(value.error)return item.reject(Object.assign(new Error('BROWSER_CDP_COMMAND_FAILED'),{code:'BROWSER_CDP_COMMAND_FAILED'}));
      return item.resolve(value.result??{});
    }
    if(value?.method){
      Promise.resolve(onEvent(value)).catch(()=>{});
    }
  };
  output.on('data',chunk=>{
    if(closed)return;
    buffer=Buffer.concat([buffer,chunk]);
    for(;;){
      const at=buffer.indexOf(0);if(at<0)break;
      const raw=buffer.subarray(0,at);buffer=buffer.subarray(at+1);
      if(raw.length)handle(raw);
    }
    if(buffer.length>1048576)fail('BROWSER_CDP_PROTOCOL_INVALID');
  });
  const close=()=>{
    if(closed)return;closed=true;rejectAll();
    try{input.end();}catch{}
  };
  input.on?.('error',close);output.on('error',close);output.on('end',close);
  return Object.freeze({
    send(method,params={},sessionId){
      if(closed||typeof method!=='string'||!method)return Promise.reject(Object.assign(new Error('BROWSER_CDP_CLOSED'),{code:'BROWSER_CDP_CLOSED'}));
      const id=nextId++;
      const message={id,method,params,...(sessionId?{sessionId}:{})};
      const bytes=Buffer.from(JSON.stringify(message)+'\0','utf8');
      if(bytes.length>262144)return Promise.reject(Object.assign(new Error('BROWSER_CDP_COMMAND_FAILED'),{code:'BROWSER_CDP_COMMAND_FAILED'}));
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error('BROWSER_CDP_TIMEOUT'),{code:'BROWSER_CDP_TIMEOUT'}));},timeoutMs);
        pending.set(id,{resolve,reject,timer});
        try{input.write(bytes);}catch{clearTimeout(timer);pending.delete(id);reject(Object.assign(new Error('BROWSER_CDP_CLOSED'),{code:'BROWSER_CDP_CLOSED'}));}
      });
    },
    close
  });
}
