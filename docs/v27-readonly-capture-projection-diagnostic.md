# Read-only capture B projection diagnostics

The existing `d6fb3589` diagnostic GET stopped with `PROJECTION`. Its bounded
response was deliberately not retained. The original rejection cannot be
reconstructed, and this change does not assign it a new cause retroactively.
The spent read remains `UNKNOWN_SPENT_STOP` and acceptance remains
`V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE`.

The offline helper `scripts/operator-w2/read-only-diagnostic-projection.ts`
keeps the previous strict raw/job envelope, exact field allowlists, job bindings,
timestamp checks, log categories, row sentinel and safe-integer event codec.
It adds finite rejection codes for those existing checks. An extra field still
rejects the response; its name or value is never exported. Only errors owned by
the helper's private WeakMap can supply a projection code. Arbitrary caught
properties, messages and prototype chains are not used as evidence.

The separately prepared local caller adapter distinguishes those errors from
`POST_PROJECTION_INTEGRITY`, `POST_PROJECTION_DEADLINE`,
`POST_PROJECTION_ABORTED` and `PROJECTED_DATA_FREEZE`. A classified failure still
spends the read, stops later requests and preserves HOLD. Generic unclassified
errors remain finite HOLD codes. Neither a code nor time correlation establishes
the original B failure's root cause or acceptance success.

This helper has no filesystem, credential, transport, journal or authorization
API. The existing Docker ignore rule excludes this offline operator path; it is
not imported by web/worker runtime code. Application authentication, evidence
crypto, migrations, gates, and canonical journals are unchanged.

Current validation is local/mock only. The revised local adapter explicitly
rejects hosted execution with `HOSTED_PACKAGE_NOT_BOUND`. It does not reuse the
old authorization, namespace, read slot or budget. A future hosted package,
reviewed source bindings, independent namespace and explicit owner authorization
are separate work. This patch creates none of them and performs no provider GET.
