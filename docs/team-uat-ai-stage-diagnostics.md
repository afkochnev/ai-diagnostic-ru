# Ordinary Team AI stage diagnostics

The staging UAT report `ef900153-918e-47b1-a47d-0bb177e0d699` failed with
`team_processing_failed`. Its legacy counters were synthesis=1, report=0,
repair=0. Those counters increment before request construction and do not prove
an HTTP request or paid generation. No exact HTTP cause was retained.

This change adds an ordinary-flow `team_ai_stage_failure` event containing only:

- fixed pipeline `TEAM-RU-3`;
- phase `synthesis`, `report`, `repair`, or `report_repair`;
- stage `prompt_read`, `serialization`, `schema_conversion`, `client_setup`,
  `dispatch`, `response_parse`, or `local_validation`;
- class `local_preparation`, `http_error`, `connection_timeout`,
  `connection_error`, `invalid_output`, or `unknown`;
- optional integer `http_status` from 400 to 599, only for an actual SDK
  `APIError` during dispatch. A status-like property on another object is ignored.

No message, stack, path, headers, response body, request ID, credential, model
output, or participant evidence is logged. A log-sink failure does not replace
the processing error. Controlled transport does not emit this ordinary event.

The exception is rethrown unchanged. Persisted failure codes, helper-entry
counters, SDK `maxRetries: 0`, timeouts, model, prompts, request bodies, token
bounds, privacy validators and queue retry decisions remain unchanged.
`dispatch` alone is not proof that the provider received a request; an SDK HTTP
status provides narrower evidence without guessing its underlying cause.

The existing `fail_team_job` SQL uses attempts=3 to make a nonretryable failure
ineligible. That value is not an execution count. Do not reset it or use the UI
retry button for the spent UAT request.

Local checks use synthetic credentials, mocked SDK/RPC ports and fake errors.
No migration, environment change, hosted request, W2 window, report retry or
production action is part of this change. The old failure and budgets remain
spent and the UAT remains on HOLD. A later staging deployment and any bounded
report continuation need separate owner authorization.

SDK exception classification was checked against the installed pinned SDK and
[official OpenAI error documentation](https://developers.openai.com/api/docs/guides/error-codes).
Provider retry recommendations do not override this UAT's no-retry restriction.
