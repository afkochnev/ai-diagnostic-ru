# Render plan PATCH: local contract diagnosis

Status: `V27_TEAM_W2_RENDER_PLAN_PATCH_PROVIDER_HOLD`.

The failed staging plan request already had the documented nested body. The
sealed request therefore does not establish a serialization or field-placement
defect. HTTP 400 establishes request rejection; its specific provider reason is
unknown because the old transport checked status before reading the response
body. Do not attribute it to billing, permissions, unsupported plan IDs or
malformed JSON without separate evidence.

## Reconstructed request

The accepted source at `e9666fee982fff1186e41edc9b2055b7aadccde6`, its sealed
operator source and the durable request/receipt commitments establish:

| Field | Exact value |
| --- | --- |
| Method | `PATCH` |
| URL | `https://api.render.com/v1/services/srv-daiqfnrm8hqs73dtaf1g` |
| Content-Type | `application/json` |
| Serialized body | `{"serviceDetails":{"plan":"0.5c-512mb"}}` |
| Body SHA-256 | `4c9c77d5008f1f6ba4a135abd54bed05677e5198cced5d6f389b82cd0bdcde9e` |
| Historical journal request SHA-256 | `9d3c9a3bff07404e7e69b1298682fc2126b8d39e59b6e6ae437542da40dc4246` |

The body is 40 UTF-8 bytes without a trailing newline. The historical journal
request hash additionally binds stage, method, URL and ordinal 23; it is not the
body hash. This is a source-and-journal-bound reconstruction, not a raw network
capture. Authorization material is excluded.

Neither a top-level `plan`, nested `buildPlan`, nor a complete retrieved service
object was sent as the body. The old slot remains `UNKNOWN_SPENT_STOP` and is
never reopened, reused or reset.

## Official contract and compatibility

Reviewed on 2026-10-26:

- [Update service](https://api-docs.render.com/reference/update-service) specifies
  PATCH on `/v1/services/{serviceId}` with an `application/json` request body.
- [Compute plans: API changes](https://render.com/docs/compute-plans#changing-a-services-compute-plan)
  places `plan` under `serviceDetails` for this endpoint.
- The current [OpenAPI document](https://api-docs.render.com/openapi/render-public-api-1.json)
  connects `servicePATCH.serviceDetails` to the web-service PATCH branch and
  `webServiceDetailsPATCH.plan` to `components.schemas.plan`. That enum includes
  both `0.5c-512mb` and `starter`.
- [Legacy plan names](https://render.com/docs/compute-plans#legacy-plan-names)
  maps `starter` to `0.5c-512mb` and documents API support for legacy names.

These references support the local request contract. They cannot prove why one
historical provider request was rejected. A stale enum would not prove that
cause either. There is no automatic `starter` fallback, compatibility retry or
legacy mode in this change.

## Local adapter boundary

`scripts/operator-w2/render-plan-patch-contract.ts` accepts only plain objects
with exact own enumerable data fields: `serviceDetails`, then `plan`, then the
literal `0.5c-512mb`. It pins canonical bytes and their SHA-256, rejects extra or
inherited fields, accessors and alternative plan values, and checks synchronous
preconditions before any explicit credential consumer can run.

The module has no fetch, default credential reader, Journal, reservation or
mutation execution path. Preparation is local validation, not authorization to
send a request. Any future caller must independently prove its approved scope,
durable reservation and operational preconditions before using credentials.
The sealed old caller is preserved; this module is not retroactively installed
into that spent attempt.

No Render PATCH, upgrade, deploy, capability/A/B, W2, production action or new
mutation slot is part of this diagnosis. The owner's completed read-only
reconciliation reports that the staging plan is still Free with no new deploy
or plan-change event; this task does not relabel that report as a new provider
read. STOP after local validation and CI.
