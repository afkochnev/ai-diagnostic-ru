# Offline staging CLI ESM admission source

The controlled staging acceptance launcher stopped locally with Node exit 13 because its CLI bootstrap awaited a bundle that statically imported the still-evaluating bootstrap. `entry-cli.mjs` now owns direct execution; `entry-bootstrap.mjs` is inert and finishes evaluation before the CLI calls `bootstrapMain`. The bundle must externally import that same exact admission module, preserving one private one-use WeakMap. No token issuer, fallback, mock port or new secret is added to hosted code.

The CLI and inert admission sources are copied byte-for-byte from the reviewed local ESM fix. The process-test loader adds only an exact test-only bundle-URL resolution hook because the operator bundle is deliberately absent from Git; the existing in-memory load hook still supplies all mock execution ports. They preserve its fixed historical `4ddb9337d7d6ec18936009ef7277927b38ea2a17` / plan guard. Publishing them is **not an executable acceptance package for the new application head**. No bundle, launch config, authority, owner approval, credentials, fresh proof or admission is published here. A future separately reviewed package must pin the new exact application SHA, both CLI/admission before Node starts, and independently versioned namespaces. It must retain every spent record and obtain separate hosted authorization. Do not invoke a prior spent admission.

The source remains offline-only. The existing `.dockerignore` excludes this directory; CI also asserts its absence from the application build image. Only a read-only bind mount in a `--network none` test container exposes these files for mock regression checks. No runtime allowlist, image dependency, application authentication, evidence-channel crypto, migration or canonical journal contract changes.

Run the focused checks:

```sh
node --experimental-vm-modules --test scripts/operator-w2/safe-stage-cli/entry-bootstrap-v2.test.mjs scripts/operator-w2/safe-stage-cli/real-cli-process.test.mjs
```

58 admission VM cases and 20 real Node process cases cover the direct CLI/module graph, one-use opaque token, exact startup path, guard failures, spent admission refusal, inert imports and generic HOLD handling. The child-process preload is strictly test-only: filesystem, Git, process admission metadata and execution ports live in a synthetic Map; only the exact CLI/bootstrap source files are read from disk. It is never imported by the offline CLI or application runtime. A synthetic positive process exits 0 without the previous exit 13. It does not constitute hosted acceptance or permission to read protected values.

The prior local packet additionally had 20 unchanged entry-composition VM cases (98 focused checks total); those local operator/bundle dependencies are deliberately not republished as application runtime. The new canonical ESM-focused CI checks are 78. Full unit/lint/typecheck, actual Docker build and network-disabled runtime/import checks remain required on the new exact PR head.

Hosted status remains `V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE`. Do not deploy, reserve hosted slots, run capability/A/B or W2, grant Advanced, issue/verify Auth, send mail, run AI/PDF/YooKassa, merge the PR, or mutate production as part of this source publication.
