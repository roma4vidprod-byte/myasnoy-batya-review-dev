function esc(value=''){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

export function emailConfig(){
  return {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.REVIEW_EMAIL_FROM || '',
    adminTo: process.env.NEGATIVE_REVIEW_EMAIL_TO || ''
  };
}

export function isEmailConfigured(){const c=emailConfig();return Boolean(c.apiKey&&c.from)}

export async function sendResendEmail({to,subject,html,text,idempotencyKey}){
  const {apiKey,from}=emailConfig();
  if(!apiKey||!from) return {status:'NOT_CONFIGURED'};
  const recipients=(Array.isArray(to)?to:String(to||'').split(',')).map(v=>String(v).trim()).filter(Boolean);
  if(!recipients.length) return {status:'NOT_CONFIGURED'};
  const headers={Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'};
  if(idempotencyKey) headers['Idempotency-Key']=String(idempotencyKey).slice(0,256);
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers,signal:AbortSignal.timeout(10000),redirect:'error',body:JSON.stringify({from,to:recipients,subject,html,text})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error){const e=new Error(data.message||data.error?.message||'RESEND_SEND_FAILED');e.status=response.status;e.details=data;throw e}
  return {status:'SENT',emailId:data.id||null};
}

export async function sendNegativeFeedbackEmail({reason,text,contact,feedbackId}){
  const {adminTo}=emailConfig();
  if(!adminTo) return {status:'NOT_CONFIGURED'};
  const time=new Date().toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg'});
  const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1F2933"><h2>🔴 Негативная обратная связь</h2><p><b>Причина:</b> ${esc(reason)}</p><p><b>Комментарий:</b><br>${esc(text).replace(/\n/g,'<br>')}</p><p><b>Контакт:</b> ${esc(contact||'не указан')}</p><p><b>ID обращения:</b> ${esc(feedbackId||'')}</p><p><b>Время:</b> ${esc(time)}</p><hr><p style="font-size:12px;color:#6B7280">Мясной Батя · Review Activator</p></div>`;
  return sendResendEmail({to:adminTo,subject:`Негативный отзыв · ${reason}`,html,idempotencyKey:`negative-feedback/${feedbackId}`});
}

export async function sendPromoEmail({to,promoCode,rewardLabel,sessionId,expiresAt}){
  const expiry=expiresAt?new Date(expiresAt).toLocaleDateString('ru-RU'):null;
  const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1F2933"><h2>Спасибо за отзыв!</h2><p>Ваш отзыв опубликован. Для вас подготовлен подарок от «Мясного Бати».</p><div style="font-size:28px;font-weight:700;padding:18px;border:1px solid #DDE3E6;border-radius:14px;text-align:center">${esc(promoCode)}</div>${rewardLabel?`<p><b>Подарок:</b> ${esc(rewardLabel)}</p>`:''}${expiry?`<p><b>Действует до:</b> ${esc(expiry)}</p>`:''}<p style="font-size:12px;color:#6B7280">Покажите промокод при получении подарка. Один промокод используется один раз.</p></div>`;
  return sendResendEmail({to,subject:'Ваш подарок от «Мясного Бати»',html,idempotencyKey:`promo/${sessionId}`});
}
