import "server-only";
import { authCaptchaConfig } from "@/server-runtime/auth-captcha";

/** Supabase validates the single-use token against the configured provider. */
export function readAuthCaptcha(form: FormData): { captchaToken?: string; error?: string } {
  const config = authCaptchaConfig();
  if (!config.enabled) return {};
  if (!config.configured) return { error: "Проверка защиты временно недоступна. Попробуйте позже." };
  const token = form.get("auth_captcha_token");
  if (typeof token !== "string" || !token.trim() || token.length > 2048) {
    return { error: "Дождитесь проверки защиты от ботов и повторите отправку." };
  }
  return { captchaToken: token.trim() };
}
