import { asNullableRecord } from "@openclaw/normalization-core/record-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { SkillsWorkshopAutonomousMode } from "../../config/types.skills.js";

/** Runtime configuration for Skill Workshop. */
type SkillWorkshopConfig = {
  autonomous: {
    mode: SkillsWorkshopAutonomousMode;
    channelNotices: boolean;
  };
  maxSkillBytes: number;
  /** Configured review model ref; undefined keeps the reviewed run's model. */
  model?: string;
  /** Context token budget for background reviews; undefined keeps the built-in 16,384. */
  contextTokenBudget?: number;
};

function readContextTokenBudget(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 4096
    ? Math.trunc(value)
    : undefined;
}

function readModelRef(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

export function resolveSkillWorkshopConfig(config?: OpenClawConfig): SkillWorkshopConfig {
  const raw = asNullableRecord(config?.skills?.workshop) ?? {};
  const autonomous = asNullableRecord(raw.autonomous);
  const mode = autonomous?.mode;
  const maxSkillBytes = raw.maxSkillBytes;
  return {
    autonomous: {
      mode: mode === "off" || mode === "auto" ? mode : "auto",
      channelNotices: autonomous?.channelNotices === true,
    },
    maxSkillBytes:
      typeof maxSkillBytes === "number" && Number.isFinite(maxSkillBytes)
        ? Math.min(Math.max(Math.trunc(maxSkillBytes), 1024), 200_000)
        : 40_000,
    model: readModelRef(raw.model),
    contextTokenBudget: readContextTokenBudget(raw.contextTokenBudget),
  };
}
