#!/usr/bin/env python3
"""Exercise only the additive Phase A migration against clean and V1 databases.

Usage: python3 scripts/test-account-phase-a-local.py --container ai-diagnostic-v21a-foundation
Uses docker exec only; never accepts a database URL, project ref or credentials.
The existing container must be PostgreSQL with no published ports. All databases
created by this runner have random test names and are removed on completion.
Auth contracts are stubbed: these tests exercise PostgreSQL/RLS, not GoTrue.
"""
import argparse
import json
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
FIXTURES = ROOT / "supabase/tests/fixtures"
FOUNDATION = "20261013000100_account_foundation.sql"
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
    if not (MIGRATIONS / FOUNDATION).is_file():
        raise SystemExit(f"Missing migration: {FOUNDATION}")

    cases = 0
    databases = []
    prefix = "v21a_phase_a_" + secrets.token_hex(4)

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

    def policies(db):
        return json.loads(sql(db, """select coalesce(jsonb_agg(to_jsonb(p)
          order by schemaname,tablename,policyname),'[]'::jsonb)
          from pg_policies p where schemaname in ('public','private','auth')
          and tablename not in ('accounts','account_memberships');"""))

    def v1_functions(db):
        return json.loads(sql(db, """select jsonb_object_agg(n.nspname || '.' ||
          p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
          pg_get_functiondef(p.oid)) from pg_proc p
          join pg_namespace n on n.oid=p.pronamespace
          where (n.nspname='public' and p.proname in
            ('save_diagnostic_block','submit_diagnostic','create_feedback','create_lead_request'))
             or (n.nspname='private' and p.proname in
            ('can_read_diagnostic_version','can_read_diagnostic_definition'));"""))

    def company_constraints(db):
        return json.loads(sql(db, """select jsonb_object_agg(conname,
          pg_get_constraintdef(oid)) from pg_constraint
          where conrelid='public.company_profiles'::regclass
          and conname<>'company_profiles_account_id_fkey';"""))

    try:
        baseline = database("baseline")
        sql(baseline, (FIXTURES / "methodology-retirement-local-auth.sql").read_text())
        baseline_chain = [migration for migration in sorted(MIGRATIONS.glob("*.sql"))
                          if migration.name < FOUNDATION]
        if len(baseline_chain) != 30:
            raise AssertionError(f"Expected the 30 reconciled legacy migrations, got {len(baseline_chain)}")
        for migration in baseline_chain:
            apply(baseline, migration.name)
        legacy_tables = json.loads(sql(baseline, "select jsonb_agg(schemaname || '.' || tablename order by schemaname,tablename) from pg_tables where schemaname in ('public','private','auth');"))
        baseline_policies = policies(baseline)
        baseline_functions = v1_functions(baseline)
        baseline_constraints = company_constraints(baseline)
        if not baseline_policies or not baseline_functions:
            raise AssertionError("Expected existing V1 policies and mutation/read helpers")
        passed("clean baseline: actual 30-migration chain including reconciled methodology retirement")

        clean = database("clean", baseline)
        before = snapshot(clean, legacy_tables)
        apply(clean, FOUNDATION)
        assert_preserved(before, snapshot(clean, legacy_tables))
        scalar(clean, "select count(*) from public.accounts;", 0)
        scalar(clean, "select count(*) from public.account_memberships;", 0)
        if policies(clean) != baseline_policies or v1_functions(clean) != baseline_functions:
            raise AssertionError("Phase A changed V1 policies or diagnostic/read RPC definitions")
        if company_constraints(clean) != baseline_constraints:
            raise AssertionError("Phase A changed an existing company constraint")
        passed("clean database: only Phase A applies; historical rows, every legacy policy, V1 RPC/helper definitions and constraints unchanged")

        upgrade = database("upgrade", baseline)
        sql(upgrade, (FIXTURES / "account-foundation-local-history.sql").read_text())
        before = snapshot(upgrade, legacy_tables)
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
        legacy_access = {user: json.loads(sql(upgrade, as_user(user, projection)))
                         for user in (OWNER,OTHER,NO_COMPANY,ADMIN,UNVERIFIED)}
        apply(upgrade, FOUNDATION)
        assert_preserved(before, snapshot(upgrade, legacy_tables))
        scalar(upgrade, "select count(*) from public.accounts;", 5)
        scalar(upgrade, "select count(*) from public.account_memberships where role='owner' and status='active';", 5)
        scalar(upgrade, "select count(*) from public.company_profiles c join public.accounts a on a.id=c.account_id where a.legacy_origin_user_id=c.owner_user_id;", 4)
        scalar(upgrade, f"select count(*) from public.account_memberships where user_id='{NO_COMPANY}';", 1)
        scalar(upgrade, "select count(*) from public.accounts where id=legacy_origin_user_id;", 0)
        passed("V1 upgrade: all existing IDs and legacy rows/values preserved, including v3/v4; each user gets a random account and owner membership; existing companies attached")

        if policies(upgrade) != baseline_policies or v1_functions(upgrade) != baseline_functions:
            raise AssertionError("Phase A changed V1 policies or diagnostic/read RPC definitions")
        if company_constraints(upgrade) != baseline_constraints:
            raise AssertionError("Phase A changed an existing company constraint")
        for user, expected in legacy_access.items():
            if json.loads(sql(upgrade, as_user(user, projection))) != expected:
                raise AssertionError(f"Phase A changed legacy row visibility for {user}")
        if not all(legacy_access[OWNER].values()):
            raise AssertionError("Fixture does not contain the full V1 owner history")
        passed("every pre-existing RLS policy and V1 RPC/helper definition unchanged; all historical table visibility matches before/after for each principal")

        account = account_for(upgrade, OWNER)
        other_account = account_for(upgrade, OTHER)
        scalar(upgrade, "select count(*) from public.company_profiles where account_id is null;", 0)
        account_filter = "select count(*) from public.company_profiles c where c.id='" + COMPANY + "' and c.account_id in (select a.id from public.accounts a join public.account_memberships m on m.account_id=a.id where a.status='active' and m.status='active' and m.role='owner' and m.user_id=auth.uid())"
        scalar(upgrade, as_user(OWNER, account_filter), 1)
        scalar(upgrade, as_user(OTHER, account_filter), 0)
        passed("account-aware company listing intersects unchanged V1 RLS correctly; no actual NULL account mappings remain")
        canonical = snapshot(upgrade, ["public.accounts", "public.account_memberships", "public.company_profiles"])
        sql(upgrade, "select private.backfill_legacy_accounts(); select private.ensure_legacy_account(id) from public.users order by id;")
        if canonical != snapshot(upgrade, ["public.accounts", "public.account_memberships", "public.company_profiles"]):
            raise AssertionError("Backfill recheck changed mappings or memberships")
        passed("backfill recheck idempotent: IDs, memberships, company timestamps/revisions and account mappings remain identical")

        for table in ("accounts", "account_memberships", "company_profiles"):
            scalar(upgrade, f"select relrowsecurity from pg_class where oid='public.{table}'::regclass;", "t")
        scalar(upgrade, "select attnotnull from pg_attribute where attrelid='public.company_profiles'::regclass and attname='account_id';", "f")
        scalar(upgrade, "select convalidated from pg_constraint where conrelid='public.company_profiles'::regclass and conname='company_profiles_account_id_fkey';", "f")
        scalar(upgrade, "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.company_profiles'::regclass and conname='company_profiles_owner_user_id_key';", "UNIQUE (owner_user_id)")
        scalar(upgrade, "select count(*) from pg_indexes where schemaname='public' and indexname in ('company_profiles_account_list_idx','account_memberships_one_active_owner_idx','account_memberships_user_access_idx');", 3)
        sql(upgrade, company_insert("20000000-0000-4000-8000-000000000099", OWNER), "company_profiles_owner_user_id_key")
        sql(upgrade, "insert into public.account_memberships(account_id,user_id,role,status) values ('" + account + "','" + OTHER + "','manager','active');", "check constraint")
        sql(upgrade, "insert into public.account_memberships(account_id,user_id,role,status) values ('" + account + "','" + OTHER + "','owner','unknown');", "check constraint")
        sql(upgrade, "insert into public.account_memberships(account_id,user_id,role,status) values ('" + account + "','" + OTHER + "','owner','active');", "duplicate key")
        sql(upgrade, f"insert into public.accounts(name,legacy_origin_user_id) values ('Duplicate mapping','{OWNER}');", "duplicate key")
        sql(upgrade, f"delete from public.accounts where id='{account}';", "")
        passed("expand schema: account FK nullable/NOT VALID, new indexes/RLS, owner-only role/state and active-owner uniqueness; legacy one-company uniqueness and restrictive references retained")
        sql(upgrade, f"begin; update public.account_memberships set status='revoked',revoked_at=now() where account_id='{account}'; commit;", "exactly one active owner")
        scalar(upgrade, f"select status from public.account_memberships where account_id='{account}';", "active")
        sql(upgrade, "insert into public.accounts(name) values ('Ownerless active account');", "exactly one active owner")
        sql(upgrade, f"update public.accounts set legacy_origin_user_id='{OTHER}' where id='{account}';", "immutable")
        sql(upgrade, f"update public.account_memberships set user_id='{OTHER}' where account_id='{account}';", "immutable")
        passed("deferred invariant rejects an active account without an owner and rolls back")

        retired_version = sql(upgrade, f"select version_id from public.diagnostics where id='{RETIRED}';")
        scalar(upgrade, as_user(OWNER, f"select count(*) from public.questions where version_id='{retired_version}'"), 84)
        scalar(upgrade, as_user(OTHER, f"select count(*) from public.questions where version_id='{retired_version}'"), 0)
        scalar(upgrade, as_user(OWNER, f"select status from public.diagnostic_versions where id='{retired_version}'"), "retired")
        passed("pinned retired methodology is readable through unchanged V1 pinned-version helper; unrelated users cannot read it")

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

        # V1 compatibility: old company INSERT omits the newly introduced column.
        sql(upgrade, as_user(NO_COMPANY, company_insert("20000000-0000-4000-8000-000000000003", NO_COMPANY), commit=True))
        scalar(upgrade, f"select account_id from public.company_profiles where owner_user_id='{NO_COMPANY}';", account_for(upgrade, NO_COMPANY))
        passed("legacy company creation without account_id resolves the caller's legacy account")

        scalar(upgrade, as_user(NO_COMPANY, "with edited as (update public.company_profiles set name='V1 compatible edit',revision=revision+1 where owner_user_id='" + NO_COMPANY + "' returning id) select count(*) from edited", commit=True), 1)
        scalar(upgrade, f"select revision from public.company_profiles where owner_user_id='{NO_COMPANY}';", 2)
        scalar(upgrade, f"select account_id from public.company_profiles where owner_user_id='{NO_COMPANY}';", account_for(upgrade, NO_COMPANY))
        scalar(upgrade, as_user(OTHER, "with edited as (update public.company_profiles set name='Unauthorized edit' where owner_user_id='" + NO_COMPANY + "' returning id) select count(*) from edited"), 0)
        passed("existing V1 profile UPDATE/revision path works and preserves account mapping; another creator cannot edit")

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

        explicit_company = "20000000-0000-4000-8000-000000000098"
        new_account = account_for(upgrade, NEW_USER)
        sql(upgrade, as_user(NEW_USER, company_insert(explicit_company, NEW_USER, new_account), commit=True))
        scalar(upgrade, as_user(NEW_USER, f"with edited as (update public.company_profiles set name='Account-aware first profile edit',revision=2 where id='{explicit_company}' and account_id='{new_account}' and revision=1 returning id) select count(*) from edited", commit=True), 1)
        scalar(upgrade, as_user(NEW_USER, f"with edited as (update public.company_profiles set name='Stale edit',revision=3 where id='{explicit_company}' and account_id='{new_account}' and revision=1 returning id) select count(*) from edited"), 0)
        scalar(upgrade, as_user(OTHER, f"select count(*) from public.company_profiles where id='{explicit_company}'"), 0)
        passed("explicit-account first-company INSERT and id/account/revision profile UPDATE work with legacy RLS; stale revision and foreign actor denied")

        created = "30000000-0000-4000-8000-000000000099"
        published = sql(upgrade, "select id from public.diagnostic_versions where status='published' order by version_number desc limit 1;")
        sql(upgrade, as_user(NO_COMPANY, f"insert into public.diagnostics(id,company_id,created_by_user_id,version_id) values ('{created}','20000000-0000-4000-8000-000000000003','{NO_COMPANY}','{published}')", commit=True))
        scalar(upgrade, as_user(NO_COMPANY, f"select status from public.diagnostics where id='{created}'"), "in_progress")
        scalar(upgrade, as_user(OWNER, f"select count(*) from public.diagnostics where id='{created}'"), 0)
        passed("existing V1 diagnostic INSERT/read path works after Phase A and retains creator isolation")

        replacement = database("replacement", upgrade)
        sql(replacement, f"begin; update public.account_memberships set status='revoked',revoked_at=now() where account_id='{account}'; insert into public.account_memberships(account_id,user_id) values ('{account}','{OTHER}'); commit;")
        state = snapshot(replacement, ["public.accounts", "public.account_memberships", "public.company_profiles"])
        sql(replacement, "select private.backfill_legacy_accounts();", "legacy account mapping conflicts with owner")
        if state != snapshot(replacement, ["public.accounts", "public.account_memberships", "public.company_profiles"]):
            raise AssertionError("Conflicting-owner backfill changed data")
        passed("conflicting owner backfill fails atomically without reassignment")

        conflict = database("conflict", upgrade)
        sql(conflict, f"begin; update public.accounts set status='archived' where id='{account}'; update public.account_memberships set status='revoked',revoked_at=now() where account_id='{account}'; commit;")
        state = snapshot(conflict, ["public.accounts", "public.account_memberships", "public.company_profiles"])
        sql(conflict, "select private.backfill_legacy_accounts();", "legacy account mapping conflicts with account state")
        if state != snapshot(conflict, ["public.accounts", "public.account_memberships", "public.company_profiles"]):
            raise AssertionError("Failed backfill conflict changed data")
        passed("revoked/archived legacy mapping backfill fails without revival or history edits")

        print(f"PASS {cases} Phase A integration scenarios; only expand migration applied; clean/V1 upgrade complete; no remote writes", flush=True)
    finally:
        for db in reversed(databases):
            sql("postgres", f'drop database "{db}";')


if __name__ == "__main__":
    main()
