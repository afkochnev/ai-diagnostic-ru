import ru from "@/messages/ru.json";
import en from "@/messages/en.json";
import type { Locale } from "./config";

export type Messages = typeof ru;
const dictionaries: Record<Locale, Messages> = { ru, en };

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}
