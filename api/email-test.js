import { emailConfig, sendResendEmail } from './_email.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const c=emailConfig();
  if(!c.apiKey||!c.from||!c.adminTo) return res.status(200).json({ok:false,configured:false,missing:[!c.apiKey?'RESEND_API_KEY':null,!c.from?'REVIEW_EMAIL_FROM':null,!c.adminTo?'NEGATIVE_REVIEW_EMAIL_TO':null].filter(Boolean)});
  try{
    const out=await sendResendEmail({to:c.adminTo,subject:'✅ Мясной Батя — тест почты',html:'<p><b>Review Activator</b></p><p>Почтовые уведомления подключены и работают.</p>',idempotencyKey:`email-test/${new Date().toISOString().slice(0,13)}`});
    return res.status(200).json({ok:true,configured:true,sent:out.status==='SENT',emailId:out.emailId||null});
  }catch(error){
    console.error('email test failed',error.message);
    return res.status(error.status||502).json({ok:false,configured:true,error:'EMAIL_SEND_FAILED'});
  }
}
