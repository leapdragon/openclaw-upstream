import { describe, expect, it } from "vitest";
import { resolveSkillWorkshopConfig } from "./config.js";

describe("resolveSkillWorkshopConfig", () => {
  it("defaults autonomous learning to auto with channel notices off", () => {
    expect(resolveSkillWorkshopConfig().autonomous).toEqual({
      mode: "auto",
      channelNotices: false,
    });
  });

  it.each([false, true])("reads channel notices %s", (channelNotices) => {
    expect(
      resolveSkillWorkshopConfig({ skills: { workshop: { autonomous: { channelNotices } } } })
        .autonomous.channelNotices,
    ).toBe(channelNotices);
  });

  it.each(["off", "auto"] as const)("reads autonomous mode %s", (mode) => {
    expect(
      resolveSkillWorkshopConfig({ skills: { workshop: { autonomous: { mode } } } }).autonomous
        .mode,
    ).toBe(mode);
  });

  it("reads a trimmed review model ref and leaves it unset otherwise", () => {
    expect(resolveSkillWorkshopConfig().model).toBeUndefined();
    expect(
      resolveSkillWorkshopConfig({ skills: { workshop: { model: "  " } } }).model,
    ).toBeUndefined();
    expect(
      resolveSkillWorkshopConfig({ skills: { workshop: { model: " litellm/aux " } } }).model,
    ).toBe("litellm/aux");
  });

  it("reads a context token budget of at least 4096 and leaves it unset otherwise", () => {
    expect(resolveSkillWorkshopConfig().contextTokenBudget).toBeUndefined();
    expect(
      resolveSkillWorkshopConfig({ skills: { workshop: { contextTokenBudget: 1024 } } })
        .contextTokenBudget,
    ).toBeUndefined();
    expect(
      resolveSkillWorkshopConfig({ skills: { workshop: { contextTokenBudget: 65_536 } } })
        .contextTokenBudget,
    ).toBe(65_536);
  });

  it("does not read the retired boolean key at runtime", () => {
    expect(
      resolveSkillWorkshopConfig({
        skills: { workshop: { autonomous: { enabled: false } } },
      } as never).autonomous.mode,
    ).toBe("auto");
  });
});
