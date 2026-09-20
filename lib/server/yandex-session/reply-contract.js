export const YANDEX_REPLY_ENDPOINT='https://yandex.ru/sprav/api/ugcpub/business-answer';
export const YANDEX_REPLY_MAX_LENGTH=2500;

const FIXED_SCOPE=Object.freeze({
  companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',
  organizationId:'54309413522'
});

function fail(code){
  throw Object.assign(new Error(code),{code});
}

function bounded(value,max,code,{allowEmpty=false}={}){
  if(typeof value!=='string')fail(code);
  const text=value.trim();
  if((!allowEmpty&&!text)||text.length>max)fail(code);
  return text;
}

export function validateReplyPublishScope(scope){
  if(!scope||typeof scope!=='object'||Array.isArray(scope))fail('YANDEX_REPLY_SCOPE_INVALID');
  for(const [key,value] of Object.entries(FIXED_SCOPE))
    if(scope[key]!==value)fail('YANDEX_REPLY_SCOPE_INVALID');
  return FIXED_SCOPE;
}
export function buildYandexReplyCandidate({
  scope,reviewId,replyText,csrfToken,reviewsCsrfToken,answerCsrfToken=null
}={}){
  validateReplyPublishScope(scope);
  const id=bounded(reviewId,256,'YANDEX_REPLY_ID_INVALID');
  const text=bounded(replyText,YANDEX_REPLY_MAX_LENGTH,'YANDEX_REPLY_TEXT_INVALID');
  const csrf=bounded(csrfToken,1024,'YANDEX_REPLY_CSRF_INVALID');
  const reviewsCsrf=bounded(reviewsCsrfToken,1024,'YANDEX_REPLY_REVIEWS_CSRF_INVALID');
  const answerCsrf=answerCsrfToken==null?null:
    bounded(answerCsrfToken,1024,'YANDEX_REPLY_ANSWER_CSRF_INVALID');

  const body={
    reviewId:id,
    text,
    reviewsCsrfToken:reviewsCsrf
  };
  if(answerCsrf!==null)body.answerCsrfToken=answerCsrf;

  return Object.freeze({
    method:'POST',
    url:YANDEX_REPLY_ENDPOINT,
    headers:Object.freeze({
      Accept:'application/json, text/plain, */*',
      'Content-Type':'application/json',
      'X-CSRF-Token':csrf
    }),
    body:Object.freeze(body)
  });
}
export function classifyYandexReplyResponse({
  status,contentType='',text='',location=null
}={}){
  if(!Number.isSafeInteger(status)||status<100||status>599)
    fail('YANDEX_REPLY_RESPONSE_INVALID');
  if(typeof contentType!=='string'||typeof text!=='string')
    fail('YANDEX_REPLY_RESPONSE_INVALID');

  if(status===401)return Object.freeze({ok:false,code:'YANDEX_REPLY_HTTP_401'});
  if(status===403||status===488)return Object.freeze({ok:false,code:'YANDEX_REPLY_CSRF_REJECTED'});
  if(status>=300&&status<400)
    return Object.freeze({ok:false,code:'YANDEX_REPLY_REDIRECT'});
  if(status===429)return Object.freeze({ok:false,code:'YANDEX_REPLY_RATE_LIMITED'});
  if(status!==200)return Object.freeze({ok:false,code:'YANDEX_REPLY_HTTP_ERROR'});

  if(/^\s*</.test(text))
    return Object.freeze({ok:false,code:/captcha|challenge|smartcaptcha/i.test(text)?
      'YANDEX_REPLY_CHALLENGE':'YANDEX_REPLY_HTML'});
  if(text!=='OK')return Object.freeze({ok:false,code:'YANDEX_REPLY_RESPONSE_DRIFT'});

  return Object.freeze({ok:true,code:'YANDEX_REPLY_ACCEPTED'});
}
