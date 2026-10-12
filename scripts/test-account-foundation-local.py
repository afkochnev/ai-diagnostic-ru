#!/usr/bin/env python3
"""Exercise account migrations against clean and V1 databases in disposable PostgreSQL.

Usage: python3 scripts/test-account-foundation-local.py --container ai-diagnostic-v21a-foundation
Uses docker exec only; never accepts a database URL, project ref or credentials.
The existing container must be PostgreSQL with no published ports. All databases
created by this runner have random test names and are removed on completion.
Auth contracts are stubbed: these tests exercise PostgreSQL/RLS, not GoTrue.
"""
import argparse
import json
from pathlib import Path
import re
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
FIXTURES = ROOT / "supabase/tests/fixtures"
FOUNDATION = "20261013000100_account_foundation.sql"
CUTOVER = "20261013000200_account_authorization_cutover.sql"
OWNER = "10000000-0000-4000-8000-000000000001"
OTHER = "10000000-0000-4000-8000-000000000002"
NO_COMPANY = "10000000-0000-4000-8000-000000000003"
ADMIN = "10000000-0000-4000-8000-000000000004"
UNVERIFIED = "10000000-0000-4000-8000-000000000005"
COMPANY = "20000000-0000-4000-8000-000000000001"
COMPLETED = "30000000-0000-4000-8000-000000000001"
IN_PROGRESS = "30000000-0000-4000-8000-000000000002"
RETIRED = "30000000-0000-4000-8000-000000000006"
NEW_USER = "10000000-0000-4000-8000-000000000099"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    args = parser.parse_args()
    if not args.container.startswith("ai-diagnostic-v21a-"):
        raise SystemExit("Refusing a container without the disposable test prefix")
    container = json.loads(subprocess.run(
        ["docker", "inspect", args.container], capture_output=True, text=True, check=True,
    ).stdout)[0]
    if not container["Config"]["Image"].startswith("postgres:"):
        raise SystemExit("Refusing a non-PostgreSQL container")
    if any(container["NetworkSettings"]["Ports"].values()):
        raise SystemExit("Refusing a container with published network ports")
    for filename in (FOUNDATION, CUTOVER):
        if not (MIGRATIONS / filename).is_file():
            raise SystemExit(f"Missing migration: {filename}")

    cases = 0
    databases = []
    prefix = "v21a_account_" + secrets.token_hex(4)

    def passed(label):
        nonlocal cases
        cases += 1
        print(f"PASS {label}", flush=True)

    def sql(db, source, error=None):
        result = subprocess.run(
            ["docker", "exec", "-i", args.container, "psql", "-X", "-qAt",
             "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db],
            input=source, capture_output=True, text=True,
        )
        if error is not None:
            if result.returncode == 0 or (error and error not in result.stderr):
                raise AssertionError(f"Expected SQL failure {error!r}: {result.stdout}\n{result.stderr}")
        elif result.returncode:
            raise AssertionError(f"SQL failed in {db}: {result.stderr}")
        return result.stdout.strip()

    def apply(db, filename, error=None):
        return sql(db, (MIGRATIONS / filename).read_text(), error)

    def database(label, template=None):
        name = prefix + "_" + label
        sql("postgres", f'create database "{name}"' + (f' template "{template}"' if template else "") + ";")
        databases.append(name)
        return name

    def as_user(user, query, role="authenticated", commit=False):
        claims = json.dumps({"sub": user, "role": role, "aal": "aal2" if user == ADMIN else "aal1"})
        return f"begin; set local request.jwt.claims = '{claims}'; set local role {role}; {query}; {'commit' if commit else 'rollback'};"

    def scalar(db, source, expected):
        actual = sql(db, source)
        if actual != str(expected):
            raise AssertionError(f"Expected {expected!r}, got {actual!r}; SQL: {source}")

    def snapshot(db, tables):
        fields = ",".join(
            f"'{table}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from {table} t)"
            for table in tables
        )
        return json.loads(sql(db, f"select jsonb_build_object({fields});"))

    def assert_preserved(before, after):
        for row in after["public.company_profiles"]:
            row.pop("account_id", None)
        for state in (before, after):
            for table in state:
                state[table].sort(key=lambda row: json.dumps(row, sort_keys=True))
        if before != after:
            changed = [table for table in before if before[table] != after[table]]
            raise AssertionError(f"Legacy row values changed: {changed}")

    def account_for(db, user):
        return sql(db, f"select id from public.accounts where legacy_origin_user_id='{user}';")

    def company_insert(company_id, user, account_id=None, name="New company"):
        columns = "id,owner_user_id,name,industry_key,country,products,customer_segments,sales_channels,employee_count,annual_revenue_key,company_age_years,management_levels,key_problems,main_goals"
        values = f"'{company_id}','{user}','{name}','consulting','Россия','P','C','S',4,'up_to_10m',2,1,'K','G'"
        if account_id is not None:
            columns += ",account_id"
            values += f",'{account_id}'"
        return f"insert into public.company_profiles({columns}) values({values})"

    try:
        baseline = database("baseline")
        sql(baseline, (FIXTURES / "methodology-retirement-local-auth.sql").read_text())
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name < FOUNDATION:
                apply(baseline, migration.name)
        legacy_tables = json.loads(sql(baseline, "select jsonb_agg(schemaname || '.' || tablename order by schemaname,tablename) from pg_tables where schemaname in ('public','private','auth');"))
        passed("clean baseline: actual existing migration chain including methodology retirement")

        clean = database("clean", baseline)
        before = snapshot(clean, legacy_tables)
        apply(clean, FOUNDATION)
        apply(clean, CUTOVER)
        assert_preserved(before, snapshot(clean, legacy_tables))
        scalar(clean, "select count(*) from public.accounts;", 0)
        scalar(clean, "select count(*) from public.account_memberships;", 0)
        passed("clean database: both account migrations apply; existing methodology rows unchanged")

        upgrade = database("upgrade", baseline)
        sql(upgrade, (FIXTURES / "account-foundation-local-history.sql").read_text())
        before = snapshot(upgrade, legacy_tables)
        apply(upgrade, FOUNDATION)
        assert_preserved(before, snapshot(upgrade, legacy_tables))
        scalar(upgrade, "select count(*) from public.accounts;", 5)
        scalar(upgrade, "select count(*) from public.account_memberships where role='owner' and status='active';", 5)
        scalar(upgrade, "select count(*) from public.company_profiles c join public.accounts a on a.id=c.account_id where a.legacy_origin_user_id=c.owner_user_id;", 4)
        scalar(upgrade, f"select count(*) from public.account_memberships where user_id='{NO_COMPANY}';", 1)
        scalar(upgrade, "select count(*) from public.accounts where id=legacy_origin_user_id;", 0)
        passed("upgrade backfill: all users including no-company, administrator and unverified; random account IDs; every company attached")
        sql(upgrade, company_insert("20000000-0000-4000-8000-000000000099", OWNER), "company_profiles_owner_user_id_key")
        passed("foundation retains owner uniqueness until authorization cutover")
        apply(upgrade, CUTOVER)
        assert_preserved(before, snapshot(upgrade, legacy_tables))
        passed("upgrade preserves every legacy row/ID/value including all v3/v4 methodology and V1 history; only company account_id added")

        # Run ONLY the extracted pre-transaction safety guard. Never load the
        # full cleanup script into PostgreSQL or send any cleanup/deletion SQL.
        cleanup = (ROOT / "scripts/cleanup-production-test-data.sql").read_text()
        transaction_start = cleanup.index("\nbegin;\n")
        cleanup_guard = cleanup[:transaction_start]
        if re.search(r"^\s*(?:insert|update|delete|truncate|create)\b", cleanup_guard, re.MULTILINE | re.IGNORECASE):
            raise AssertionError("Cleanup guard unexpectedly contains mutation SQL")
        guard_before = snapshot(upgrade, legacy_tables)
        sql(upgrade, "\\set test_emails guard@example.invalid\n\\set execute 1\n" + cleanup_guard, "V1 cleanup refused")
        if guard_before != snapshot(upgrade, legacy_tables):
            raise AssertionError("Refused cleanup guard changed historical data")
        passed("V1 cleanup extracted guard refuses account schema even with execute=1; every historical row unchanged; no cleanup SQL executed")

        account = account_for(upgrade, OWNER)
        other_account = account_for(upgrade, OTHER)
        canonical = snapshot(upgrade, ["public.accounts", "public.account_memberships", "public.company_profiles"])
        sql(upgrade, "select private.backfill_legacy_accounts(); select private.ensure_legacy_account(id) from public.users order by id;")
        if canonical != snapshot(upgrade, ["public.accounts", "public.account_memberships", "public.company_profiles"]):
            raise AssertionError("Backfill recheck changed mappings or memberships")
        passed("backfill recheck is idempotent without replacing account/membership/company mappings")

        for table in ("accounts", "account_memberships", "company_profiles"):
            scalar(upgrade, f"select relrowsecurity from pg_class where oid='public.{table}'::regclass;", "t")
        scalar(upgrade, "select attnotnull from pg_attribute where attrelid='public.company_profiles'::regclass and attname='account_id';", "t")
        scalar(upgrade, "select convalidated from pg_constraint where conrelid='public.company_profiles'::regclass and conname='company_profiles_account_id_fkey';", "t")
        scalar(upgrade, "select count(*) from pg_policies where schemaname='public' and tablename in ('company_profiles','diagnostics','answers','diagnostic_mutations','diagnostic_company_snapshots','diagnostic_results','diagnostic_block_results','ai_reports','report_artifacts','email_deliveries','lead_requests','feedback','consultation_notification_deliveries') and policyname like '%owner%';", 0)
        sql(upgrade, "insert into public.account_memberships(account_id,user_id,role,status) values ('" + account + "','" + OTHER + "','manager','active');", "check constraint")
        sql(upgrade, "insert into public.account_memberships(account_id,user_id,role,status) values ('" + account + "','" + OTHER + "','owner','unknown');", "check constraint")
        sql(upgrade, "insert into public.account_memberships(account_id,user_id,role,status) values ('" + account + "','" + OTHER + "','owner','active');", "duplicate key")
        sql(upgrade, f"insert into public.accounts(name,legacy_origin_user_id) values ('Duplicate mapping','{OWNER}');", "duplicate key")
        sql(upgrade, f"update public.company_profiles set account_id='ffffffff-ffff-4fff-8fff-ffffffffffff' where id='{COMPANY}';", "")
        sql(upgrade, f"delete from public.accounts where id='{account}';", "")
        passed("schema: RLS, NOT NULL, owner-only role/state constraints, unique legacy origin/active owner and restrictive account linkage")

        sql(upgrade, f"begin; update public.account_memberships set status='revoked',revoked_at=now() where account_id='{account}'; commit;", "exactly one active owner")
        scalar(upgrade, f"select status from public.account_memberships where account_id='{account}';", "active")
        sql(upgrade, "insert into public.accounts(name) values ('Ownerless active account');", "exactly one active owner")
        sql(upgrade, f"update public.accounts set legacy_origin_user_id='{OTHER}' where id='{account}';", "immutable")
        sql(upgrade, f"update public.account_memberships set user_id='{OTHER}' where account_id='{account}';", "immutable")
        passed("deferred invariant rejects an active account without an owner and rolls back")

        owned_tables = {
            "company_profiles": f"id='{COMPANY}'",
            "diagnostics": f"id in ('{COMPLETED}','{IN_PROGRESS}','{RETIRED}')",
            "answers": f"diagnostic_id in ('{COMPLETED}','{IN_PROGRESS}','{RETIRED}')",
            "diagnostic_mutations": f"diagnostic_id in ('{COMPLETED}','{IN_PROGRESS}','{RETIRED}')",
            "diagnostic_company_snapshots": f"diagnostic_id in ('{COMPLETED}','{RETIRED}')",
            "diagnostic_results": f"diagnostic_id in ('{COMPLETED}','{RETIRED}')",
            "diagnostic_block_results": f"result_id in (select id from public.diagnostic_results where diagnostic_id in ('{COMPLETED}','{RETIRED}'))",
            "ai_reports": f"diagnostic_id in ('{COMPLETED}','{RETIRED}')",
            "report_artifacts": f"report_id in (select id from public.ai_reports where diagnostic_id in ('{COMPLETED}','{RETIRED}'))",
            "email_deliveries": f"diagnostic_id in ('{COMPLETED}','{RETIRED}')",
            "lead_requests": f"diagnostic_id in ('{COMPLETED}','{RETIRED}')",
            "feedback": f"diagnostic_id in ('{COMPLETED}','{RETIRED}')",
            "consultation_notification_deliveries": f"lead_request_id in (select id from public.lead_requests where diagnostic_id in ('{COMPLETED}','{RETIRED}'))",
        }
        projection = "select jsonb_build_object(" + ",".join(f"'{table}',(select count(*) from public.{table} where {condition})" for table, condition in owned_tables.items()) + ")"
        counts = json.loads(sql(upgrade, projection + ";"))
        if not all(counts.values()):
            raise AssertionError(f"Incomplete fixture: {counts}")
        if json.loads(sql(upgrade, as_user(OWNER, projection))) != counts:
            raise AssertionError("Legacy owner lost existing historical rows")
        for user in (OTHER, NO_COMPANY, ADMIN, UNVERIFIED):
            if any(json.loads(sql(upgrade, as_user(user, projection))).values()):
                raise AssertionError(f"Cross-account history visible to {user}")
        sql(upgrade, as_user(None, "select * from public.accounts", role="anon"), "permission denied")
        sql(upgrade, as_user(None, "select * from public.company_profiles", role="anon"), "permission denied")
        scalar(upgrade, as_user(UNVERIFIED, "select count(*) from public.company_profiles"), 0)
        scalar(upgrade, as_user(UNVERIFIED, "select count(*) from public.diagnostics"), 0)
        scalar(upgrade, as_user(OTHER, "select count(*) from public.company_profiles"), 1)
        scalar(upgrade, as_user(ADMIN, "select count(*) from public.company_profiles"), 1)
        passed("RLS: legacy owner reads all history; other/no-company/unverified/global administrator cannot read another account; anonymous denied")
        retired_version = sql(upgrade, f"select version_id from public.diagnostics where id='{RETIRED}';")
        scalar(upgrade, as_user(OWNER, f"select count(*) from public.questions where version_id='{retired_version}'"), 84)
        scalar(upgrade, as_user(OTHER, f"select count(*) from public.questions where version_id='{retired_version}'"), 0)
        scalar(upgrade, as_user(OWNER, f"select status from public.diagnostic_versions where id='{retired_version}'"), "retired")
        passed("pinned retired methodology is readable through current account membership; unrelated users cannot read it")

        scalar(upgrade, as_user(OWNER, f"select count(*) from public.accounts where id='{account}'"), 1)
        scalar(upgrade, as_user(OWNER, f"select count(*) from public.accounts where id='{other_account}'"), 0)
        scalar(upgrade, as_user(OWNER, f"select count(*) from public.account_memberships where account_id='{account}'"), 1)
        scalar(upgrade, as_user(OWNER, f"select count(*) from public.account_memberships where account_id='{other_account}'"), 0)
        for user in (UNVERIFIED,):
            scalar(upgrade, as_user(user, "select count(*) from public.accounts"), 0)
            scalar(upgrade, as_user(user, "select count(*) from public.account_memberships"), 0)
        for command in (
            "insert into public.accounts(name) values ('Unauthorized account')",
            f"insert into public.account_memberships(account_id,user_id,role,status) values ('{other_account}','{OWNER}','owner','active')",
            f"update public.account_memberships set status='revoked' where account_id='{account}'",
            f"delete from public.account_memberships where account_id='{account}'",
            f"select private.ensure_legacy_account('{OTHER}')",
        ):
            sql(upgrade, as_user(OWNER, command), "permission denied")
        passed("account/membership isolation and no browser account creation, owner escalation, revocation or backfill execution")

        new_company = "20000000-0000-4000-8000-000000000099"
        sql(upgrade, as_user(OWNER, company_insert(new_company, OWNER, account), commit=True))
        scalar(upgrade, as_user(OWNER, "select count(*) from public.company_profiles"), 2)
        scalar(upgrade, as_user(OTHER, f"select count(*) from public.company_profiles where id='{new_company}'"), 0)
        sql(upgrade, as_user(OWNER, company_insert("20000000-0000-4000-8000-000000000098", OWNER, other_account)), "")
        scalar(upgrade, as_user(OTHER, f"with changed as (update public.company_profiles set name='IDOR' where id='{new_company}' returning id) select count(*) from changed"), 0)
        sql(upgrade, as_user(OWNER, f"update public.company_profiles set account_id='{other_account}' where id='{new_company}'"), "")
        sql(upgrade, as_user(OTHER, f"insert into public.diagnostics(company_id,created_by_user_id,version_id) select '{new_company}','{OTHER}',version_id from public.diagnostics where id='30000000-0000-4000-8000-000000000003'"), "row-level security")
        scalar(upgrade, as_user(OTHER, f"with changed as (update public.answers set numeric_value=1 where diagnostic_id='{IN_PROGRESS}' and numeric_value is not null returning id) select count(*) from changed"), 0)
        sql(upgrade, as_user(OTHER, f"insert into public.diagnostic_mutations(diagnostic_id,mutation_id,resulting_revision) values ('{IN_PROGRESS}',gen_random_uuid(),9)"), "row-level security")
        passed("same owner/account supports multiple companies; cross-account insert/update and account reassignment blocked")

        # V1 compatibility: old company INSERT omits the newly introduced column.
        sql(upgrade, as_user(NO_COMPANY, company_insert("20000000-0000-4000-8000-000000000003", NO_COMPANY), commit=True))
        scalar(upgrade, f"select account_id from public.company_profiles where owner_user_id='{NO_COMPANY}';", account_for(upgrade, NO_COMPANY))
        passed("legacy company creation without account_id resolves the caller's legacy account")

        # Actual existing V1 save and submit functions must remain usable.
        block = sql(upgrade, f"select q.block_id from public.answers a join public.questions q on q.id=a.question_id where a.diagnostic_id='{IN_PROGRESS}' and a.numeric_value is not null order by a.question_id limit 1;")
        question = sql(upgrade, f"select question_id from public.answers where diagnostic_id='{IN_PROGRESS}' and numeric_value is not null order by question_id limit 1;")
        result = json.loads(sql(upgrade, as_user(OWNER, f"select row_to_json(saved) from public.save_diagnostic_block('{IN_PROGRESS}',9,'40000000-0000-4000-8000-000000000001','{block}','[{{\"question_id\":\"{question}\",\"value\":2}}]'::jsonb,true) saved", commit=True)))
        if result.get("revision") != 10 or result.get("current_block_id") != block:
            raise AssertionError(f"V1 save failed: {result}")
        scalar(upgrade, f"select numeric_value from public.answers where diagnostic_id='{IN_PROGRESS}' and question_id='{question}';", 2)
        revision = sql(upgrade, f"select revision from public.diagnostics where id='{IN_PROGRESS}';")
        submitted = json.loads(sql(upgrade, as_user(OWNER, f"select public.submit_diagnostic('{IN_PROGRESS}',{revision})")))
        if submitted.get("ok") is not False or not submitted.get("missing"):
            raise AssertionError(f"V1 submit validation failed: {submitted}")
        passed("actual V1 save RPC still works and submit retains required-answer validation")
        sql(upgrade, as_user(OWNER, f"""
          insert into public.answers(diagnostic_id,version_id,question_id,numeric_value,text_value)
          select d.id,d.version_id,q.id,
            case when q.answer_type='scale_0_4' then 3 end,
            case when q.answer_type='text' then 'Required legacy response' end
          from public.diagnostics d join public.questions q on q.version_id=d.version_id
          where d.id='{IN_PROGRESS}' and q.is_active and q.is_required
            and not exists(select 1 from public.answers a where a.diagnostic_id=d.id and a.question_id=q.id)
        """, commit=True))
        submitted = json.loads(sql(upgrade, as_user(OWNER, f"select public.submit_diagnostic('{IN_PROGRESS}',{revision})", commit=True)))
        if submitted.get("ok") is not True or submitted.get("status") != "submitted":
            raise AssertionError(f"V1 complete submission failed: {submitted}")
        scalar(upgrade, f"select count(*) from public.diagnostic_company_snapshots where diagnostic_id='{IN_PROGRESS}';", 1)
        scalar(upgrade, f"select count(*) from public.jobs where diagnostic_id='{IN_PROGRESS}' and kind='score_diagnostic';", 1)
        passed("complete V1 submission still captures company snapshot and queues scoring exactly once")

        # Fresh signup must not trust metadata that requests another account/role.
        metadata = json.dumps({"full_name": "New legitimate user", "data_processing_consent": True,
            "marketing_consent": False,"data_processing_version": "temporary-ru-v1",
            "marketing_version": "temporary-ru-v1", "account_id": other_account,
            "account_role": "owner", "role": "administrator"})
        sql(upgrade, f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{NEW_USER}','new@example.test',now(),'{metadata}');")
        scalar(upgrade, f"select role from public.user_roles where user_id='{NEW_USER}';", "user")
        scalar(upgrade, f"select count(*) from public.user_consents where user_id='{NEW_USER}' and source='email_registration';", 2)
        scalar(upgrade, f"select count(*) from public.account_memberships m join public.accounts a on a.id=m.account_id where m.user_id='{NEW_USER}' and m.role='owner' and m.status='active' and a.legacy_origin_user_id='{NEW_USER}' and a.id<>'{other_account}';", 1)
        invalid_metadata = metadata.replace('"data_processing_consent": true', '"data_processing_consent": false')
        sql(upgrade, f"insert into auth.users(id,email,raw_user_meta_data) values ('10000000-0000-4000-8000-000000000098','invalid@example.test','{invalid_metadata}');", "Data processing consent is required")
        scalar(upgrade, "select count(*) from auth.users where id='10000000-0000-4000-8000-000000000098';", 0)
        passed("signup atomically provisions its own account/owner membership, preserves consent/global role and ignores malicious account metadata")

        # Revoke the original owner while the account remains active under a new
        # operator-assigned owner. This isolates membership checks from archiving.
        replacement = database("replacement", upgrade)
        sql(replacement, f"begin; update public.account_memberships set status='revoked',revoked_at=now() where account_id='{account}'; insert into public.account_memberships(account_id,user_id) values ('{account}','{OTHER}'); commit;")
        scalar(replacement, f"select status from public.accounts where id='{account}';", "active")
        if any(json.loads(sql(replacement, as_user(OWNER, projection))).values()):
            raise AssertionError("Revoked creator still has access to an active account")
        scalar(replacement, as_user(OTHER, f"select count(*) from public.diagnostics where id='{COMPLETED}'"), 1)
        state = snapshot(replacement, ["public.accounts", "public.account_memberships", "public.company_profiles"])
        sql(replacement, "select private.backfill_legacy_accounts();", "legacy account mapping conflicts with owner")
        if state != snapshot(replacement, ["public.accounts", "public.account_memberships", "public.company_profiles"]):
            raise AssertionError("Conflicting-owner backfill changed data")
        passed("atomic owner replacement satisfies deferred constraint; revocation denies the original creator even for an active account")

        # Current membership, rather than creator/legacy owner, controls reads.
        revoked = database("revoked", upgrade)
        sql(revoked, f"begin; update public.accounts set status='archived' where id='{account}'; update public.account_memberships set status='revoked',revoked_at=now() where account_id='{account}'; commit;")
        if any(json.loads(sql(revoked, as_user(OWNER, projection))).values()):
            raise AssertionError("Revoked owner can still read legacy company/diagnostic history")
        sql(revoked, as_user(OWNER, f"select public.submit_diagnostic('{IN_PROGRESS}',{revision})"), "")
        sql(revoked, as_user(OWNER, f"select public.create_feedback('{COMPLETED}',4,null,null)"), "")
        report_id = sql(upgrade, f"select report_id from public.lead_requests where diagnostic_id='{COMPLETED}';")
        idempotency = sql(upgrade, f"select idempotency_key from public.lead_requests where diagnostic_id='{COMPLETED}';")
        sql(revoked, as_user(OWNER, f"select public.create_lead_request('{COMPLETED}','{report_id}','Requester',null,null,null,'{idempotency}')"), "")
        passed("membership revocation removes all legacy-owner/creator access and blocks security-definer mutation RPCs")

        # A corrupted mapping must fail, never silently recreate or reassign it.
        conflict = database("conflict", upgrade)
        sql(conflict, f"begin; update public.accounts set status='archived' where id='{account}'; update public.account_memberships set status='revoked',revoked_at=now() where account_id='{account}'; commit;")
        state = snapshot(conflict, ["public.accounts", "public.account_memberships", "public.company_profiles"])
        sql(conflict, "select private.backfill_legacy_accounts();", "legacy account mapping conflicts with account state")
        if state != snapshot(conflict, ["public.accounts", "public.account_memberships", "public.company_profiles"]):
            raise AssertionError("Failed backfill conflict changed data")
        passed("backfill detects revoked/conflicting mapping and fails without changing records")

        print(f"PASS {cases} account integration scenarios; clean migration and V1 upgrade completed; no remote writes", flush=True)
    finally:
        for db in reversed(databases):
            sql("postgres", f'drop database "{db}";')


if __name__ == "__main__":
    main()
