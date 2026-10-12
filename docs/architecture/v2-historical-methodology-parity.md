# V2 historical methodology parity contract

Approved scope: V2.1R request, 2026-10-12. This exception concerns historical
methodology artifacts; it never excuses structural, authorization, scoring or
current-methodology drift.

## Historical exceptions

Manageability version 3 is an invalid published artifact in both environments.
Staging retains 10 blocks, 84 questions and one scoring policy but no maturity
levels. Production retains no blocks, questions, scoring policies or maturity
levels. Their UUIDs and child contents need not be made equal.

Neither version 3 is current: highest published selection chooses complete
version 4. The proposed lifecycle migrations retire v3; until separately
approved application of those migrations, remote v3 remains published and the
retirement gate is pending. After retirement it is ineligible for new
diagnostics, while owner-authorized diagnostics pinned to it retain access to
whatever historical content actually exists. Readability is not a claim that
an incomplete historical version can be completed or rescored successfully.

Never delete version 3, rewrite its children, change historical diagnostic IDs,
rescore history or regenerate reports to make parity pass. In particular,
production's missing children are not fabricated during reconciliation.

Version 2 is valid historical RU-2.0. Staging's
`stage12-1-mvp-question-bank-v2` and production's
`stage12-2f-ru-2-0-repair` content hashes record different construction provenance.
Hash differences are an approved historical artifact **only when full canonical
logical comparison passes**. Do not rewrite either hash. Configuration, wording,
weights, options, classification boundaries and translations are not exempt.

Version 4 is the canonical current RU-2.1 methodology and must be complete,
published and logically equivalent in both environments.

## Canonical comparison

Use `scripts/audit-methodology-parity.sql` and
`scripts/compare-methodology-parity.ts`. Compare by stable definition/version,
block/question/option/maturity keys and positions; ignore entity UUIDs,
timestamps and provenance-only content/policy hash fields. Include actual block
and question structure, active/required/reverse flags, weights, all translations,
answer options, scoring engine/version/schema/configuration and maturity
classification configuration. Missing translations or child rows fail the check.
Question content equality alone is insufficient.

Both v2 and v4 must have 10 total / 8 scoring blocks, 84 total / 80 scoring
questions, two company-info questions, two open questions, one scoring policy
and five maturity levels; required Russian translations must be present.
Organizational Structure question 3 must retain the approved old wording in v2
and corrected wording in v4.

## Gate to resume V2.1A

1. Structural schema and security objects match the reviewed repository and
   between staging/production: PASS.
2. Migration ledger matches after approved ledger-only repair and separately
   approved lifecycle migration application: PASS. Preserve originals; never
   execute obsolete 00100 just to fill a missing ledger row.
3. Version 4 canonical logical parity/completeness: PASS.
4. Version 2 canonical logical parity/completeness: PASS.
5. Version 3 is retired in both environments; its inventoried historical child
   contents remain unchanged, and owner-authorized pinned diagnostics remain
   readable. Differing retired v3 content is the documented exception.
6. New-diagnostic application selection resolves v4 and cannot choose v3.
7. Cleanup execute guard passes absent/0/false/1/invalid tests; no cleanup is
   executed to test this gate.

Historical diagnostic/result/report/user row counts and environment UUIDs need
not match. Preserve each environment's own counts/IDs across reconciliation.
An absent retirement or repair means PENDING, not a passed exception.

Ledger parity compares the expected migration version set and validated migration
names. Recorded `statements` may differ between historical operator records
(NULL) and supported CLI repair records (parsed SQL provenance). Such a difference
does not authorize replaying SQL and is not proof of logical-state divergence;
the independent canonical and structural checks establish that state.

## Future team qualitative contract

Participant open-text responses will be used in future team reports. Raw
participant open answers remain confidential; the account owner does not
receive individual raw answers. The future V2.4 worker produces anonymized
structured qualitative synthesis for the main team report. Report input must
contain no participant IDs, names or emails. Raw open text remains inside the
untrusted diagnostic-data security boundary. This contract is documentation
only; V2.1R implements no participants, synthesis, team AI or account features.
