import { EvidenceError } from "./individual-report-acceptance/contract";
import { bundle, loadBundle, loadPlan } from "./individual-report-acceptance/evidence";
import { evaluate } from "./individual-report-acceptance/evaluate";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const allowed = command === "bundle" ? ["--plan", "--expected-plan-sha256", "--out"]
    : command === "inspect" ? ["--plan", "--expected-plan-sha256"]
    : command === "evaluate" ? ["--bundle", "--expected-plan-sha256"] : [];
  const flags = new Map<string, string>();
  if (!allowed.length || args.length !== allowed.length * 2) throw new EvidenceError("ARGUMENTS_INVALID");
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new EvidenceError("ARGUMENTS_INVALID");
    flags.set(args[i], args[i + 1]);
  }
  const pin = flags.get("--expected-plan-sha256")!;
  if (command === "bundle") {
    await bundle(flags.get("--plan")!, pin, flags.get("--out")!);
    process.stdout.write(`${JSON.stringify({ status: "BUNDLED", acceptance: "NOT_EVALUATED", plan_sha256: pin })}\n`);
    return;
  }
  const loaded = command === "evaluate" ? await loadBundle(flags.get("--bundle")!, pin)
    : await loadPlan(flags.get("--plan")!, pin);
  const decision = evaluate(loaded.plan, loaded.objects);
  process.stdout.write(`${JSON.stringify({ ...decision, plan_sha256: pin })}\n`);
  process.exitCode = decision.decision === "REVIEW_PASS" ? 0 : 1;
}
main().catch((error: unknown) => {
  // Do not print filenames, input values, review quotations, credentials or stack traces.
  const code = error instanceof EvidenceError ? error.code : "LOCAL_IO_ERROR";
  process.stdout.write(`${JSON.stringify({ decision: "HOLD", reasons: [code] })}\n`);
  process.exitCode = 1;
});
