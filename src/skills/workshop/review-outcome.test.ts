import { describe, expect, it } from "vitest";
import { setReplyPayloadMetadata } from "../../auto-reply/reply-payload.js";
import { assertSkillReviewRunSucceeded } from "./review-outcome.js";

describe("Skill Workshop review outcome", () => {
  it("preserves actionable error payloads over the unresolved tool summary", () => {
    expect(() =>
      assertSkillReviewRunSucceeded({
        meta: {
          durationMs: 1,
          toolSummary: {
            calls: 1,
            tools: ["skill_workshop"],
            failures: 1,
            unresolvedError: { toolName: "skill_workshop" },
          },
        },
        payloads: [{ isError: true, text: "Proposal rejected: read the current skill and retry." }],
      }),
    ).toThrow("Proposal rejected: read the current skill and retry.");
  });

  it("does not fail a review whose last tool call errored", () => {
    // A trailing refused path, non-zero exec exit or mismatched edit is the model's to handle;
    // the run itself completed and any direct edits already landed.
    const warning = setReplyPayloadMetadata(
      { isError: true, text: "⚠️ exec failed: command exited with code 1" },
      { toolErrorWarning: { toolName: "exec" } },
    );
    expect(() =>
      assertSkillReviewRunSucceeded({
        meta: {
          durationMs: 1,
          toolSummary: {
            calls: 7,
            tools: ["read", "edit", "exec"],
            failures: 2,
            unresolvedError: { toolName: "exec" },
          },
        },
        payloads: [warning],
      }),
    ).not.toThrow();
    expect(() =>
      assertSkillReviewRunSucceeded({
        meta: {
          durationMs: 1,
          toolSummary: {
            calls: 3,
            tools: ["read", "edit"],
            failures: 1,
            unresolvedError: { toolName: "edit" },
          },
        },
        payloads: [{ text: "NO_REPLY" }],
      }),
    ).not.toThrow();
  });

  it("treats run-level terminal metadata as a review failure", () => {
    expect(() =>
      assertSkillReviewRunSucceeded({
        meta: {
          durationMs: 1,
          error: { kind: "retry_limit", message: "model retries exhausted" },
        },
      }),
    ).toThrow("model retries exhausted");
    expect(() => assertSkillReviewRunSucceeded({ meta: { durationMs: 1, aborted: true } })).toThrow(
      "aborted",
    );
    expect(() =>
      assertSkillReviewRunSucceeded({ meta: { durationMs: 1 }, payloads: [{ text: "done" }] }),
    ).not.toThrow();
  });
});
