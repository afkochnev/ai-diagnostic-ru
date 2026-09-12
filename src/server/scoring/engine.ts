import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type ScoringQuestion = { id: string; weight: number | string; reverse_score: boolean; is_required: boolean; is_active: boolean; answer_type: "scale_0_4" | "text"; };
export type ScoringAnswer = { question_id: string; numeric_value: number | string | null; text_value?: string | null };
export type BlockInput = { block_id: string; block_weight: number | string; questions: ScoringQuestion[]; answers: ScoringAnswer[] };
export type BlockScore = { block_id: string; raw: Decimal; display: Decimal; };

export function calculateBlockScore(input: BlockInput): BlockScore {
  const answers = new Map(input.answers.map((a) => [a.question_id, a]));
  const questions = input.questions.filter((q) => q.is_active && q.answer_type === "scale_0_4");
  let numerator = new Decimal(0); let denominator = new Decimal(0);
  for (const q of questions) {
    const value = answers.get(q.id)?.numeric_value;
    if (value === null || value === undefined) throw new Error(`Missing answer: ${q.id}`);
    const stored = new Decimal(value); const effective = q.reverse_score ? new Decimal(4).minus(stored) : stored;
    numerator = numerator.plus(effective.times(q.weight)); denominator = denominator.plus(new Decimal(4).times(q.weight));
  }
  const raw = denominator.isZero() ? new Decimal(0) : numerator.div(denominator).times(100);
  return { block_id: input.block_id, raw, display: raw.toDecimalPlaces(1, Decimal.ROUND_HALF_UP) };
}

export function calculateOverall(blocks: Array<BlockScore & { block_weight: number | string }>) {
  let numerator = new Decimal(0); let denominator = new Decimal(0);
  for (const b of blocks) { numerator = numerator.plus(b.raw.times(b.block_weight)); denominator = denominator.plus(b.block_weight); }
  const raw = denominator.isZero() ? new Decimal(0) : numerator.div(denominator);
  return { raw, display: raw.toDecimalPlaces(1, Decimal.ROUND_HALF_UP) };
}

export function classifyMaturity(raw: Decimal | number | string): 1 | 2 | 3 | 4 | 5 {
  const value = new Decimal(raw);
  if (value.lessThan(30)) return 1; if (value.lessThan(50)) return 2; if (value.lessThan(70)) return 3; if (value.lessThan(85)) return 4; return 5;
}

export function mapDisplayScore(display: number): number { if (!Number.isInteger(display) || display < 1 || display > 5) throw new Error("Display score must be 1..5"); return display - 1; }
