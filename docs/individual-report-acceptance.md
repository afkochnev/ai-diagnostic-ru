# Offline Individual RU-1.4 review evidence

This optional CLI checks a frozen, local synthetic evaluation. It never calls a
provider, reads `.env` files, connects to a database, starts a worker, creates a PDF
or grants deployment permission. It is separate from the application runtime.

`REVIEW_PASS` means that the pinned evidence is complete and all registered native
reviews agree on PASS. The program cannot decide whether a claim in Russian is
true, whether an implication presupposes an unsupported baseline, or whether an
analysis is useful. Three separate semantic reviews remain necessary:

- **facts:** attribution to the source, numbers, explicit facts versus inferences;
- **depth:** meaningful analysis of all twelve sections and the RU-1.4 rubric;
- **boundary:** hidden assumptions, implied continuity/adequacy, and counterexamples.

Reviewer IDs are operator declarations, not authenticated identities. The operator
must verify their independence and freeze the complete review inventory. Hashes
prove consistency with the chosen snapshot; they do not establish who authored a
file, that a provider ran, or that an omitted review does not exist. A dishonest or
incomplete trusted plan can defeat those human assurances. Do not describe this
tool as an automatic semantic oracle or a signed audit log.

## Freeze the plan before deciding

Use `individual-acceptance-plan/v1`, as defined by
`scripts/individual-report-acceptance/contract.ts`. Keep evidence outside Git.
All artifact paths are relative to the plan's directory, use portable ASCII path
components, and must name regular files without symlinks. Network references,
absolute paths, `..`, backslashes and duplicate JSON keys are rejected.

The plan contains:

- policy `individual-fact-boundary/v1`;
- one candidate: source commit, `RU-1.4`, prompt SHA-256, canonical schema SHA-256,
  and model `gpt-5.6-sol`;
- exact prompt and schema artifact descriptors `{path, sha256}`;
- three distinct declared reviewer IDs in `reviewers.{facts,depth,boundary}`;
- `review_inventory_complete`, an explicit operator attestation;
- exactly the two prescribed cases, `sparse-contrast` and
  `explicit-existing-controls`, each with frozen input, nullable raw receipt,
  review descriptors and explicit heads for all three roles.

Input files contain the input object itself. An artifact digest always hashes its
**exact bytes**, including whitespace and final newline. The provider record's
`input_sha256` instead follows the existing `SHA256(JSON.stringify(raw.input))`
convention, preserving property insertion order. The validator also compares the
parsed raw input and frozen input recursively with sorted object keys. These are
three separate checks; do not substitute one digest convention for another.

A raw receipt retains its original `output_text` string and provenance fields:
`case_id`, `input`, `input_sha256`, `candidate_source_commit`, `prompt_sha256`,
`schema_sha256`, `model_requested`, `model_returned`, `response_status`,
`request_count`, `max_retries`, `store`, `synthetic_only`, `host_runtime_commit`,
`harness_sha256`, `mounted_prompt_sha256`. This v1 tool accepts completed, single
request synthetic receipts without retries or storage. Host runtime, candidate
source and evaluated prompt are separate; a side-loaded candidate prompt can
differ from the mounted prompt. The receipt only **records** these runtime claims;
the tool does not verify a deployment or recover a harness from its digest.

Each review descriptor has `{path, sha256, role, format}`. Native format is
`native/v1`. `review_heads` names exact native review blob hashes, or null for a
missing role. No filename, modification time or array order chooses the effective
review. Include every known revision, including negative and superseded ones.

Compute the plan's SHA-256 externally and retain it in the trusted review record.
Pass that pin explicitly on every invocation. Replacing the plan, reducing its
review inventory, or switching its head changes the pin and requires another
operator review. A pin supplied from the same untrusted bundle offers no such
assurance. A PASS receipt is scoped to that exact pin; it is stale after a new
review is registered. There is no global registry or automatic discovery of new
reviews in this local tool.

## Native reviews

`individual-acceptance-review/v1` is strict and includes:

