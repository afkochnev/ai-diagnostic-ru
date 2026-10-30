#!/usr/bin/env python3
"""Own-result SQL authorization and scoring parity in a disposable local database."""
import argparse
import json
import secrets
import subprocess
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--container", required=True)
args = parser.parse_args()
if args.container not in ("supabase_db_aca-v25-local-e2e", "supabase_db_ai-diagnostic-ru"):
    raise SystemExit("An existing local Supabase development container is required")
info = json.loads(subprocess.check_output(["docker", "inspect", args.container]))[0]
if not info["Config"]["Image"].startswith("public.ecr.aws/supabase/postgres:"):
    raise SystemExit("Local Supabase PostgreSQL required")
database = "participant_result_" + secrets.token_hex(6)

def sql(query, expected_error=None, db=None):
    result = subprocess.run(["docker", "exec", "-i", args.container, "psql", "-XqAt",
        "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db or database],
        input=query, text=True, capture_output=True)
    if expected_error:
        assert result.returncode and expected_error in result.stderr, result.stderr
    elif result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()

def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"

def actor(user, query, error=None, setup="", rollback=False, role="authenticated"):
    claims = literal({"sub": user, "role": role, "aal": "aal2" if user == uid(4) else "aal1"})
    return sql("begin;" + setup + ";set local request.jwt.claims=" + claims.removesuffix("::jsonb")
        + ";set local role " + role + ";" + query + ";" + ("rollback;" if rollback else "commit;"), error)

def uid(number):
    return "10000000-0000-4000-8000-" + str(number).zfill(12)

def result(participant, user=2):
    return json.loads(actor(uid(user), f"select public.read_team_participant_result('{participant}')"))

def parity(participant):
    output = result(participant)
    source = json.loads(sql(f"select jsonb_build_object('snapshot',s.snapshot,'answers',r.answers) "
        f"from private.team_scoring_snapshots s join public.team_participants p on p.team_diagnostic_id=s.team_diagnostic_id "
        f"join private.team_responses r on r.participant_id=p.id where p.id='{participant}'"))
    code = """import {calculateBlockScore,calculateOverall,classifyMaturity} from './src/server/scoring/engine.ts';
let text='';for await(const chunk of process.stdin)text+=chunk;const {snapshot:s,answers:a}=JSON.parse(text);
const blocks=s.blocks.filter(b=>Number(b.weight)>0).map(b=>({...calculateBlockScore({block_id:b.id,block_weight:b.weight,
questions:s.questions.filter(q=>q.block_id===b.id).map(q=>({...q,is_active:true,is_required:q.required})),
answers:Object.entries(a).map(([question_id,value])=>({question_id,numeric_value:typeof value==='number'?value:null}))}),block_weight:b.weight}));
const overall=calculateOverall(blocks);process.stdout.write(JSON.stringify({raw:overall.raw.toString(),display:overall.display.toString(),
maturity:s.maturity[classifyMaturity(overall.raw)-1].label,blocks:blocks.map(b=>({id:b.block_id,raw:b.raw.toString(),display:b.display.toString()}))}));"""
    oracle = json.loads(subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", code],
        cwd=ROOT, input=json.dumps(source), text=True, capture_output=True, check=True).stdout)
    assert abs(Decimal(str(output["overall_raw"])) - Decimal(oracle["raw"])) < Decimal("1e-12")
    assert Decimal(str(output["overall_display"])) == Decimal(oracle["display"])
    assert output["maturity_label"] == oracle["maturity"]
    assert set(output) == {"participant_id", "display_name", "team_title", "status", "completed_at", "overall_raw", "overall_display", "maturity_label", "blocks"}
    assert output["status"] == "completed" and output["participant_id"] == participant
    assert [b["position"] for b in output["blocks"]] == sorted(b["position"] for b in output["blocks"])
    for block in output["blocks"]:
        original = next(b for b in oracle["blocks"] if b["id"] == block["block_id"])
        assert abs(Decimal(str(block["raw_score"])) - Decimal(original["raw"])) < Decimal("1e-12")
        assert Decimal(str(block["display_score"])) == Decimal(original["display"])
        assert block["question_count"] == sum(q["block_id"] == block["block_id"] and q["answer_type"] == "scale_0_4" for q in source["snapshot"]["questions"])
        assert set(block) == {"block_id", "title", "position", "raw_score", "display_score", "question_count"}
    return output

