export const YANDEX_CSRF_ENDPOINT='https://yandex.ru/sprav/api/view/chain/0/list/';

function fail(code){
  throw Object.assign(new Error(code),{code});
}

export function buildYandexCsrfCandidate(){
  return Object.freeze({
    method:'POST',
    url:YANDEX_CSRF_ENDPOINT,
    headers:Object.freeze({
      Accept:'application/json, text/plain, */*'
    }),
    ensureCookieI:true,
    body:null
  });
}

export function classifyYandexCsrfResponse({
  status,contentType='',text='',location=null
}={}){
  if(!Number.isSafeInteger(status)||status<100||status>599||
     typeof contentType!=='string'||typeof text!=='string')
    fail('YANDEX_CSRF_RESPONSE_INVALID');

  if(status===401)return Object.freeze({ok:false,code:'YANDEX_CSRF_HTTP_401'});
  if(status===403)return Object.freeze({ok:false,code:'YANDEX_CSRF_HTTP_403'});
  if(status>=300&&status<400)
    return Object.freeze({ok:false,code:'YANDEX_CSRF_REDIRECT'});
  if(status===429)return Object.freeze({ok:false,code:'YANDEX_CSRF_RATE_LIMITED'});
  if(status!==488)
    return Object.freeze({ok:false,code:'YANDEX_CSRF_STATUS_DRIFT'});

  if(!/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(contentType))
    return Object.freeze({ok:false,code:'YANDEX_CSRF_CONTENT_TYPE_DRIFT'});

  let value;
  try{value=JSON.parse(text);}catch{
    return Object.freeze({ok:false,code:'YANDEX_CSRF_JSON_INVALID'});
  }
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).some(key=>key!=='csrf')||
     typeof value.csrf!=='string'||value.csrf.length<8||value.csrf.length>1024)
    return Object.freeze({ok:false,code:'YANDEX_CSRF_RESPONSE_DRIFT'});

  return Object.freeze({
    ok:true,
    code:'YANDEX_CSRF_AVAILABLE',
    token:value.csrf
  });
}