- `policy`, `role`, assigned `reviewer_id`, stable `review_id`, integer `revision`,
  and nullable `supersedes` (the previous review's full artifact SHA-256);
- `subject`: context hash, case ID, raw/output/input/prompt/schema digests,
  candidate source commit and model;
- overall `verdict` (`PASS`, `FAIL`, `HOLD`);
- `sections`: exactly the twelve unique schema section IDs, each with verdict
  and a nonempty rationale;
- `findings`: each with unique ID, section, report JSON pointer, exact quotation,
  at least one input JSON pointer and reason. Findings are unresolved in v1.

The context hash binds policy, candidate, assigned reviewer IDs and the complete
two-case input/raw commitments. It excludes review descriptors/heads to avoid a
circular hash. `contextHash(plan)` and `subjectFor(plan, caseId, rawBytes)` are
exported for review authoring. `subject.input_sha256` hashes frozen **file bytes**;
`subject.output_sha256` hashes the exact UTF-8 `output_text` string.

Reviewers must inspect the exact frozen input, prompt and response, give a reason
for each section, and record unsupported claims or assumptions as findings. A
quote must resolve within its declared section, and each input pointer must exist.
These pointer checks locate evidence; they cannot prove the stated reasoning.
For an omission finding, point to the relevant supplied source field and explain
what it does and does not establish. JSON pointers cannot address inherited keys.

Each role has one complete revision chain starting at revision 1, stable review
ID and consecutive revisions. Missing snapshots, competing branches, stale heads,
cycles and reused IDs across cases/roles cause HOLD. Changing a review file without
updating its trusted digest also causes HOLD.

**Every registered negative verdict, negative section or finding blocks PASS,
including in superseded revisions.** This conservative v1 has no adjudication
mechanism for overturning a rejection of the same output. A later PASS cannot
erase it. Missing evidence, disagreement and incomplete inventory also cause HOLD.

The structural check enforces the fixed twelve-key report schema and RU-1.4 list
and paragraph counts. Meaningful sentence count, factual support, recommendation
quality and analytic depth belong to the reviewers; no banned-word heuristic is
used to infer them.

## Commands

No command loads credentials. Run from a checkout with the project's development
dependencies installed. Replace the example paths and pin with independently
verified values:

```sh
npm run acceptance:individual -- inspect \
  --plan /private/tmp/individual-evidence/plan.json \
  --expected-plan-sha256 <64-lowercase-hex>

npm run acceptance:individual -- bundle \
  --plan /private/tmp/individual-evidence/plan.json \
  --expected-plan-sha256 <64-lowercase-hex> \
  --out /private/tmp/individual-sealed-new

npm run acceptance:individual -- evaluate \
  --bundle /private/tmp/individual-sealed-new \
  --expected-plan-sha256 <64-lowercase-hex>
```

`inspect` evaluates the source files read at that invocation. `bundle` copies
verified bytes to `objects/<sha256>`, preserves the exact plan, and refuses an
existing output directory. Packaging can succeed for incomplete or rejected
evidence: it prints `BUNDLED / NOT_EVALUATED`, never PASS. Evaluate the resulting
bundle separately. Directories use mode 0700; files use 0600. An interrupted write
may leave a partial directory; the plan is written last. Select a new directory
for a retry and handle partial evidence according to its sensitivity.

`inspect` and `evaluate` exit zero only for `REVIEW_PASS`, otherwise one for HOLD.
Their JSON contains fixed case IDs, reason codes and digests, without raw text,
input profiles, quotes, file paths or stack traces. The artifact-size limits range
from 32 KiB for the fixed schema to 1 MiB for a raw record. JSON depth and node
counts are bounded. This is a local validation tool, not an operating-system
sandbox against another process concurrently replacing directory components.

## Historical evidence and release boundary

`legacy-facts/v1`, `legacy-depth/v1` and `legacy-boundary/v1` read the existing
review blobs unchanged. They verify available raw/prompt bindings, explicit
twelve-section coverage and recorded verdict. A legacy FAIL remains a rejection;
a legacy PASS **always** remains incomplete under the native policy. Missing actor
identity, missing roles, missing old snapshots and absent per-section verdicts
must not be backfilled by an adapter. Legacy lineage is not authenticated by this
tool; retain the original history audit beside the bundle.

For the saved RU-1.4 series, the historical outcome is 2 PASS and 4 FAIL across six
responses. That history is not a new acceptance grant. The stricter offline replay
must show four rejected and two incomplete executed cases; unrun prescribed cases
remain incomplete. None of those candidates can receive `REVIEW_PASS`.

The authored PASS fixture in unit tests proves the validation mechanics only. It
is not a new provider response or a semantic endorsement of RU-1.4. Green CI for
this tool does not lift the HOLD on the prompt/carrier PRs, authorize a merge,
change production, or authorize another customer generation.
