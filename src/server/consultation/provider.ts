import { z } from "zod";
import { ConsultationDeliveryError, consultationProviderMode, consultationResendConfig } from "./config";

export type ConsultationNotification = { to: string; subject: string; text: string; idempotencyKey: string };
export type ConsultationSendResult = { providerMessageId: string | null };
export interface ConsultationProvider { readonly name: string; send(message: ConsultationNotification): Promise<ConsultationSendResult>; }

class ResendConsultationProvider implements ConsultationProvider {
  readonly name = "resend";
  async send(message: ConsultationNotification): Promise<ConsultationSendResult> {
    const { key, from } = consultationResendConfig();
    if (!z.email().safeParse(message.to).success || !message.idempotencyKey || message.idempotencyKey.length > 256 || /[\r\n]/.test(message.idempotencyKey)) throw new ConsultationDeliveryError("consultation_message_invalid", false);
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey }, body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }), cache: "no-store", signal: AbortSignal.timeout(15000) });
    } catch { throw new ConsultationDeliveryError("consultation_provider_unavailable", true); }
    if (!response.ok) throw new ConsultationDeliveryError(`consultation_provider_${response.status}`, response.status >= 500 || [408, 409, 425, 429].includes(response.status));
    const data = await response.json().catch(() => null) as { id?: unknown } | null;
    if (typeof data?.id !== "string" || !data.id.trim()) throw new ConsultationDeliveryError("consultation_provider_receipt_missing", false);
    return { providerMessageId: data.id };
  }
}

export class MockConsultationProvider implements ConsultationProvider {
  readonly name = "mock";
  static sent: ConsultationNotification[] = [];
  async send(message: ConsultationNotification): Promise<ConsultationSendResult> { MockConsultationProvider.sent.push(message); return { providerMessageId: `mock-consultation-${MockConsultationProvider.sent.length}` }; }
}

export function getConsultationProvider(): ConsultationProvider { return consultationProviderMode() === "mock" ? new MockConsultationProvider() : new ResendConsultationProvider(); }
