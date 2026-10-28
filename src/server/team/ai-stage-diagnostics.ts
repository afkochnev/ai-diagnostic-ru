import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai/core/error";

export type TeamAIPhase = "synthesis" | "report" | "repair" | "report_repair";
export type TeamAIStage = "prompt_read" | "serialization" | "schema_conversion" | "client_setup" | "dispatch" | "response_parse" | "local_validation";
type FailureClass = "local_preparation" | "http_error" | "connection_timeout" | "connection_error" | "invalid_output" | "unknown";

/** Only fixed codes and an SDK-owned numeric status cross the log boundary. */
export function logTeamAIStageFailure(phase: TeamAIPhase, stage: TeamAIStage, error: unknown) {
  let failure_class: FailureClass = stage === "dispatch" ? "unknown"
    : stage === "response_parse" || stage === "local_validation" ? "invalid_output" : "local_preparation";
  let http_status: number | undefined;
  try {
    if (stage === "dispatch") {
      if (error instanceof APIConnectionTimeoutError) failure_class = "connection_timeout";
      else if (error instanceof APIConnectionError) failure_class = "connection_error";
      else if (error instanceof APIError) {
        // Do not evaluate an arbitrary status getter or inspect headers/body/message.
        const status = Object.getOwnPropertyDescriptor(error, "status")?.value;
        if (Number.isInteger(status) && status >= 400 && status <= 599) {
          failure_class = "http_error";
          http_status = status;
        }
      }
    }
  } catch {
    // Unknown exception objects, including hostile prototype traps, stay unknown.
  }
  try {
    console.info("[team-ai]", { event: "team_ai_stage_failure", pipeline: "TEAM-RU-3", phase, stage,
      failure_class, ...(http_status === undefined ? {} : { http_status }) });
  } catch {
    // Diagnostics must never replace the original processing failure.
  }
}
