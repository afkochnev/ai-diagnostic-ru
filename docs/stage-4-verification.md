# Stage 4 verification

Stage 4 adds the approved RU-1.0 methodology and the first resumable diagnostic flow. The CSV remains the source of truth; `scripts/generate_methodology_seed.py` deterministically generates the SQL seed migration and preserves question provenance.

Local migration application used `supabase db push --local`; no destructive database reset was run for Stage 4.

Control counts in the database are 10 blocks, 84 questions, 80 `scale_0_4`, 4 `text`, 82 required, 2 optional, 84 active and 84 `reverse_score=false`. Scale options are stored as internal `0..4` values with Russian labels `1..5`.

The diagnostic lifecycle is `in_progress` only at this stage. A partial unique index permits one active attempt per company. The create operation returns the existing attempt on a repeated request. Answers use pinned `(question_id, version_id)` integrity, optimistic diagnostic revisions and mutation IDs. Server reads and writes verify the authenticated owner; RLS covers methodology, diagnostics, answers and mutations.

Checks:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `SUPABASE_TELEMETRY_DISABLED=1 npx supabase test db` — 45 tests
- `CI=1 npx playwright test` — 11 tests across mobile, tablet and desktop

Stage 5 scoring, final submit, AI, PDF and Admin UI are not included.
