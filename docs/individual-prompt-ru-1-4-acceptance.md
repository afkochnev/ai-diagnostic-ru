# RU-1.4 staging acceptance

This is a bounded acceptance plan, not an assertion that model output always satisfies the contract. Keep the canonical PR draft/unmerged until review. No production release, customer regeneration or PDF is authorized by this plan.

## Frozen inputs and boundaries

`tests/fixtures/individual-prompt-ru-1-4.json` contains two entirely invented profiles and eight-block result sets. No customer names, answers, report text, identifiers or credentials are included. Send only each case's `input` to OpenAI, not its evaluation notes. Preserve the existing model (`gpt-5.6-sol`), schema RU-1.0 and untrusted-data envelope.

The sparse case checks whether aggregate scores are incorrectly turned into observed delays, missing controls or proven execution capabilities. The existing-controls case explicitly reports process owners, monthly indicators and no recorded decision delays; those statements must survive interpretation. Revenue targets remain targets.

Before any staging mutation, verify the exact staging service/project identities, live commits, disabled automatic deploys, empty queues/leases, billing OFF and preservation commitments. Build a separate carrier on the verified live staging parent with exactly the canonical delta; never merge a staging carrier into main. Do not modify service secrets, provider mode, production FREE_SMOKE controls, Team/W2, scoring or PDF templates.

## Separate routing from text quality

1. Run regression tests and exact-head CI. Check new v1/v2/vN rows use current RU-1.4, active historical RU-1.3 is retained, and queued historical versions dispatch their persisted prompt without fallback. Mock responses only establish routing.
2. Deploy the reviewed carrier to staging and verify both live SHAs. Read/hash all historical prompt assets, the new prompt and schema from the actual final runtime; a Docker build-stage success or a Dockerfile substring alone does not establish runner packaging.
3. Exercise ordinary synthetic enqueue/recovery with the existing mock worker, preserving prior rows/jobs and other staging commitments. Use fresh fixture IDs. Do not reuse or edit completed acceptance fixtures.
4. Evaluate the two frozen synthetic inputs separately in a staging-only process using the exact mounted RU-1.4 prompt and schema. Use the official OpenAI endpoint, `store: false`, `maxRetries: 0`, an explicit output-token cap and timeout, and at most one request per case. Stop on failure or a failed quality check; do not regenerate until PASS. Do not change shared worker provider mode. This process evaluates prompt semantics; it does not claim an ordinary real-provider job completed.
5. Save the unedited output and prompt/input/code commitments, request-ID presence, model, request count and terminal outcome outside Git. Never print or persist credentials. No editorial repair before review.

## Acceptance rubric

- Exact 12 keys, valid RU-1.0 schema, nonempty Russian text and unchanged numeric facts, maturity, all eight block names/scores and derived groups. Check source paths for factual claims.
- Every substantial diagnostic interpretation is locally identified as a conclusion or hypothesis from the supplied evidence; missing facts are not asserted. Conditional risk chains do not describe hypothetical symptoms as observed events. Recommendations and expected results do not presume an unestablished starting state.
- Summary: 4–6 meaningful sentences. Diagnosis, index interpretation and growth constraint: at least two substantive paragraphs each. Strengths/problem zones: 3–4 items; risks/first actions: 4–5. Plans: 5–7 distinct items per horizon, each with result and control point. Next step: 1–2 paragraphs about one action startable within five working days.
- Evidence leads to useful interpretation, business consequence, verification and action. Mere presence of words such as “гипотеза” or “может” is not a semantic pass. No invented staff, processes, KPI, markets, achieved revenue, capabilities or unexplained causes. No prompt leakage, English meta labels or Markdown tables.
- Independently read every section of each unedited provider output. Record PASS/FAIL and concrete exceptions; correct routing or a locally edited report is not evidence of model-quality acceptance.

Afterward verify empty queues/leases, unchanged historical/business/Team/PDF commitments, unchanged service configuration and no production operations. A pass is limited to the reviewed cases and exact prompt/model/code; it is not a guarantee for other inputs. Any production deploy, customer regeneration or PDF requires separate explicit authorization.
