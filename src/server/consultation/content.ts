export function buildConsultationNotification(input: { companyName: string; name: string; email: string; contactType: string | null; contactValue: string | null; comment: string | null }) {
  return {
    subject: `Новая заявка на консультацию — ${input.companyName}`,
    text: [`Новая заявка на консультацию.`, `Компания: ${input.companyName}`, `Имя: ${input.name}`, `Email: ${input.email}`, input.contactType && input.contactValue ? `${input.contactType === "phone" ? "Телефон" : "Telegram"}: ${input.contactValue}` : null, input.comment ? `Комментарий: ${input.comment}` : null].filter(Boolean).join("\n"),
  };
}
