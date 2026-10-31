#!/usr/bin/env python3
"""Exercise promo RPCs in a disposable PostgreSQL cluster using Unix sockets only.

No environment files, cloud credentials, external providers or existing databases
are read. The finite-plan model, rate limiter and billing guard are loaded from
their actual existing migrations; only the minimal Auth shell is a fixture.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
CHECKS = []


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def definition(source, signature):
    start = source.index(signature)
    end = source.index("$$;", start) + 3
    return source[start:end]


def main():
    binaries = {name: shutil.which(name) for name in ("initdb", "pg_ctl", "psql")}
    if not all(binaries.values()):
        raise RuntimeError("Local initdb, pg_ctl and psql are required")
    with tempfile.TemporaryDirectory(prefix="ai-promo-pg-") as directory:
        base = Path(directory)
        data, socket = base / "data", base / "socket"
        socket.mkdir()
        clean_env = {k: v for k, v in os.environ.items() if not k.startswith("PG") and k not in ("DATABASE_URL", "SUPABASE_DB_PASSWORD")}
        init = subprocess.run([binaries["initdb"], "-D", str(data), "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], env=clean_env, capture_output=True, text=True)
        if init.returncode:
            raise RuntimeError("Could not initialize isolated local PostgreSQL: " + init.stderr[-1000:])
        options = f"-k {socket} -p 65473 -h '' -F -c fsync=off -c timezone=UTC"
        started = subprocess.run([binaries["pg_ctl"], "-D", str(data), "-l", str(base / "postgres.log"), "-o", options, "-w", "start"], env=clean_env, capture_output=True, text=True)
        if started.returncode:
            raise RuntimeError("Could not start isolated socket-only PostgreSQL: " + started.stderr[-1000:])
        try:
            psql = [binaries["psql"], "-XqAt", "-v", "ON_ERROR_STOP=1", "-h", str(socket), "-p", "65473", "-U", "postgres", "-d", "postgres"]

            def sql(query, error=None):
                result = subprocess.run(psql, input=query, env=clean_env, capture_output=True, text=True)
                if error:
                    assert result.returncode and error in result.stderr, (error, result.stderr[-1200:])
                    return None
                if result.returncode:
                    raise AssertionError(result.stderr[-1800:])
                return result.stdout.strip()

            def check(name):
                CHECKS.append(name)
                print("PASS " + name, flush=True)

            def actor(expression, user, role="authenticated", aal="aal1", session=None, error=None):
                claims = {"sub": user, "role": role, "aal": aal, "session_id": session or user}
                query = "begin;set local request.jwt.claims=" + literal(json.dumps(claims)) + ";set local role " + role + ";select " + expression + ";commit;"
                result = sql(query, error)
                return json.loads(result) if result else None

            def count(table, predicate="true"):
                return int(sql(f"select count(*) from {table} where {predicate}"))

            def fresh_account(owner):
                account = str(uuid.uuid4())
                sql(f"insert into public.accounts(id) values({literal(account)});insert into public.account_memberships values({literal(account)},{literal(owner)},'owner','active');")
                return account

            def active_snapshot(account):
                return json.loads(sql("select jsonb_agg(to_jsonb(s) order by id) from private.account_subscriptions s where account_id=" + literal(account)))

            def plan(account, owner):
                return actor(f"public.read_account_plan({literal(account)})", owner)["plan"]

            def create_promo(limit=5, deadline="clock_timestamp()+interval '1 day'", code=None, label="Local promo", ciphertext=None, new_api=False):
                code = code or "ITEAM-" + secrets.token_hex(12).upper()
                extra = "," + (literal(ciphertext) if ciphertext is not None else "null::text") if new_api else ""
                created = actor(f"public.admin_create_advanced_promo({literal(code)},{literal(label)},{limit},{deadline}{extra})", admin)
                return code, created

            def cipher_fixture():
                # The server owns authenticated encryption; SQL only stores the
                # bounded versioned envelope and must never reinterpret it.
                return "v1." + secrets.token_hex(12) + "." + secrets.token_hex(30) + "." + secrets.token_hex(16)

            def redeem(account, code, owner):
                return actor(f"public.redeem_advanced_promo({literal(account)},{literal(code)})", owner)

            def set_plan(account, key, source="manual", start="clock_timestamp()", end="null"):
                sql(f"update private.account_subscriptions set status='ended',effective_until=clock_timestamp() where account_id={literal(account)} and status='active';"
                    f"insert into private.account_subscriptions(account_id,plan_id,status,source,provider_key,effective_from,effective_until) select {literal(account)},id,'active',{literal(source)},{literal('yookassa') if source == 'provider' else 'null'},{start},{end} from public.plans where key={literal(key)};")

            sql((ROOT / "supabase/tests/fixtures/advanced-promo-local.sql").read_text())
            core = (MIGRATIONS / "20261018071921_plans_entitlements_billing_foundation.sql").read_text()
            sql(core[:core.index("-- Existing create/invite")] + "\ncommit;")
            admin_source = (MIGRATIONS / "20261020170720_v24_admin_console_and_plan_audit.sql").read_text()
            sql(definition(admin_source, "create function private.admin_console_actor()"))
            sql((MIGRATIONS / "20260916000400_rate_limits.sql").read_text())
            billing_source = (MIGRATIONS / "20261021132005_billing_commercial_activation.sql").read_text()
            sql(definition(billing_source, "create function private.billing_prevent_manual_provider()") + "\ncreate trigger billing_manual_plan_guard before insert on private.account_subscriptions for each row execute function private.billing_prevent_manual_provider();")
            sql((MIGRATIONS / "20261031164043_advanced_promo_codes.sql").read_text())
            assert count("private.advanced_promo_codes") == count("private.advanced_promo_redemptions") == 0
            check("migration creates no live or seeded codes")

            admin, owner, outsider, unconfirmed = [str(uuid.uuid4()) for _ in range(4)]
            for user in (admin, owner, outsider, unconfirmed):
                sql(f"insert into auth.users values({literal(user)},{'null' if user == unconfirmed else 'clock_timestamp()'});insert into public.users values({literal(user)});insert into auth.sessions values({literal(user)},{literal(user)});insert into public.user_roles values({literal(user)},{literal('administrator' if user == admin else 'user')});")

            # The approved Admin Console policy permits a verified live AAL1 admin.
            code, issued = create_promo(limit=2)
            assert issued["code_hint"] == "ITEAM-…" + code[-4:]
            assert set(issued) == {"id", "label", "code_hint", "max_redemptions", "redemptions", "redeem_until", "revoked_at", "created_at"}
            assert code not in json.dumps(issued) and "code_hash" not in json.dumps(issued)
            stored = sql("select code_hash from private.advanced_promo_codes where id=" + literal(issued["id"]))
            assert re.fullmatch("[a-f0-9]{64}", stored)
            sql((MIGRATIONS / "20261031180515_advanced_promo_admin_management.sql").read_text())
            assert count("private.advanced_promo_codes") == 1 and count("private.advanced_promo_redemptions") == 0
            legacy = actor("public.admin_list_advanced_promos()", admin)["rows"][0]
            assert legacy["id"] == issued["id"] and legacy["code_hash"] == stored and legacy["code_ciphertext"] is None
            assert sql("select code_hash from private.advanced_promo_codes where id=" + literal(issued["id"])) == stored
            old_code = "ITEAM-" + secrets.token_hex(12).upper()
            compatible = actor(f"public.admin_create_advanced_promo(p_code=>{literal(old_code)},p_label=>'Old caller',p_max_redemptions=>1,p_redeem_until=>clock_timestamp()+interval '1 day')", admin)
            assert set(compatible) == set(issued)
            assert sql("select code_ciphertext is null from private.advanced_promo_codes where id=" + literal(compatible["id"])) == "t"
            _, explicit_null = create_promo(new_api=True)
            assert sql("select code_ciphertext is null from private.advanced_promo_codes where id=" + literal(explicit_null["id"])) == "t"
            check("rolling migration preserves legacy hashes and both positional/named four-argument callers")

            ciphertext = cipher_fixture()
            encrypted_code, encrypted = create_promo(ciphertext=ciphertext, new_api=True)
            row = json.loads(sql("select to_jsonb(p) from private.advanced_promo_codes p where id=" + literal(encrypted["id"])))
            assert len(ciphertext) == 121 and row["code_ciphertext"] == ciphertext
            assert row["code_hash"] == hashlib.sha256(encrypted_code.encode()).hexdigest()
            assert row["created_by_user_id"] == admin and encrypted_code not in json.dumps(row)
            encrypted_list = next(item for item in actor("public.admin_list_advanced_promos()", admin)["rows"] if item["id"] == encrypted["id"])
            assert encrypted_list["code_ciphertext"] == ciphertext and encrypted_list["code_hash"] == row["code_hash"]
            assert encrypted_code not in json.dumps(encrypted_list) and set(encrypted) == set(issued)
            check("new issuance stores exact encrypted envelope and hash; only admin listing returns ciphertext/hash")

            before_invalid = count("private.advanced_promo_codes")
            for invalid in ("", encrypted_code, ciphertext + "0", ciphertext.replace("v1.", "v2.", 1), "v1." + "A" * 24 + "." + "b" * 60 + "." + "c" * 32, ciphertext[:-1], "x" * 1000):
                candidate = "ITEAM-" + secrets.token_hex(12).upper()
                actor(f"public.admin_create_advanced_promo({literal(candidate)},'Invalid envelope',1,clock_timestamp()+interval '1 day',{literal(invalid)})", admin, error="promo_invalid_input")
            assert count("private.advanced_promo_codes") == before_invalid
            sql(f"update private.advanced_promo_codes set code_ciphertext={literal(encrypted_code)} where id={literal(encrypted['id'])}", error="advanced_promo_ciphertext_shape")
            check("invalid, plaintext and oversized encrypted payloads fail before issuance and at the column constraint")
            actor(f"public.admin_create_advanced_promo({literal(code.lower())},'Duplicate',1,clock_timestamp()+interval '1 day')", admin, error="promo_code_exists")
            for call in ("public.admin_list_advanced_promos()", f"public.admin_revoke_advanced_promo({literal(issued['id'])})"):
                actor(call, owner, error="admin_access_denied")
                actor(call, admin, session=str(uuid.uuid4()), error="admin_access_denied")
            check("admin issuance is live-session-bound, ASCII-canonical and returns safe metadata")

            unauthorized_calls = (
                f"public.admin_create_advanced_promo({literal('ITEAM-' + 'E' * 24)},'Unauthorized',1,clock_timestamp()+interval '1 day')",
                f"public.admin_create_advanced_promo({literal('ITEAM-' + 'E' * 24)},'Unauthorized',1,clock_timestamp()+interval '1 day',{literal(ciphertext)})",
                "public.admin_list_advanced_promos()",
                f"public.admin_delete_advanced_promo({literal(encrypted['id'])})",
            )
            protected = sql("select to_jsonb(p) from private.advanced_promo_codes p where id=" + literal(encrypted["id"]))
            for call in unauthorized_calls:
                actor(call, owner, error="admin_access_denied")
                actor(call, unconfirmed, error="admin_access_denied")
                actor(call, admin, session=str(uuid.uuid4()), error="admin_access_denied")
                for role in ("anon", "service_role"):
                    actor(call, admin, role=role, error="permission denied")
            assert sql("select to_jsonb(p) from private.advanced_promo_codes p where id=" + literal(encrypted["id"])) == protected
            assert count("private.advanced_promo_codes") == before_invalid
            check("create/list/archive require a real live admin; anon, service-role and stale sessions cannot access encrypted fields")

            account = fresh_account(owner)
            actor(f"public.redeem_advanced_promo({literal(account)},{literal(code)})", outsider, error="promo_not_found")
            bad_account = fresh_account(unconfirmed)
            actor(f"public.redeem_advanced_promo({literal(bad_account)},{literal(code)})", unconfirmed, error="promo_not_found")
            actor(f"public.redeem_advanced_promo({literal(account)},{literal(code)})", owner, role="anon", error="permission denied")
            actor(f"(select count(*) from private.advanced_promo_codes)", owner, error="permission denied")
            actor(f"public.admin_list_advanced_promos()", admin, role="service_role", error="permission denied")
            assert sql("select bool_and(relrowsecurity) from pg_class where oid in('private.advanced_promo_codes'::regclass,'private.advanced_promo_redemptions'::regclass)") == "t"
            check("owner/confirmed-session checks, private RLS and least-privilege grants")

            activated = redeem(account, "  " + code.lower() + "  ", owner)
            assert activated["status"] == "activated" and plan(account, owner) == "advanced"
            assert sql("select bool_and(source='manual' and effective_until-effective_from=interval '30 days') from private.account_subscriptions where status='active' and account_id=" + literal(account)) == "t"
            snapshot = active_snapshot(account)
            retried = redeem(account, code, owner)
            assert retried == {**activated, "status": "already_redeemed"}
            assert active_snapshot(account) == snapshot
            assert count("private.advanced_promo_redemptions", "account_id=" + literal(account)) == 1
            sql("update private.advanced_promo_redemptions set effective_until=effective_until+interval '1 day' where account_id=" + literal(account), error="promo_redemption_immutable")
            check("exact 30-day grant, no extension on retry and immutable redemption audit")

            # Already Advanced must not consume the remaining campaign capacity.
            for source in ("manual", "provider"):
                current = fresh_account(owner)
                set_plan(current, "advanced", source, end="clock_timestamp()+interval '365 days'")
                before = active_snapshot(current)
                result = redeem(current, code, owner)
                assert result["status"] == "already_advanced" and active_snapshot(current) == before
            assert count("private.advanced_promo_redemptions", "promo_id=" + literal(issued["id"])) == 1
            check("manual and paid Advanced retain their exact subscription history without consumption")

            # Even expired paid state must not be manually reclassified or shortened.
            stale = fresh_account(owner)
            set_plan(stale, "advanced", "provider", "clock_timestamp()-interval '45 days'", "clock_timestamp()-interval '1 day'")
            sql(f"insert into private.billing_provider_subscriptions(account_id,status) values({literal(stale)},'active')")
            before = active_snapshot(stale)
            assert plan(stale, owner) == "free" and redeem(stale, code, owner)["status"] == "billing_managed"
            assert active_snapshot(stale) == before
            check("stale expired provider access is reported without rewriting billing history")

            # Expired manual rows may be closed without changing their historic end date.
            expired_manual = fresh_account(owner)
            set_plan(expired_manual, "advanced", "manual", "clock_timestamp()-interval '45 days'", "clock_timestamp()-interval '1 day'")
            old_until = sql("select effective_until::text from private.account_subscriptions where status='active' and account_id=" + literal(expired_manual))
            assert redeem(expired_manual, code, owner)["status"] == "activated"
            assert sql("select effective_until::text from private.account_subscriptions where source='manual' and status='ended' and account_id=" + literal(expired_manual)) == old_until
            exhausted = fresh_account(owner)
            assert redeem(exhausted, code, owner)["status"] == "invalid" and plan(exhausted, owner) == "free"
            assert redeem(account, code, owner)["status"] == "already_redeemed"
            check("finite manual history is preserved and exhausted codes remain idempotent for prior accounts")

            revoke_code, revoke = create_promo()
            revoke_account = fresh_account(owner)
            until = redeem(revoke_account, revoke_code, owner)["effective_until"]
            first_revoke = actor(f"public.admin_revoke_advanced_promo({literal(revoke['id'])})", admin)
            assert actor(f"public.admin_revoke_advanced_promo({literal(revoke['id'])})", admin) == first_revoke
            assert redeem(revoke_account, revoke_code, owner) == {"status": "already_redeemed", "effective_until": until}
            assert redeem(fresh_account(owner), revoke_code, owner)["status"] == "invalid"
            check("revocation stops new redemptions while preserving existing grants and retries")

            archive_code, archive = create_promo(ciphertext=cipher_fixture(), new_api=True)
            archive_account = fresh_account(owner)
            archive_access = redeem(archive_account, archive_code, owner)
            subscriptions_before = active_snapshot(archive_account)
            redemption_before = sql("select to_jsonb(r) from private.advanced_promo_redemptions r where promo_id=" + literal(archive["id"]))
            row_count_before = count("private.advanced_promo_codes")
            archived = actor(f"public.admin_delete_advanced_promo({literal(archive['id'])})", admin)
            assert set(archived) == {"id", "deleted_at"} and archived["id"] == archive["id"] and archived["deleted_at"]
            assert actor(f"public.admin_delete_advanced_promo({literal(archive['id'])})", admin) == archived
            assert count("private.advanced_promo_codes") == row_count_before
            assert active_snapshot(archive_account) == subscriptions_before and plan(archive_account, owner) == "advanced"
            assert sql("select to_jsonb(r) from private.advanced_promo_redemptions r where promo_id=" + literal(archive["id"])) == redemption_before
            assert redeem(archive_account, archive_code, owner) == {**archive_access, "status": "already_redeemed"}
            assert redeem(fresh_account(owner), archive_code, owner)["status"] == "invalid"
            assert archive["id"] not in {item["id"] for item in actor("public.admin_list_advanced_promos()", admin)["rows"]}
            assert sql("select deleted_at=revoked_at and code_ciphertext is not null from private.advanced_promo_codes where id=" + literal(archive["id"])) == "t"
            sql("update private.advanced_promo_codes set revoked_at=null where id=" + literal(archive["id"]), error="advanced_promo_deleted_state")
            actor(f"public.admin_delete_advanced_promo({literal(str(uuid.uuid4()))})", admin, error="promo_not_found")
            check("archive is idempotent, hidden and non-physical; prior grant/history/retry stay exact and new redemptions stop")

            revoked_before_archive = sql("select revoked_at::text from private.advanced_promo_codes where id=" + literal(revoke["id"]))
            actor(f"public.admin_delete_advanced_promo({literal(revoke['id'])})", admin)
            assert sql("select revoked_at::text from private.advanced_promo_codes where id=" + literal(revoke["id"])) == revoked_before_archive
            check("archival preserves an earlier explicit revocation timestamp")

            expired_code, expired = create_promo()
            sql(f"update private.advanced_promo_codes set created_at=clock_timestamp()-interval '2 days',redeem_until=clock_timestamp()-interval '1 day' where id={literal(expired['id'])}")
            assert redeem(fresh_account(owner), expired_code, owner)["status"] == "invalid"
            actor(f"public.admin_create_advanced_promo({literal('ITEAM-' + 'F'*24)},'Expired',1,clock_timestamp()-interval '1 second')", admin, error="promo_invalid_input")
            check("expiry is enforced by database time, not browser input")

            # An already expired historical redemption never obtains another month.
            historical_code, historical = create_promo()
            historical_account = fresh_account(owner)
            set_plan(historical_account, "advanced", "manual", "clock_timestamp()-interval '45 days'", "clock_timestamp()-interval '15 days'")
            sql(f"insert into private.advanced_promo_redemptions(promo_id,account_id,redeemed_by_user_id,subscription_id,redeemed_at,effective_until) select {literal(historical['id'])},{literal(historical_account)},{literal(owner)},id,effective_from,effective_until from private.account_subscriptions where account_id={literal(historical_account)} and status='active'")
            before = active_snapshot(historical_account)
            assert redeem(historical_account, historical_code, owner)["status"] == "already_redeemed"
            assert active_snapshot(historical_account) == before and plan(historical_account, owner) == "free"
            check("expired previous redemption returns original deadline and remains Free")

            limited_account = fresh_account(owner)
            for _ in range(10):
                assert redeem(limited_account, "invalid", owner)["status"] == "invalid"
            assert redeem(limited_account, historical_code, owner)["status"] == "rate_limited"
            assert int(sql("select count from public.rate_limit_windows where key=" + literal("advanced-promo:" + owner + ":" + limited_account))) == 10
            assert plan(limited_account, owner) == "free"
            check("direct-RPC invalid attempts commit and rate-limit valid codes after ten attempts")

            # Different Accounts race for one remaining use: the code row serializes them.
            race_code, race = create_promo(limit=1)
            accounts = [fresh_account(owner), fresh_account(outsider)]
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(redeem, acc, race_code, user) for acc, user in zip(accounts, (owner, outsider))]
                results = [future.result() for future in futures]
            assert sorted(result["status"] for result in results) == ["activated", "invalid"]
            assert count("private.advanced_promo_redemptions", "promo_id=" + literal(race["id"])) == 1
            same_code, same = create_promo(limit=1)
            same_account = fresh_account(owner)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: redeem(same_account, same_code, owner), range(2)))
            assert sorted(result["status"] for result in results) == ["activated", "already_redeemed"]
            assert results[0]["effective_until"] == results[1]["effective_until"]
            check("concurrent capacity and same-account replay cannot duplicate or extend access")

            archive_race_code, archive_race = create_promo(ciphertext=cipher_fixture(), new_api=True)
            archive_race_account = fresh_account(owner)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                redeem_future = pool.submit(redeem, archive_race_account, archive_race_code, owner)
                delete_future = pool.submit(actor, f"public.admin_delete_advanced_promo({literal(archive_race['id'])})", admin)
                race_redemption, race_archive = redeem_future.result(), delete_future.result()
            assert race_archive["deleted_at"] and race_redemption["status"] in ("activated", "invalid")
            assert count("private.advanced_promo_redemptions", "promo_id=" + literal(archive_race["id"])) == (1 if race_redemption["status"] == "activated" else 0)
            assert plan(archive_race_account, owner) == ("advanced" if race_redemption["status"] == "activated" else "free")
            assert redeem(archive_race_account, archive_race_code, owner)["status"] == ("already_redeemed" if race_redemption["status"] == "activated" else "invalid")
            check("archive/redemption race either grants once before archival or rejects; no granted access is removed")

            for index in range(26):
                _, newest = create_promo(label=f"Safe list {index}")
            actor(f"public.admin_delete_advanced_promo({literal(newest['id'])})", admin)
            listed = actor("public.admin_list_advanced_promos()", admin)
            assert len(listed["rows"]) == 25
            assert all(set(row) == set(issued) | {"code_ciphertext", "code_hash"} for row in listed["rows"])
            assert all(re.fullmatch("[a-f0-9]{64}", row["code_hash"]) for row in listed["rows"])
            assert newest["id"] not in {row["id"] for row in listed["rows"]} and code not in json.dumps(listed)
            check("admin list fills 25 unarchived rows with bounded admin-only encrypted fields and no plaintext")
            print(f"PASS {len(CHECKS)} isolated PostgreSQL promo scenarios; no remote operations", flush=True)
        finally:
            subprocess.run([binaries["pg_ctl"], "-D", str(data), "-m", "immediate", "-w", "stop"], env=clean_env, capture_output=True, text=True, check=False)


if __name__ == "__main__":
    main()
