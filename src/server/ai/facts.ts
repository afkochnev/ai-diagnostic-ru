import { formatDecimalRu } from "./format";

export type AIBlockFact = { block_code: string; block_title: string; block_score_raw: number; block_score_display: string };
export function deriveBlockFacts(blockResultsInput: AIBlockFact[]) {
  if (blockResultsInput.length !== 8) throw new Error("scoring_block_count_invalid");
  const strongest = blockResultsInput.reduce((best, current) => current.block_score_raw > best.block_score_raw ? current : best, blockResultsInput[0]);
  const weakest = blockResultsInput.reduce((best, current) => current.block_score_raw < best.block_score_raw ? current : best, blockResultsInput[0]);
  return { strongest_block: { block_code: strongest.block_code, title: strongest.block_title, score_raw: strongest.block_score_raw, score_display: strongest.block_score_display }, weakest_block: { block_code: weakest.block_code, title: weakest.block_title, score_raw: weakest.block_score_raw, score_display: weakest.block_score_display }, block_score_spread: { raw: strongest.block_score_raw - weakest.block_score_raw, display: formatDecimalRu(strongest.block_score_raw - weakest.block_score_raw) }, blocks_below_60: blockResultsInput.filter((block) => block.block_score_raw < 60).map((block) => ({ title: block.block_title, score: block.block_score_display })), blocks_60_to_62_5_count: blockResultsInput.filter((block) => block.block_score_raw >= 60 && block.block_score_raw <= 62.5).length, blocks_70_plus: blockResultsInput.filter((block) => block.block_score_raw >= 70).map((block) => ({ title: block.block_title, score: block.block_score_display })) };
}
