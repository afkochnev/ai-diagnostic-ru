import { z } from "zod";

export class ConsultationDeliveryError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) { super(code); }
}

const email = z.email();
export function consultationProviderMode() {
  const mode = process.env.EMAIL_PROVIDER ?? "resend";
  if (mode !== "mock" && mode !== "resend") throw new ConsultationDeliveryError("consultation_provider_invalid", false);
  return mode;
}

export function consultationDestination() {
  const destination = process.env.CONSULTATION_NOTIFICATION_EMAIL?.trim();
  if (!destination) throw new ConsultationDeliveryError("consultation_destination_not_configured", false);
  if (!email.safeParse(destination).success) throw new ConsultationDeliveryError("consultation_destination_invalid", false);
  return destination;
}

export function consultationResendConfig() {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) throw new ConsultationDeliveryError("consultation_provider_not_configured", false);
  const address = from.match(/^[^<>\r\n]+<([^<>\r\n]+)>$/)?.[1] ?? from;
  if (/[\r\n]/.test(from) || !email.safeParse(address).success) throw new ConsultationDeliveryError("consultation_sender_invalid", false);
  return { key, from };
}
