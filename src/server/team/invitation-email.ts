import { createTransactionalProvider } from "@/server/consultation/provider";
export function getTeamInvitationProvider() {
  const mode=process.env.TEAM_INVITATION_EMAIL_PROVIDER ?? process.env.EMAIL_PROVIDER ?? "resend";
  if(mode!=="mock" && mode!=="resend") throw new Error("team_email_provider_invalid");
  return createTransactionalProvider(mode);
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function teamInvitationMessage(input:{company:string;team:string;inviter:string;url:string;singleEmail?:boolean}) {
  const intro=`${input.inviter} / ${input.company} приглашает вас пройти командную диагностику AI Company Audit.`;
  const privacy="Организатор видит статус прохождения, но не ваши индивидуальные ответы.";
  const expiry=input.singleEmail?"Ссылка для входа действует 30 минут. Пароль не нужен: после согласия откроется ваша анкета.":"Ссылка приглашения действует 7 дней.";
  return {
    subject:`Приглашение в командную диагностику — ${input.company}`,
    text:`${intro}\n\n${input.team}\n\n${privacy}\n\nПринять приглашение: ${input.url}\n\n${expiry} Не пересылайте письмо. Если вы не ожидали приглашение, проигнорируйте его.`,
    html:`<h1>Вас пригласили пройти командную диагностику</h1><p>${escape(intro)}</p><h2>${escape(input.team)}</h2><p>${privacy}</p><p><a style="display:inline-block;padding:14px 22px;background:#315c73;color:white;text-decoration:none;border-radius:8px" href="${escape(input.url)}">Принять приглашение</a></p><p>${expiry} Не пересылайте письмо. Если вы не ожидали приглашение, проигнорируйте его.</p>`,
  };
}
