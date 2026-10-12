#!/usr/bin/env python3
"""Verify the exact three-commit account rollout with the real Supabase CLI.

Only a disposable postgres:* container with the ai-diagnostic-v21a- prefix and
one 127.0.0.1 PostgreSQL port is accepted. The runner creates one randomly named
database, bootstraps minimal local Auth contracts, and lets db push record the
30 historical migrations and the two new migrations normally. Every dry-run is
checked against an unchanged ledger snapshot. No project ref, remote URL,
password, linked project, staging or production connection is accepted.

The Auth fixture exercises PostgreSQL migration behavior, not GoTrue/PostgREST.
All subprocess operations have a maximum 60-second timeout. Only the random
database and TemporaryDirectory created here are deleted by this runner.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = "0996971bfeac4ab50136998307169f6c63be8f44"
SNAPSHOT = "15f4159cc4ee52e93ab440f5eea51e076bbb286d"
PHASE_A = "20261013000100_account_foundation.sql"
PHASE_B = "20261013000200_account_authorization_cutover.sql"
ALLOWED_FINAL_DIFF = {
    "docs/runbooks/v21a-account-phase-a.md",
    "docs/architecture/v21a-compatible-application.md",
    "docs/runbooks/v21a-account-foundation-staging.md",
    "docs/architecture/v2-account-foundation.md",
    "docs/architecture/v2-account-foundation-files.md",
    "scripts/test-account-phase-a-local.py",
    "scripts/test-account-rollout-local.py",
}


def run(argv, *, source=None, cwd=ROOT, env=None):
    result = subprocess.run(argv, input=source, capture_output=True, text=True,
                            cwd=cwd, env=env, timeout=60)
    if result.returncode:
        # Commands contain only local generated identifiers and public Git refs.
        raise AssertionError(f"Local operation failed ({result.returncode}): "
                             f"{argv[0]}\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def git(*args):
    return run(["git", *args])


def manifest(ref, prefix):
    return git("ls-tree", "-r", "--name-only", ref, "--", prefix).splitlines()


def migration_blobs(ref):
    return {path: git("rev-parse", f"{ref}:{path}")
            for path in manifest(ref, "supabase/migrations") if path.endswith(".sql")}


def cli_json(stdout):
    # CLI v2.117 emits its machine result as a JSON line after progress text.
    values = []
    for line in stdout.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and isinstance(value.get("migrations"), list):
            values.append(value)
    if len(values) != 1:
        raise AssertionError("Expected exactly one Supabase CLI JSON migration result")
    value = values[0]
    if any(not isinstance(name, str) or not re.fullmatch(r"\d{14}_[a-z0-9_]+\.sql", name)
           for name in value["migrations"]):
        raise AssertionError("Unexpected migration names in Supabase CLI JSON result")
    if value.get("seeds") != [] or value.get("roles") != []:
        raise AssertionError("This rollout must not apply seed data or custom roles")
    return value


def materialize(ref, destination):
    destination.mkdir()
    # Use committed blobs, never an uncommitted checkout or linked .temp state.
    for path in manifest(ref, "supabase"):
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        data = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True,
                              cwd=ROOT, timeout=60, check=True).stdout
        target.write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase-a-ref", required=True)
    parser.add_argument("--app-ref", required=True)
    parser.add_argument("--cutover-ref", required=True)
    parser.add_argument("--ledger-container", required=True)
    parser.add_argument("--port", type=int, default=55431)
    args = parser.parse_args()
    refs = [args.phase_a_ref, args.app_ref, args.cutover_ref]
    if any(not re.fullmatch(r"[0-9a-f]{40}", ref) for ref in refs):
        raise SystemExit("All rollout refs must be exact full commit SHAs")
    if not re.fullmatch(r"ai-diagnostic-v21a-[a-z0-9-]+", args.ledger_container):
        raise SystemExit("Refusing a container outside the disposable test prefix")
    if not 1024 <= args.port <= 65535:
        raise SystemExit("Invalid local PostgreSQL port")
    container = json.loads(run(["docker", "inspect", args.ledger_container]))[0]
    if not container["Config"]["Image"].startswith("postgres:"):
        raise SystemExit("Refusing a non-PostgreSQL container")
    bindings = container["NetworkSettings"]["Ports"]
    published = {key: value for key, value in bindings.items() if value}
    expected = {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(args.port)}]}
    if published != expected:
        raise SystemExit("Only the requested 127.0.0.1 PostgreSQL port is allowed")
    container_env = dict(item.split("=", 1) for item in container["Config"]["Env"] if "=" in item)
    if container_env.get("POSTGRES_HOST_AUTH_METHOD") != "trust":
        raise SystemExit("The disposable container must use local test trust authentication")
    cli = ROOT / "node_modules/.bin/supabase"
    if not cli.is_file():
        raise SystemExit("Install repository dependencies before running this test")

    for ref, parent in zip(refs, [BASE, *refs[:2]]):
        if git("show", "-s", "--format=%P", ref) != parent:
            raise AssertionError(f"Unexpected parent for rollout commit {ref}")
    phase_a_paths = {
        f"supabase/migrations/{PHASE_A}",
        "supabase/tests/fixtures/account-foundation-local-history.sql",
        "scripts/test-account-phase-a-local.py",
        "docs/runbooks/v21a-account-phase-a.md",
    }
    deferred_snapshot_paths = {
        f"supabase/migrations/{PHASE_A}",
        f"supabase/migrations/{PHASE_B}",
        "supabase/tests/fixtures/account-foundation-local-history.sql",
        "scripts/test-account-foundation-local.py",
        "tests/security/account-migration-boundaries.test.ts",
        "docs/architecture/v2-account-foundation.md",
        "docs/architecture/v2-account-foundation-files.md",
    }
    application_paths = set(git("diff", "--name-only", BASE, SNAPSHOT).splitlines()) - deferred_snapshot_paths
    application_paths.add("docs/architecture/v21a-compatible-application.md")
    cutover_paths = {
        f"supabase/migrations/{PHASE_B}",
        "scripts/test-account-foundation-local.py",
        "tests/security/account-migration-boundaries.test.ts",
        "docs/architecture/v2-account-foundation.md",
        "docs/architecture/v2-account-foundation-files.md",
        "docs/runbooks/v21a-account-foundation-staging.md",
        "scripts/test-account-rollout-local.py",
    }
    for ref, parent, expected_paths in zip(refs, [BASE, *refs[:2]],
                                          [phase_a_paths, application_paths, cutover_paths]):
        actual = set(git("diff", "--name-only", parent, ref).splitlines())
        if actual != expected_paths:
            raise AssertionError(f"Unexpected commit file partition at {ref}: "
                                 f"extra={sorted(actual - expected_paths)}, missing={sorted(expected_paths - actual)}")
    if git("diff", "--name-only", SNAPSHOT, args.app_ref, "--", "src"):
        raise AssertionError("Compatible application source differs from the implementation snapshot")
    print("PASS exact file partitions: Phase A 4 files; compatible application 53 files; cutover 7 files", flush=True)
    old = migration_blobs(BASE)
    if len(old) != 30:
        raise AssertionError(f"Expected 30 historical migrations, got {len(old)}")
    for position, ref in enumerate(refs):
        blobs = migration_blobs(ref)
        expected_paths = set(old) | {f"supabase/migrations/{PHASE_A}"}
        if position == 2:
            expected_paths.add(f"supabase/migrations/{PHASE_B}")
        if set(blobs) != expected_paths or any(blobs[path] != digest for path, digest in old.items()):
            raise AssertionError(f"Historical migration or pending file boundary changed at {ref}")
        for name in [PHASE_A] + ([PHASE_B] if position == 2 else []):
            path = f"supabase/migrations/{name}"
            if blobs[path] != git("rev-parse", f"{SNAPSHOT}:{path}"):
                raise AssertionError(f"Account migration differs from implementation snapshot: {name}")
    changed = set(git("diff", "--name-only", SNAPSHOT, args.cutover_ref).splitlines())
    if not changed.issubset(ALLOWED_FINAL_DIFF):
        raise AssertionError(f"Final tree differs outside rollout docs/tests: {sorted(changed - ALLOWED_FINAL_DIFF)}")
    print("PASS exact commit chain; 30 historical migration blobs unchanged at all three commits", flush=True)
    print("PASS final source/SQL tree equivalent to implementation snapshot; only approved rollout docs/tests differ", flush=True)

    cli_env = {key: value for key, value in os.environ.items()
               if not key.startswith("SUPABASE_") and key not in {
                   "DATABASE_URL", "DB_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGPASSWORD",
               }}
    db = "v21a_rollout_" + secrets.token_hex(6)

    def sql(source, database=db):
        return run(["docker", "exec", "-i", args.ledger_container,
                    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                    "-d", database], source=source)

    def ledger():
        return json.loads(sql("select coalesce(jsonb_agg(to_jsonb(m) order by version), '[]'::jsonb) "
                              "from supabase_migrations.schema_migrations m;"))

    def assert_ledger(rows, count, previous=()):
        if len(rows) != count:
            raise AssertionError(f"Expected {count} local ledger entries, got {len(rows)}")
        keyed = {row["version"]: row for row in rows}
        if len(keyed) != count or any(keyed.get(row["version"]) != row for row in previous):
            raise AssertionError("Existing local migration ledger rows changed")

    created = False
    try:
        sql(f'create database "{db}";', "postgres")
        created = True
        with tempfile.TemporaryDirectory(prefix="v21a-rollout-") as temporary:
            projects = {}
            for label, ref in zip(["base", "phase-a", "app", "cutover"], [BASE, *refs]):
                projects[label] = Path(temporary) / label
                materialize(ref, projects[label])
            auth_fixture = projects["base"] / "supabase/tests/fixtures/methodology-retirement-local-auth.sql"
            sql(auth_fixture.read_text())
            # Generated, password-free loopback URL; CLI never receives a remote selector.
            db_url = f"postgresql://postgres@127.0.0.1:{args.port}/{db}?sslmode=disable"

            def push(label, expected_migrations, dry=True):
                previous = ledger() if dry else None
                command = [str(cli), "db", "push", "--db-url", db_url, "--skip-vault", "--yes",
                           "--workdir", str(projects[label]), "--output-format", "json"]
                if dry:
                    command.append("--dry-run")
                result = cli_json(run(command, env=cli_env))
                if result["migrations"] != expected_migrations or result.get("dryRun") is not dry:
                    raise AssertionError(f"Unexpected CLI pending migrations at {label}: {result}")
                if dry and ledger() != previous:
                    raise AssertionError(f"CLI dry-run changed the local ledger at {label}")
                return result

            baseline_names = sorted(Path(path).name for path in old)
            push("base", baseline_names, dry=False)
            baseline_ledger = ledger()
            assert_ledger(baseline_ledger, 30)
            if [row["version"] for row in baseline_ledger] != [name.split("_", 1)[0] for name in baseline_names]:
                raise AssertionError("Actual CLI baseline ledger versions do not match the 30 committed migrations")
            print("PASS baseline: real Supabase CLI applied and recorded the original 30 local migrations", flush=True)
            push("phase-a", [PHASE_A])
            print(f"PASS Commit 1 dry-run: only {PHASE_A}; local ledger unchanged", flush=True)
            push("phase-a", [PHASE_A], dry=False)
            phase_a_ledger = ledger()
            assert_ledger(phase_a_ledger, 31, baseline_ledger)
            if phase_a_ledger[-1]["version"] != PHASE_A.split("_", 1)[0]:
                raise AssertionError("Phase A was not recorded normally by the CLI")
            push("app", [])
            print("PASS Commit 2 after Phase A: no pending migrations; all 31 local ledger entries unchanged", flush=True)
            push("cutover", [PHASE_B])
            print(f"PASS Commit 3 dry-run: only {PHASE_B}; local ledger unchanged", flush=True)
            push("cutover", [PHASE_B], dry=False)
            cutover_ledger = ledger()
            assert_ledger(cutover_ledger, 32, phase_a_ledger)
            if cutover_ledger[-1]["version"] != PHASE_B.split("_", 1)[0]:
                raise AssertionError("Phase B was not recorded normally by the CLI")
            push("cutover", [])
            print("PASS final local cutover: 32 ledger entries; original 31 unchanged; no pending migrations", flush=True)
            print("PASS rollout ledger verification completed; no staging/production changes or deployment", flush=True)
    finally:
        if created:
            sql(f'drop database "{db}" with (force);', "postgres")


if __name__ == "__main__":
    main()
