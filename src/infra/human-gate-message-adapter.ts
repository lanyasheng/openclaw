/**
 * Human-gate message adapter.
 * 
 * Receives approval decisions from message channel (Discord/Slack/etc.)
 * and normalizes them to unified HumanGateDecisionPayload.
 * 
 * This is the minimal thin wiring for message path:
 * - Accepts message events with approve/reject/timeout/withdraw actions
 * - Validates task_id + resume_token matching
 * - Produces unified decision payload
 * - Does NOT create a second approval registry
 */

import type { HumanGateDecisionPayload, HumanGateEvidence } from "./human-gate-types.js";
import { generateDecisionId, validateHumanGateDecisionPayload } from "./human-gate-types.js";

/** Message transport decision input */
export interface MessageDecisionInput {
  /** Task ID from the approval request */
  task_id: string;
  /** Resume token from the approval request */
  resume_token: string;
  /** Verdict from user action */
  verdict: "approve" | "reject" | "timeout" | "withdraw";
  /** Message channel reference */
  channel: string;
  /** Message ID */
  message_id: string;
  /** User who made the decision */
  user_id: string;
  /** User display name (optional) */
  user_name?: string;
  /** Optional reason */
  reason?: string;
}

/**
 * Convert message decision input to unified decision payload.
 */
export function messageToDecisionPayload(input: MessageDecisionInput): HumanGateDecisionPayload {
  const now = new Date();
  return {
    decision_id: generateDecisionId(),
    task_id: input.task_id,
    resume_token: input.resume_token,
    verdict: input.verdict,
    source: {
      transport: "message",
      ref: `discord:channel:${input.channel}:message:${input.message_id}`,
    },
    actor: {
      id: input.user_id,
      name: input.user_name,
    },
    decided_at: now.toISOString(),
    reason: input.reason,
  };
}

/**
 * Human-gate message adapter state.
 * Tracks pending approval requests by task_id + resume_token.
 */
export interface HumanGateMessageAdapterState {
  /** Pending requests: task_id -> { resume_token, expires_at_ms } */
  pendingRequests: Map<string, { resume_token: string; expires_at_ms: number }>;
}

/**
 * Human-gate message adapter.
 */
export class HumanGateMessageAdapter {
  private state: HumanGateMessageAdapterState;

  constructor() {
    this.state = {
      pendingRequests: new Map(),
    };
  }

  /**
   * Register a pending approval request.
   * Called when human-gate initiates an approval request via message.
   */
  registerRequest(params: {
    task_id: string;
    resume_token: string;
    timeout_ms: number;
  }): void {
    const now = Date.now();
    this.state.pendingRequests.set(params.task_id, {
      resume_token: params.resume_token,
      expires_at_ms: now + params.timeout_ms,
    });
  }

  /**
   * Process a message decision (from button click or reply).
   * Returns validated decision payload or error.
   */
  processMessageDecision(input: MessageDecisionInput): {
    success: true;
    payload: HumanGateDecisionPayload;
  } | {
    success: false;
    error: string;
  } {
    // Check if request exists
    const pending = this.state.pendingRequests.get(input.task_id);
    if (!pending) {
      return {
        success: false,
        error: `no pending request for task_id: ${input.task_id}`,
      };
    }

    // Check resume_token match
    if (pending.resume_token !== input.resume_token) {
      return {
        success: false,
        error: `resume_token mismatch for task_id: ${input.task_id}`,
      };
    }

    // Check if expired
    const now = Date.now();
    if (now > pending.expires_at_ms) {
      // This is a timeout case - still produce a payload but mark as timeout
      if (input.verdict !== "timeout") {
        return {
          success: false,
          error: `request expired for task_id: ${input.task_id}`,
        };
      }
    }

    // Convert to unified payload
    const payload = messageToDecisionPayload(input);

    // Validate
    const validation = validateHumanGateDecisionPayload(payload);
    if (!validation.valid) {
      return {
        success: false,
        error: (validation as { valid: false; error: string }).error,
      };
    }

    // Clean up pending request
    this.state.pendingRequests.delete(input.task_id);

    return {
      success: true,
      payload: validation.payload,
    };
  }

  /**
   * Check for timed-out requests.
   * Returns list of task_ids that have timed out.
   */
  checkTimeouts(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];
    this.state.pendingRequests.forEach((req, task_id) => {
      if (now > req.expires_at_ms) {
        timedOut.push(task_id);
      }
    });
    return timedOut;
  }

  /**
   * Generate timeout decision payload for a timed-out request.
   */
  generateTimeoutDecision(task_id: string): {
    success: true;
    payload: HumanGateDecisionPayload;
  } | {
    success: false;
    error: string;
  } {
    const pending = this.state.pendingRequests.get(task_id);
    if (!pending) {
      return {
        success: false,
        error: `no pending request for task_id: ${task_id}`,
      };
    }

    const now = new Date();
    const payload: HumanGateDecisionPayload = {
      decision_id: generateDecisionId(),
      task_id,
      resume_token: pending.resume_token,
      verdict: "timeout",
      source: {
        transport: "message",
        ref: "system:timeout",
      },
      actor: {
        id: "system",
        name: "System",
      },
      decided_at: now.toISOString(),
      reason: "approval_timeout",
    };

    // Clean up
    this.state.pendingRequests.delete(task_id);

    return {
      success: true,
      payload,
    };
  }

  /**
   * Get current state (for testing/debugging).
   */
  getState(): HumanGateMessageAdapterState {
    return { ...this.state };
  }

  /**
   * Clear all pending requests (for testing).
   */
  clear(): void {
    this.state.pendingRequests.clear();
  }
}

/**
 * Singleton instance for global use.
 */
let globalAdapter: HumanGateMessageAdapter | null = null;

export function getHumanGateMessageAdapter(): HumanGateMessageAdapter {
  if (!globalAdapter) {
    globalAdapter = new HumanGateMessageAdapter();
  }
  return globalAdapter;
}

export function resetHumanGateMessageAdapter(): void {
  globalAdapter = null;
}
