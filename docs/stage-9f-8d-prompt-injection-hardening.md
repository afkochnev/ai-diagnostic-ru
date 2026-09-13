# Stage 9F.8D — Prompt Injection Hardening

The AI report path now treats company profiles, snapshots, answers, question text, and every other persisted user supplied string as untrusted data. Trusted instructions are kept in the system prompt and explicitly state that commands embedded in diagnostic data must be analyzed as content, never executed, and must not alter the schema, priorities, scoring, or disclosure boundaries.

Diagnostic input is passed in a `<UNTRUSTED_DIAGNOSTIC_DATA>` JSON envelope. Deterministic scores, maturity, block results, diagnostic identity, and report metadata remain authoritative server values. The new RU-1.3 prompt preserves the 12-section contract while tightening trust language and keeping executive prose concise.

Generated structured output is schema parsed and then checked for targeted instruction leakage patterns (including Russian and English requests to ignore instructions, expose prompts, or reproduce injected text). A violation fails the worker generation; the previous completed report remains selected by D13 semantics, and raw provider output is not exposed.

Adversarial unit coverage includes multilingual priority overrides, verbatim inclusion requests, prompt disclosure, schema manipulation, and benign business language. Real-provider retesting remains a separate controlled staging operation; no provider call is made by this change.

## RU-1.3 packaging incident

The first remote RU-1.3 regeneration (v7) failed before provider execution because the final worker image did not contain `AI_REPORT_PROMPT_RU_1_3.md`; the loader resolved prompts from `/app`, while the Dockerfile copied only RU-1.0 through RU-1.2. Version 7 remains failed historical evidence and was not modified. The runtime stage now copies RU-1.3 alongside the historical assets, and tests assert source existence and the final-image copy instruction before deployment.
