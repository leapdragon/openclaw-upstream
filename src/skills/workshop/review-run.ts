import {
  getActiveEmbeddedRunCount,
  isEmbeddedAgentRunActive,
} from "../../agents/embedded-agent-runner/active-run-projections.js";
import type { RunEmbeddedAgentParams } from "../../agents/embedded-agent-runner/run/params.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { clearAgentRunContext, registerAgentRunContext } from "../../infra/agent-run-registry.js";
import { onGatewayWorkMetricsChanged } from "../../infra/gateway-work-metrics-events.js";
import { createBackgroundWorkOwner } from "../../process/background-work.js";
import { getGatewayRestartDrainSignal } from "../../process/gateway-work-admission.js";
import { resolveSkillWorkshopConfig } from "./config.js";

/** Upstream's review cost cap; `skills.workshop.contextTokenBudget` overrides it. */
const DEFAULT_REVIEW_CONTEXT_TOKEN_BUDGET = 16_384;

const reviews = createBackgroundWorkOwner({ owner: "core:skill-workshop", maxConcurrent: 1 });

/**
 * The background Workshop review run: the openclaw harness on a locked model, crediting
 * changes to the reviewed session.
 */
export async function runSkillWorkshopReview(
  params: RunEmbeddedAgentParams & {
    agentId: string;
    config: OpenClawConfig;
    preparedRunAdmission: NonNullable<RunEmbeddedAgentParams["preparedRunAdmission"]>;
    skillWorkshopReviewOf: string;
    /**
     * Abort the review when interactive work starts. True when the review shares the
     * foreground provider; a review routed to a separate provider does not compete for
     * that capacity, and cancelling it would only waste the prompt it already sent.
     */
    yieldToForegroundWork?: boolean;
  },
) {
  const foreground = new AbortController();
  const yieldsToForeground = params.yieldToForegroundWork !== false;
  const yieldToForeground = () => {
    if (!yieldsToForeground) {
      return;
    }
    const ownRun = isEmbeddedAgentRunActive(params.sessionId) ? 1 : 0;
    if (getActiveEmbeddedRunCount() > ownRun) {
      foreground.abort(new DOMException("Skill review yielded to foreground work", "AbortError"));
    }
  };
  const unsubscribe = yieldsToForeground
    ? onGatewayWorkMetricsChanged(yieldToForeground)
    : () => {};
  const abortSignal = AbortSignal.any([
    getGatewayRestartDrainSignal(),
    foreground.signal,
    ...(params.abortSignal ? [params.abortSignal] : []),
  ]);
  // Background runs stay out of the Control UI and never project into a user session.
  registerAgentRunContext(params.runId, {
    agentId: params.agentId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    isControlUiVisible: false,
    projectSessionActive: false,
    projectSessionLifecycle: false,
    projectSessionMessages: false,
  });
  try {
    yieldToForeground();
    abortSignal.throwIfAborted();
    const { runEmbeddedAgent } = await import("../../agents/embedded-agent.js");
    const result = await runEmbeddedAgent({
      ...params,
      abortSignal,
      lane: reviews.lane,
      agentHarnessId: "openclaw",
      agentHarnessRuntimeOverride: "openclaw",
      // Review is best-effort work: never spend interactive capacity on retries.
      modelSelectionLocked: true,
      modelFallbacksOverride: [],
      retryTransientErrors: false,
      allowAuthProfileFallback: false,
      authProfileFailurePolicy: "local_transient",
      requestedRouteResolution: "resolved",
      sessionPersistence: "detached",
      promptCacheKey: undefined,
      sourceReplyDeliveryMode: undefined,
      toolsAllow: ["skill_workshop"],
      toolExecutionAllow: ["skill_workshop"],
      codeModeOverride: false,
      disableToolSearch: true,
      promptMode: "minimal",
      bootstrapContextMode: "lightweight",
      skillsSnapshot: undefined,
      extraSystemPrompt: undefined,
      clientTools: undefined,
      conversationRecall: undefined,
      gitCoauthorPrompt: undefined,
      forceMessageTool: false,
      forceHeartbeatTool: false,
      contextTokenBudget:
        resolveSkillWorkshopConfig(params.config).contextTokenBudget ??
        DEFAULT_REVIEW_CONTEXT_TOKEN_BUDGET,
      streamParams: { maxTokens: 2_048 },
      thinkLevel: "low",
      timeoutMs: Math.min(params.timeoutMs, 120_000),
      disableTrajectory: true,
      silentExpected: true,
      allowEmptyAssistantReplyAsSilent: true,
      terminalReplyExpectation: "optional",
      cleanupBundleMcpOnRunEnd: true,
      verboseLevel: "off",
    });
    foreground.signal.throwIfAborted();
    return result;
  } finally {
    unsubscribe();
    params.preparedRunAdmission.close();
    clearAgentRunContext(params.runId);
  }
}
