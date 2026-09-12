function decimal(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return "—";
  return numberValue.toLocaleString("ru-RU", { maximumFractionDigits: 1, useGrouping: false });
}

export function formatDecimalRu(value: number | string | null | undefined): string {
  return decimal(value);
}

export function formatPercentRu(value: number | string | null | undefined): string {
  return `${decimal(value)}%`;
}

export function formatIntegerRu(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue)) return decimal(value);
  return numberValue.toLocaleString("ru-RU", { useGrouping: false });
}
