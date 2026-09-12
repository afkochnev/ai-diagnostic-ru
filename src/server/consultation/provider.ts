
export type ConsultationNotification = { to: string; subject: string; text: string };
export type ConsultationSendResult = { providerMessageId: string | null };
export interface ConsultationProvider { readonly name: string; send(message: ConsultationNotification): Promise<ConsultationSendResult>; }

class ResendConsultationProvider implements ConsultationProvider {
  readonly name = "resend";
  async send(message: ConsultationNotification): Promise<ConsultationSendResult> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) throw new Error("consultation_provider_not_configured");
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }), cache: "no-store" });
    if (!response.ok) throw new Error(`consultation_provider_${response.status}`);
    const data = await response.json() as { id?: string };
    return { providerMessageId: data.id ?? null };
  }
}

export class MockConsultationProvider implements ConsultationProvider {
  readonly name = "mock";
  static sent: ConsultationNotification[] = [];
  async send(message: ConsultationNotification): Promise<ConsultationSendResult> { MockConsultationProvider.sent.push(message); return { providerMessageId: `mock-consultation-${MockConsultationProvider.sent.length}` }; }
}

export function getConsultationProvider(): ConsultationProvider { return process.env.EMAIL_PROVIDER === "mock" ? new MockConsultationProvider() : new ResendConsultationProvider(); }
