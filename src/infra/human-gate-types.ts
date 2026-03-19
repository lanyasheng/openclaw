/**
 * Human-gate decision payload types.
 * 
 * This defines the unified decision payload contract for human approval flows.
 * Both `message` and `browser` paths should normalize to this payload structure.
 * 
 * @see docs/p0-5-human-gate-contract.md
 */

/** Human gate verdict options */
export type HumanGateVerdict = "approve" | "reject" | "timeout" | "withdraw";

/** Transport channel for the decision */
export type HumanGateTransport = "message" | "browser" | "file";

/** Source reference for the decision (message ID, page URL, file path, etc.) */
export type HumanGateSourceRef = {
  transport: HumanGateTransport;
  ref: string;
};

/** Actor who made the decision */
export type HumanGateActor = {
  id: string;
  name?: string;
};

/** Human gate decision payload structure */
export interface HumanGateDecisionPayload {
  /** Decision event ID for idempotency deduplication */
  decision_id: string;
  /** Must align with minimal task registry primary key */
  task_id: string;
  /** Only effective for approve path; used to resume Lobster/runtime */
  resume_token?: string;
  /** Decision verdict */
  verdict: HumanGateVerdict;
  /** Source of the decision */
  source: HumanGateSourceRef;
  /** Who made the decision */
  actor: HumanGateActor;
  /** Decision timestamp (ISO 8601) */
  decided_at: string;
  /** Optional reason for the decision */
  reason?: string;
}

/** Human gate request structure (stored in evidence.human_gate.request) */
export interface HumanGateRequest {
  transport: HumanGateTransport;
  resume_token: string;
  timeout_ms: number;
  prompt: string;
  source_ref?: string;
}

/** Human gate evidence structure (stored in evidence.human_gate) */
export interface HumanGateEvidence {
  request?: HumanGateRequest;
  decision?: HumanGateDecisionPayload;
}

/** Exec approval decision (for reference - existing OpenClaw type) */
export type ExecApprovalDecision = "allow-once" | "allow-always" | "deny";

/**
 * Map human gate verdict to exec approval decision for backward compatibility.
 */
export function mapVerdictToExecApproval(verdict: HumanGateVerdict): ExecApprovalDecision {
  switch (verdict) {
    case "approve":
      return "allow-once";
    case "reject":
      return "deny";
    case "timeout":
      return "deny";
    case "withdraw":
      return "deny";
    default:
      return "deny";
  }
}

/**
 * Generate a unique decision ID.
 */
export function generateDecisionId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `dec_${timestamp}_${random}`;
}

/**
 * Validate a human gate decision payload.
 */
export function validateHumanGateDecisionPayload(
  payload: unknown,
): { valid: true; payload: HumanGateDecisionPayload } | { valid: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "payload must be an object" };
  }

  const p = payload as Record<string, unknown>;

  // Required fields
  const requiredFields = ["decision_id", "task_id", "verdict", "source", "actor", "decided_at"];
  for (const field of requiredFields) {
    if (!(field in p)) {
      return { valid: false, error: `missing required field: ${field}` };
    }
  }

  // Validate verdict
  const verdict = p.verdict as string;
  if (!["approve", "reject", "timeout", "withdraw"].includes(verdict)) {
    return { valid: false, error: `invalid verdict: ${verdict}` };
  }

  // Validate source
  const source = p.source as Record<string, unknown>;
  if (!source || typeof source !== "object") {
    return { valid: false, error: "source must be an object" };
  }
  if (!["message", "browser", "file"].includes(source.transport as string)) {
    return { valid: false, error: `invalid source.transport: ${source.transport}` };
  }
  if (typeof source.ref !== "string") {
    return { valid: false, error: "source.ref must be a string" };
  }

  // Validate actor
  const actor = p.actor as Record<string, unknown>;
  if (!actor || typeof actor !== "object") {
    return { valid: false, error: "actor must be an object" };
  }
  if (typeof actor.id !== "string") {
    return { valid: false, error: "actor.id must be a string" };
  }

  // Validate decided_at
  if (typeof p.decided_at !== "string") {
    return { valid: false, error: "decided_at must be a string" };
  }

  // Validate task_id
  if (typeof p.task_id !== "string") {
    return { valid: false, error: "task_id must be a string" };
  }

  // Validate decision_id
  if (typeof p.decision_id !== "string") {
    return { valid: false, error: "decision_id must be a string" };
  }

  return {
    valid: true,
    payload: {
      decision_id: p.decision_id as string,
      task_id: p.task_id as string,
      resume_token: p.resume_token as string | undefined,
      verdict: verdict as HumanGateVerdict,
      source: source as HumanGateSourceRef,
      actor: actor as HumanGateActor,
      decided_at: p.decided_at as string,
      reason: typeof p.reason === "string" ? p.reason : undefined,
    },
  };
}
