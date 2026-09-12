import "server-only";

const allowed = /^\/ru\/admin\/(?:leads(?:\/|$)|companies(?:\/|$)|users(?:\/|$)|diagnostics(?:\/|$)|feedback(?:\/|$))/;
export function safeAdminReturnTo(value: string | undefined, fallback: string) {
  if (!value || value.length > 2000 || !value.startsWith("/") || value.startsWith("//") || /^(?:https?:|javascript:)/i.test(value) || !allowed.test(value)) return fallback;
  return value;
}