def complete(team, offset=0, check_incomplete=True):
    # Test data only: do not configure or exercise historical launch-control runs.
    participant = sql(f"insert into public.team_participants(team_diagnostic_id,email,display_name) values('{team}','account-fixture-2@example.test','Own result') returning id")
    sql(f"insert into private.team_responses(participant_id,user_id) values('{participant}','{uid(2)}')")
    if check_incomplete:
        actor(uid(2), f"select public.read_team_participant_result('{participant}')", "team_result_incomplete")
    response = json.loads(actor(uid(2), f"select public.read_team_response('{participant}')"))
    answers = {q["id"]: ((index + offset) % 5 if q["answer_type"] == "scale_0_4" else "Private text excluded from result")
        for index, q in enumerate(response["questions"])}
    sql(f"update private.team_responses set answers={literal(answers)},revision=1,completed_at=now() where participant_id='{participant}';"
        f"update public.team_participants set status='completed',started_at=now(),completed_at=now() where id='{participant}'")
    return participant

def new_team(title):
    # Original creation implementation pins the real methodology snapshot.
    # It is used solely as a fixture builder, with the owner JWT and postgres test role.
    claims = literal({"sub": uid(1), "role": "authenticated", "aal": "aal1"}).removesuffix("::jsonb")
    return sql(f"begin;set local request.jwt.claims={claims};select private.create_team_before_launch_controls('20000000-0000-4000-8000-000000000001','{title}');commit;")

try:
    sql("create database " + database, db="postgres")
    sql((ROOT / "supabase/tests/fixtures/methodology-retirement-local-auth.sql").read_text())
    sql("alter table auth.users add column created_at timestamptz not null default now();"
        "create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));"
        "create schema extensions;create extension pgcrypto with schema extensions;")
    candidate = next((ROOT / "supabase/migrations").glob("*_team_participant_own_result.sql"))
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        if migration == candidate:
            continue
        if "account_foundation.sql" in migration.name:
            sql((ROOT / "supabase/tests/fixtures/account-foundation-local-history.sql").read_text())
        sql(migration.read_text())
    sql("update private.launch_controls set team_creation_enabled=true,team_invitations_enabled=true;")
    account = sql("select id from public.accounts where legacy_origin_user_id='" + uid(1) + "'")
    actor(None, f"select public.assign_account_plan('{account}','advanced')", role="service_role")
    team = new_team("Historical completed participant")
    # Existing completed responses must work immediately, without resubmission/backfill.
    participant = complete(team, check_incomplete=False)
    before = sql("select md5(string_agg(to_jsonb(r)::text,',' order by participant_id)) from private.team_responses r")
    sql(candidate.read_text())
    initial = parity(participant)
    assert len(initial["blocks"]) == 8
    assert before == sql("select md5(string_agg(to_jsonb(r)::text,',' order by participant_id)) from private.team_responses r")
    print("PASS existing completed participant gets own result; 8-block scores match unchanged Individual engine", flush=True)
    for number in (1, 3, 4, 5):
        actor(uid(number), f"select public.read_team_participant_result('{participant}')", "team_response_unavailable")
    actor(None, f"select public.read_team_participant_result('{participant}')", "permission denied", role="anon")
    actor(uid(2), "select * from private.team_scoring_snapshots", "permission denied")
    for setup in (f"update public.team_participants set revoked_at=now() where id='{participant}'",
        f"update auth.users set email='changed@example.test' where id='{uid(2)}'",
        f"update auth.users set email_confirmed_at=null where id='{uid(2)}'",
        f"update public.accounts set status='archived' where legacy_origin_user_id='{uid(1)}'"):
        actor(uid(2), f"select public.read_team_participant_result('{participant}')", "team_response_unavailable", setup=setup)
    sql(f"update public.team_diagnostics set status='closed' where id='{team}'")
    assert result(participant) == initial
    print("PASS owner/admin/other/unverified/anon denied; revoked/email mismatch/inactive denied; closed Team preserves own result", flush=True)
    # Unequal question/block weights and reverse scoring; no premature block rounding.
    sql((ROOT / "supabase/tests/fixtures/team-scoring-golden.sql").read_text())
    for offset in range(5):
        weighted_team = new_team("Weighted own result")
        own = complete(weighted_team, offset)
        assert len(parity(own)["blocks"]) == 2
    print("PASS five weighted/reversed vectors match Individual raw, one-decimal half-up display and maturity", flush=True)
    assert sql("select count(*) from public.team_ai_reports") == "0"
    print("PASS own-result reads enqueue no AI and return no answers, aggregates or other participant fields", flush=True)
finally:
    sql("drop database if exists " + database + " with(force)", db="postgres")
