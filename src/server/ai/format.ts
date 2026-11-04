export function formatDecimal(value: number | string | null | undefined, locale: "ru" | "en" = "ru"): string {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return "—";
  return numberValue.toLocaleString(locale === "en" ? "en-GB" : "ru-RU", { maximumFractionDigits: 1, useGrouping: false });
}

export function formatDecimalRu(value: number | string | null | undefined): string {
  return formatDecimal(value);
}

export function formatPercentRu(value: number | string | null | undefined): string {
  return `${formatDecimal(value)}%`;
}

export function formatIntegerRu(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue)) return formatDecimal(value);
  return numberValue.toLocaleString("ru-RU", { useGrouping: false });
}
