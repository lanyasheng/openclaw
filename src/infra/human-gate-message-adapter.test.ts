/**
 * Human-gate message adapter tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  HumanGateMessageAdapter,
  getHumanGateMessageAdapter,
  resetHumanGateMessageAdapter,
  messageToDecisionPayload,
} from "./human-gate-message-adapter.js";
import { validateHumanGateDecisionPayload, generateDecisionId } from "./human-gate-types.js";

describe("human-gate-message-adapter", () => {
  beforeEach(() => {
    resetHumanGateMessageAdapter();
  });

  describe("messageToDecisionPayload", () => {
    it("converts message input to decision payload", () => {
      const input = {
        task_id: "tsk_test_001",
        resume_token: "resume_abc123",
        verdict: "approve" as const,
        channel: "1483883339701158102",
        message_id: "1483900000000000000",
        user_id: "user_boss",
        user_name: "老板",
        reason: "批准演示",
      };

      const payload = messageToDecisionPayload(input);

      expect(payload.decision_id).toMatch(/^dec_/);
      expect(payload.task_id).toBe("tsk_test_001");
      expect(payload.resume_token).toBe("resume_abc123");
      expect(payload.verdict).toBe("approve");
      expect(payload.source.transport).toBe("message");
      expect(payload.source.ref).toMatch(/discord:channel:1483883339701158102:message:1483900000000000000/);
      expect(payload.actor.id).toBe("user_boss");
      expect(payload.actor.name).toBe("老板");
      expect(payload.reason).toBe("批准演示");
      expect(payload.decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("validateHumanGateDecisionPayload", () => {
    it("validates correct payload", () => {
      const payload = {
        decision_id: "dec_20260319_0001",
        task_id: "tsk_test_001",
        resume_token: "resume_abc",
        verdict: "approve" as const,
        source: {
          transport: "message" as const,
          ref: "discord:channel:123:message:456",
        },
        actor: {
          id: "user_123",
          name: "Test User",
        },
        decided_at: "2026-03-19T08:31:12Z",
        reason: "Test reason",
      };

      const result = validateHumanGateDecisionPayload(payload);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.task_id).toBe("tsk_test_001");
        expect(result.payload.verdict).toBe("approve");
      }
    });

    it("rejects missing required fields", () => {
      const result = validateHumanGateDecisionPayload({});
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("missing required field");
      }
    });

    it("rejects invalid verdict", () => {
      const payload = {
        decision_id: "dec_001",
        task_id: "tsk_001",
        verdict: "invalid",
        source: { transport: "message", ref: "ref" },
        actor: { id: "user" },
        decided_at: "2026-03-19T08:31:12Z",
      };

      const result = validateHumanGateDecisionPayload(payload);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("invalid verdict");
      }
    });

    it("rejects invalid transport", () => {
      const payload = {
        decision_id: "dec_001",
        task_id: "tsk_001",
        verdict: "approve",
        source: { transport: "invalid", ref: "ref" },
        actor: { id: "user" },
        decided_at: "2026-03-19T08:31:12Z",
      };

      const result = validateHumanGateDecisionPayload(payload);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("invalid source.transport");
      }
    });
  });

  describe("HumanGateMessageAdapter", () => {
    let adapter: HumanGateMessageAdapter;

    beforeEach(() => {
      adapter = new HumanGateMessageAdapter();
    });

    describe("registerRequest", () => {
      it("registers a pending request", () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 180000,
        });

        const state = adapter.getState();
        expect(state.pendingRequests.has("tsk_001")).toBe(true);
        expect(state.pendingRequests.get("tsk_001")?.resume_token).toBe("resume_abc");
      });
    });

    describe("processMessageDecision", () => {
      it("processes approve decision", () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 180000,
        });

        const result = adapter.processMessageDecision({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          verdict: "approve",
          channel: "123",
          message_id: "456",
          user_id: "user_boss",
          user_name: "老板",
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.payload.verdict).toBe("approve");
          expect(result.payload.task_id).toBe("tsk_001");
        }

        // Request should be cleaned up
        expect(adapter.getState().pendingRequests.has("tsk_001")).toBe(false);
      });

      it("rejects unknown task_id", () => {
        const result = adapter.processMessageDecision({
          task_id: "tsk_unknown",
          resume_token: "resume_abc",
          verdict: "approve",
          channel: "123",
          message_id: "456",
          user_id: "user_boss",
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("no pending request");
        }
      });

      it("rejects resume_token mismatch", () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 180000,
        });

        const result = adapter.processMessageDecision({
          task_id: "tsk_001",
          resume_token: "resume_xyz",
          verdict: "approve",
          channel: "123",
          message_id: "456",
          user_id: "user_boss",
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("resume_token mismatch");
        }
      });

      it("processes reject decision", () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 180000,
        });

        const result = adapter.processMessageDecision({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          verdict: "reject",
          channel: "123",
          message_id: "456",
          user_id: "user_boss",
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.payload.verdict).toBe("reject");
        }
      });

      it("processes withdraw decision", () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 180000,
        });

        const result = adapter.processMessageDecision({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          verdict: "withdraw",
          channel: "123",
          message_id: "456",
          user_id: "user_boss",
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.payload.verdict).toBe("withdraw");
        }
      });
    });

    describe("checkTimeouts", () => {
      it("detects timed out requests", async () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 50, // Very short for testing
        });

        // Wait for timeout
        await new Promise((resolve) => setTimeout(resolve, 100));

        const timedOut = adapter.checkTimeouts();
        expect(timedOut).toContain("tsk_001");
      });

      it("does not detect non-timed-out requests", () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 180000,
        });

        const timedOut = adapter.checkTimeouts();
        expect(timedOut).not.toContain("tsk_001");
      });
    });

    describe("generateTimeoutDecision", () => {
      it("generates timeout decision payload", () => {
        adapter.registerRequest({
          task_id: "tsk_001",
          resume_token: "resume_abc",
          timeout_ms: 180000,
        });

        const result = adapter.generateTimeoutDecision("tsk_001");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.payload.verdict).toBe("timeout");
          expect(result.payload.task_id).toBe("tsk_001");
          expect(result.payload.actor.id).toBe("system");
          expect(result.payload.reason).toBe("approval_timeout");
        }
      });

      it("rejects unknown task_id", () => {
        const result = adapter.generateTimeoutDecision("tsk_unknown");
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("no pending request");
        }
      });
    });
  });

  describe("generateDecisionId", () => {
    it("generates unique IDs", () => {
      const id1 = generateDecisionId();
      const id2 = generateDecisionId();
      expect(id1).toMatch(/^dec_/);
      expect(id2).toMatch(/^dec_/);
      expect(id1).not.toBe(id2);
    });
  });
});
