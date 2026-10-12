#!/usr/bin/env python3
"""Exercise actual reconciliation SQL inside an existing disposable Docker DB.

Usage: python3 scripts/test-methodology-retirement-local.py --container ai-diagnostic-v21r-lifecycle
The container must be PostgreSQL with no published ports. No connection string,
project ref, credentials, or remote service is used. Tests create random local
databases and remove only those databases after all connections close.
"""
import argparse
import json
from pathlib import Path
import secrets
import subprocess


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
FIXTURES = ROOT / "supabase/tests/fixtures"
LIFECYCLE = "20261012000000_allow_methodology_retirement.sql"
RETIREMENT = "20261012000100_retire_invalid_methodology_v3.sql"
VERSION3 = "select v.id from public.diagnostic_versions v join public.diagnostic_definitions d on d.id=v.definition_id where d.key='manageability' and v.version_number=3"
VERSION4 = VERSION3.replace("version_number=3", "version_number=4")
OWNER = "10000000-0000-4000-8000-000000000001"
OTHER = "10000000-0000-4000-8000-000000000002"
TABLES = [
    "diagnostic_definitions", "diagnostic_versions", "diagnostic_version_translations",
    "diagnostic_blocks", "diagnostic_block_translations", "questions",
    "question_translations", "question_options", "question_option_translations",
    "scoring_policies", "maturity_levels", "maturity_level_translations",
    "diagnostics", "answers", "diagnostic_company_snapshots", "diagnostic_results",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    args = parser.parse_args()
    if not args.container.startswith("ai-diagnostic-v21r-"):
        raise SystemExit("Refusing a container without the disposable test prefix")
    inspected = subprocess.run(["docker", "inspect", args.container], capture_output=True, text=True, check=True)
    container = json.loads(inspected.stdout)[0]
    if not container["Config"]["Image"].startswith("postgres:"):
        raise SystemExit("Refusing a non-PostgreSQL container")
    if any(container["NetworkSettings"]["Ports"].values()):
        raise SystemExit("Refusing a container with published network ports")

    def sql(db, source, error=None):
        result = subprocess.run(
            ["docker", "exec", "-i", args.container, "psql", "-X", "-qAt",
             "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db],
            input=source, capture_output=True, text=True,
        )
        if error is not None:
            if result.returncode == 0 or error not in result.stderr:
                raise AssertionError(f"Expected failure {error!r}: {result.stdout}\n{result.stderr}")
        elif result.returncode:
            raise AssertionError(f"SQL failed in {db}: {result.stderr}")
        return result.stdout.strip()

    def apply(db, filename, error=None):
        return sql(db, (MIGRATIONS / filename).read_text(), error)

    databases = []
    prefix = "v21r_retire_" + secrets.token_hex(4)

    def database(label, template=None):
        name = prefix + "_" + label
        sql("postgres", f'create database "{name}"' + (f' template "{template}"' if template else "") + ";")
        databases.append(name)
        return name

    def snapshot(db):
        fields = ",".join(
            f"'{table}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.{table} t)"
            for table in TABLES
        )
        return json.loads(sql(db, f"select jsonb_build_object({fields});"))

    def assert_preserved(before, after):
        for row in before["diagnostic_versions"]:
            if row["version_number"] == 3:
                row["status"] = "retired"
        # Aggregation ordering might change only when the status string changes.
        for state in (before, after):
            state["diagnostic_versions"].sort(key=lambda row: row["id"])
        if before != after:
            raise AssertionError("Retirement changed content or historical records")

    def as_user(user, query):
        claims = json.dumps({"sub": user, "role": "authenticated", "aal": "aal1"})
        return f"begin; set local request.jwt.claims = '{claims}'; set local role authenticated; {query}; rollback;"

    try:
        template = database("template")
        sql(template, (FIXTURES / "methodology-retirement-local-auth.sql").read_text())
        for migration in sorted(MIGRATIONS.glob("202609*.sql")):
            if migration.name < "20260918000100":
                apply(template, migration.name)

        # Reproduce both historical paths from the real repository SQL. The
        # production profile intentionally omits the superseded 00100 SQL.
        for profile in ("staging", "production"):
            db = database(profile, template)
            for migration in sorted(MIGRATIONS.glob("20260918*.sql")):
                if profile != "production" or not migration.name.startswith("20260918000100"):
                    apply(db, migration.name)
            sql(db, (FIXTURES / "methodology-retirement-local-history.sql").read_text())
            sql(db, f"update public.diagnostic_versions set status='retired' where id=({VERSION3});", "published methodology is immutable")
            apply(db, LIFECYCLE)
            sql(db, "insert into public.diagnostic_versions(definition_id,version_number,status,content_hash,source_file) select id,99,'draft','local-draft-guard','local' from public.diagnostic_definitions where key='manageability';")
            sql(db, "update public.diagnostic_versions set status='retired' where version_number=99;", "only published methodology can be retired")
            sql(db, f"update public.diagnostic_versions set status='retired',content_hash='tampered' where id=({VERSION3});", "methodology is immutable")
            before = snapshot(db)
            apply(db, RETIREMENT)
            assert_preserved(before, snapshot(db))
            once = snapshot(db)
            apply(db, RETIREMENT)
            if once != snapshot(db):
                raise AssertionError("Second retirement changed data")
            for statement in (
                "set status='published'", "set status='draft'", "set content_hash='tampered'",
                "set source_file='tampered'", "set published_at=now()", "set status='retired'",
            ):
                sql(db, f"update public.diagnostic_versions {statement} where id=({VERSION3});", "methodology is immutable")
            sql(db, f"delete from public.diagnostic_versions where id=({VERSION3});", "methodology is immutable")
            if sql(db, "select version_number from public.diagnostic_versions where status='published' and definition_id=(select id from public.diagnostic_definitions where key='manageability') order by version_number desc limit 1;") != "4":
                raise AssertionError("Current selection is not v4")
            expected = {
                "diagnostic_versions": f"id=({VERSION3})",
                "diagnostic_version_translations": f"version_id=({VERSION3})",
                "diagnostic_blocks": f"version_id=({VERSION3})",
                "diagnostic_block_translations": f"block_id in (select id from public.diagnostic_blocks where version_id=({VERSION3}))",
                "questions": f"version_id=({VERSION3})",
                "question_translations": f"question_id in (select id from public.questions where version_id=({VERSION3}))",
                "question_options": f"question_id in (select id from public.questions where version_id=({VERSION3}))",
                "question_option_translations": f"option_id in (select o.id from public.question_options o join public.questions q on q.id=o.question_id where q.version_id=({VERSION3}))",
                "scoring_policies": f"version_id=({VERSION3})",
                "maturity_levels": f"version_id=({VERSION3})",
                "maturity_level_translations": f"maturity_level_id in (select id from public.maturity_levels where version_id=({VERSION3}))",
            }
            for table in ("diagnostics", "answers", "diagnostic_company_snapshots", "diagnostic_results"):
                expected[table] = "true"
            access_fields = ",".join(f"'{table}',(select count(*) from public.{table} where {condition})" for table, condition in expected.items())
            access_query = f"select jsonb_build_object({access_fields})"
            counts = json.loads(sql(db, access_query + ";"))
            visible = json.loads(sql(db, as_user(OWNER, access_query)))
            denied = json.loads(sql(db, as_user(OTHER, access_query)))
            if visible != counts or any(denied.values()):
                raise AssertionError(f"Retired history RLS mismatch for {profile}: {counts}, {visible}, {denied}")
            sql(db, as_user(OWNER, f"insert into public.diagnostics(company_id,created_by_user_id,version_id) values ('20000000-0000-4000-8000-000000000001','{OWNER}',({VERSION3}))"), "row-level security policy")
            if profile == "staging":
                for query in (
                    f"update public.questions set weight=weight+1 where version_id=({VERSION3})",
                    f"delete from public.questions where version_id=({VERSION3})",
                    f"update public.diagnostic_blocks set weight=weight+1 where version_id=({VERSION3})",
                    f"update public.diagnostic_blocks set version_id=(select id from public.diagnostic_versions where version_number=99) where version_id=({VERSION3})",
                    f"delete from public.diagnostic_blocks where version_id=({VERSION3})",
                    f"update public.question_translations set prompt='tampered' where question_id in (select id from public.questions where version_id=({VERSION3}))",
                    f"delete from public.question_options where question_id in (select id from public.questions where version_id=({VERSION3}))",
                    f"update public.question_option_translations set label='tampered' where option_id in (select o.id from public.question_options o join public.questions q on q.id=o.question_id where q.version_id=({VERSION3}))",
                    f"update public.diagnostic_block_translations set title='tampered' where block_id in (select id from public.diagnostic_blocks where version_id=({VERSION3}))",
                ):
                    sql(db, query + ";", "methodology is immutable")
            print(f"PASS {profile}: actual SQL, status-only retirement, idempotence, exact content/history preservation, pinned retired RLS, fresh v3 rejection", flush=True)

        # A clean logical reconstruction with no v3 must fail, never silently skip.
        missing = database("missing", template)
        apply(missing, "20260918000400_repair_methodology_versions.sql")
        apply(missing, LIFECYCLE)
        apply(missing, RETIREMENT, "version 3 missing")
        sql(missing, "insert into public.diagnostic_versions(definition_id,version_number,status,content_hash,source_file) select id,3,'draft','local-draft','local' from public.diagnostic_definitions where key='manageability';")
        apply(missing, RETIREMENT, "version 3 must be published or retired")
        print("PASS missing/draft v3 fails loudly", flush=True)

        # Post-write selection assertion proves the migration transaction rolls
        # back v3 retirement if an unexpected newer publication is present.
        conflict = database("conflict", template)
        for migration in sorted(MIGRATIONS.glob("20260918*.sql")):
            apply(conflict, migration.name)
        apply(conflict, LIFECYCLE)
        sql(conflict, "insert into public.diagnostic_versions(definition_id,version_number,status,content_hash,source_file) select id,5,'published','local-conflict','local' from public.diagnostic_definitions where key='manageability';")
        before = snapshot(conflict)
        apply(conflict, RETIREMENT, "selection must be version 4")
        if before != snapshot(conflict):
            raise AssertionError("Failed selection assertion did not roll back")
        print("PASS failure after retirement rolls back all changes", flush=True)

        # Reconstruct incomplete v4 fixtures from draft children, without ever
        # disabling or bypassing a published-history guard.
        for defect, expected in (
            ("missing", "version 4 missing"), ("draft", "version 4 missing"),
            ("blocks", "total blocks expected 10"), ("scoring_blocks", "scoring blocks expected 8"),
            ("inactive_block", "active scoring blocks expected 8"),
            ("questions", "total questions expected 84"), ("scoring_questions", "scoring questions expected 80"),
            ("inactive_question", "active numeric scoring questions expected 80"),
            ("text_scoring_question", "active numeric scoring questions expected 80"),
            ("policy", "scoring policies expected 1"), ("maturity", "maturity levels expected 5"),
        ):
            db = database("invalid_" + defect, template)
            sql(db, "insert into public.diagnostic_versions(definition_id,version_number,status,content_hash,source_file) select id,3,'published','local-v3','local' from public.diagnostic_definitions where key='manageability';")
            if defect != "missing":
                v4fixture = """
                  insert into public.diagnostic_versions(definition_id,version_number,status,content_hash,source_file)
                    select id,4,'draft','local-v4','local' from public.diagnostic_definitions where key='manageability';
                  insert into public.diagnostic_blocks(version_id,key,position,weight,is_active)
                    select target.id,b.key,b.position,b.weight,b.is_active from public.diagnostic_blocks b
                    join public.diagnostic_versions source on source.id=b.version_id and source.version_number=1
                    join public.diagnostic_versions target on target.definition_id=source.definition_id and target.version_number=4;
                  insert into public.questions(version_id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score)
                    select target.version_id,target.id,q.key,q.position,q.answer_type,q.weight,q.is_required,q.is_active,q.reverse_score
                    from public.questions q join public.diagnostic_blocks source on source.id=q.block_id
                    join public.diagnostic_versions v on v.id=q.version_id and v.version_number=1
                    join public.diagnostic_versions v4 on v4.definition_id=v.definition_id and v4.version_number=4
                    join public.diagnostic_blocks target on target.version_id=v4.id and target.key=source.key;
                  insert into public.scoring_policies(version_id,engine_key,engine_version,schema_version,configuration,policy_hash)
                    select target.id,p.engine_key,p.engine_version,p.schema_version,p.configuration,p.policy_hash
                    from public.scoring_policies p join public.diagnostic_versions v on v.id=p.version_id and v.version_number=1
                    join public.diagnostic_versions target on target.definition_id=v.definition_id and target.version_number=4;
                  insert into public.maturity_levels(version_id,key,position,classification_config)
                    select target.id,m.key,m.position,m.classification_config from public.maturity_levels m
                    join public.diagnostic_versions v on v.id=m.version_id and v.version_number=1
                    join public.diagnostic_versions target on target.definition_id=v.definition_id and target.version_number=4;
                """
                sql(db, v4fixture)
                edits = {
                    "blocks": f"update public.questions set block_id=(select id from public.diagnostic_blocks where version_id=({VERSION4}) and position=9),position=position+100 where version_id=({VERSION4}) and block_id=(select id from public.diagnostic_blocks where version_id=({VERSION4}) and position=10); delete from public.diagnostic_blocks where version_id=({VERSION4}) and position=10;",
                    "scoring_blocks": f"update public.diagnostic_blocks set weight=0 where version_id=({VERSION4}) and position=2;",
                    "inactive_block": f"update public.diagnostic_blocks set is_active=false where version_id=({VERSION4}) and position=2;",
                    "questions": f"delete from public.questions where version_id=({VERSION4}) and key=(select key from public.questions where version_id=({VERSION4}) order by key limit 1);",
                    "scoring_questions": f"update public.questions set weight=0 where version_id=({VERSION4}) and key=(select key from public.questions where version_id=({VERSION4}) and weight>0 order by key limit 1);",
                    "inactive_question": f"update public.questions set is_active=false where version_id=({VERSION4}) and key=(select key from public.questions where version_id=({VERSION4}) and weight>0 order by key limit 1);",
                    "text_scoring_question": f"update public.questions set answer_type='text' where version_id=({VERSION4}) and key=(select key from public.questions where version_id=({VERSION4}) and weight>0 order by key limit 1);",
                    "policy": f"delete from public.scoring_policies where version_id=({VERSION4});",
                    "maturity": f"delete from public.maturity_levels where version_id=({VERSION4}) and position=5;",
                }
                if defect in edits:
                    sql(db, edits[defect])
                if defect != "draft":
                    sql(db, f"update public.diagnostic_versions set status='published' where id=({VERSION4});")
            apply(db, LIFECYCLE)
            before = snapshot(db)
            apply(db, RETIREMENT, expected)
            if before != snapshot(db):
                raise AssertionError(f"Incomplete v4 failure mutated data: {defect}")
            print(f"PASS v4 {defect}: fails before retirement, exact rollback", flush=True)
    finally:
        for db in reversed(databases):
            sql("postgres", f'drop database "{db}";')


if __name__ == "__main__":
    main()
