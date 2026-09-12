// Run with `node --env-file=.env.local --import tsx ...` so this uses the
// same server environment as the Next.js process without adding a dotenv
// runtime dependency.
async function main() {
  const once = process.argv.includes("--once");
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret) throw new Error("INTERNAL_WORKER_SECRET is required");
  const url = process.env.APP_URL ?? "http://127.0.0.1:3000";
  const run = async () => {
    const response = await fetch(`${url}/api/internal/workers/consultation`, {
      method: "POST",
      headers: { "x-worker-secret": secret },
    });
    if (!response.ok) throw new Error(`worker_http_${response.status}`);
    console.log(JSON.stringify(await response.json()));
  };
  await run();
  if (!once) {
    setInterval(() => void run().catch((error) => console.error("consultation-worker", error instanceof Error ? error.message : "failed")), 30000);
  }
}

main().catch((error) => {
  // Error messages are restricted to local status/configuration identifiers.
  console.error("consultation-worker", error instanceof Error ? error.message : "failed");
  process.exitCode = 1;
});
