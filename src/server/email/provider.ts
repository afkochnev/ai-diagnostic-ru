import "server-only";

export type EmailMessage = { to: string; subject: string; text: string; attachment: { filename: string; contentBase64: string } };
export type EmailSendResult = { providerMessageId: string | null };

export interface EmailProvider { readonly name: string; send(message: EmailMessage): Promise<EmailSendResult>; }

class ResendProvider implements EmailProvider {
  readonly name = "resend";
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) throw new Error("email_provider_not_configured");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, attachments: [{ filename: message.attachment.filename, content: message.attachment.contentBase64 }] }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`email_provider_${response.status}`);
    const data = await response.json() as { id?: string };
    return { providerMessageId: data.id ?? null };
  }
}

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  static sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<EmailSendResult> { MockEmailProvider.sent.push(message); return { providerMessageId: `mock-${MockEmailProvider.sent.length}` }; }
}

export function getEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "mock" ? new MockEmailProvider() : new ResendProvider();
}
