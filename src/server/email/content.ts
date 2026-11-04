export function buildReportEmail(input: { companyName: string; index: string; maturity: string; filename: string; contentBase64: string; locale?: "ru" | "en"; reportUrl?: string }) {
  if (input.locale === "en") {
    if (!input.reportUrl) throw Error("email_report_url_missing");
    return {
      to: "",
      subject: `Your management audit report — ${input.companyName}`,
      text: `Hello!\n\nThe diagnostic for ${input.companyName} is complete. Your AI Company Audit report is attached as a PDF.\n\nManagement index: ${input.index}\nMaturity level: ${input.maturity}\n\nOpen your saved result: ${input.reportUrl}\nSign in with the email address used for this diagnostic.\n\nAI Company Audit`,
      attachment: { filename: input.filename, contentBase64: input.contentBase64 },
    };
  }
  return {
    to: "",
    subject: `Ваш отчёт — Управленческий AI-аудит компании «${input.companyName}»`,
    text: `Здравствуйте!\n\nДиагностика компании «${input.companyName}» завершена.\nВо вложении — ваш аналитический отчёт «Управленческий AI-аудит компании».\n\nИндекс управляемости: ${input.index}\nУровень зрелости: ${input.maturity}\n\nС уважением,\nУправленческий AI-аудит компании`,
    attachment: { filename: input.filename, contentBase64: input.contentBase64 },
  };
}
