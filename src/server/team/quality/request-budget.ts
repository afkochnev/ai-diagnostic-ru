import type { Stage } from "./runtime";

export type RequestByteCaps=Record<Stage,number>;
// FoodTech's full 80-question input is larger than the short synthetic fixtures.
// Redistribute the same aggregate input liability; do not truncate evidence.
export const foodtechRequestByteCaps:RequestByteCaps={
  baseline_synthesis:32000,baseline_report:160000,extract:20000,
  combined:180000,diagnose:80000,program:100000,core:160000,
  dynamics:100000,review:220000,privacy_repair:108000,
};
export type BudgetReason="request_size"|"call_limit"|"cost_limit"|"deadline"|"usage_limit";
export class QualityBudgetError extends Error {
  constructor(readonly reason:BudgetReason,readonly stage:Stage,readonly bytes:number,readonly byteLimit:number){super("quality_budget_exhausted");}
  safeDetails(){return {reason:this.reason,stage:this.stage,requestBytes:this.bytes,maximumRequestBytes:this.byteLimit};}
}
