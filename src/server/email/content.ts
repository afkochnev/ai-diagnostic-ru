export function buildReportEmail(input: { companyName: string; index: string; maturity: string; filename: string; contentBase64: string }) {
  return {
    to: "",
    subject: `Ваш отчёт — Управленческий AI-аудит компании «${input.companyName}»`,
    text: `Здравствуйте!\n\nДиагностика компании «${input.companyName}» завершена.\nВо вложении — ваш аналитический отчёт «Управленческий AI-аудит компании».\n\nИндекс управляемости: ${input.index}\nУровень зрелости: ${input.maturity}\n\nС уважением,\nУправленческий AI-аудит компании`,
    attachment: { filename: input.filename, contentBase64: input.contentBase64 },
  };
}
