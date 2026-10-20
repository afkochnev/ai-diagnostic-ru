/** Local integration helper: private synthetic stdin, safe diagnostics only. */
import { inspectSynthesisPrivacy, privacyCorpusSchema } from "../src/server/team/synthesis-privacy";
async function main() {
  let raw="";for await(const chunk of process.stdin)raw+=chunk;
  const input=JSON.parse(raw);raw="";
  process.stdout.write(JSON.stringify(inspectSynthesisPrivacy(input.output,privacyCorpusSchema.parse(input.corpus))));
}
void main().catch(()=>{process.stderr.write("local_privacy_inspection_failed\n");process.exitCode=1;});
