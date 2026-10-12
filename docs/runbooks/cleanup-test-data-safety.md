# Cleanup execution flag safety

`scripts/cleanup-production-test-data.sql` previously checked whether the psql
variable `execute` existed. Consequently `-v execute=0` entered the deletion
branch. The script now parses the value before starting the cleanup transaction.

| Flag | Behavior |
| --- | --- |
| Omitted | Dry run; inventory followed by rollback |
| `-v execute=0` | Dry run; inventory followed by rollback |
| `-v execute=false` | Dry run; inventory followed by rollback |
| `-v execute=1` | Execution branch |
| Any other value, including empty, `true`, `01` or `FALSE` | Error before cleanup transaction; nonzero exit |

Values are deliberately exact and case-sensitive. `ON_ERROR_STOP` prevents an
invalid value from continuing. The validated Boolean, rather than the original
variable's presence, gates every deletion and the commit.

The email allowlist, normalized exact-email matching, administrator refusal,
checks for non-target ownership, deletion predicates, transaction boundary and
before/after counts are unchanged. No `TRUNCATE` or unqualified deletion is added.

## Local verification

Static tests run as part of the regular Vitest suite. Optional executable probes
require a disposable local PostgreSQL Docker container with user `postgres` and
database `ai_diagnostic_v21r`:

```sh
V21R_CLEANUP_TEST_CONTAINER=ai-diagnostic-v21r-lifecycle npm run test:unit -- tests/security/cleanup-execute-guard.test.ts
```

The executable tests extract only the script prefix before `begin;` and append
harmless `SELECT` branch markers. They never pass the cleanup script, its
inventory queries or its deletion SQL to PostgreSQL. They cover omitted, `0`,
`false`, `1`, invalid numeric/Boolean/empty values and a SQL-like flag value.

V2.1R verification passed all 11 focused checks, including eight executable
probes. The cleanup script itself was not executed against any database.

## Account foundation compatibility

After account tables exist, this V1 script fails closed before opening its cleanup
transaction, for every execute value. Direct creator ownership no longer defines
the tenant. A separate account-aware procedure must review shared membership,
legacy provenance and all historical dependencies before permitting deletion.
The V2.1A local test executes only the harmless extracted prefix against a
migrated fixture and verifies refusal without modifying history.
