import { expect, it } from "vitest";
import { controlUiSessionUrl, installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({ name: "Control UI reasoning stream follow" });

// Live reasoning grows the transcript like streamed text does, so the viewport
// must follow it the same way: pinned to the end after a send, released when
// the reader scrolls up, and pinned again once they return to the end.
suite.define(() => {
  it("follows streamed reasoning until the reader scrolls up, then again at the end", async () => {
    const context = await suite.newBrowserContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { width: 1280, height: 480 },
    });
    try {
      const page = await context.newPage();
      const sessionKey = "agent:main:dashboard:reasoning-follow";
      const sessionRow = {
        key: sessionKey,
        kind: "direct",
        sessionId: "reasoning-follow-session",
        reasoningLevel: "stream",
        thinkingLevel: "low",
        updatedAt: 1_000,
      };
      const gateway = await installMockGateway(page, {
        sessionKey,
        sessionInfo: { reasoningLevel: "stream", thinkingLevel: "low" },
        sessions: [sessionRow],
        historyMessages: [],
      });
      await page.goto(controlUiSessionUrl(suite.server.baseUrl, sessionKey));
      const pane = page.locator('openclaw-chat-pane[aria-hidden="false"]');
      await pane.locator(".agent-chat__composer-combobox textarea").fill("Think it through.");
      await page.getByRole("button", { name: "Send message" }).click();
      const send = await gateway.waitForRequest("chat.send");
      const runId = (send.params as { idempotencyKey?: unknown }).idempotencyKey as string;
      expect(typeof runId).toBe("string");

      const thread = pane.locator(".chat-thread");
      const geometry = () =>
        thread.evaluate((element) => ({
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          distanceFromEnd: element.scrollHeight - element.scrollTop - element.clientHeight,
        }));
      let seq = 0;
      let text = "";
      const streamReasoning = async (lines: number) => {
        for (let index = 0; index < lines; index += 1) {
          seq += 1;
          const delta = `Reasoning line ${seq}: weighing the next step carefully.\n\n`;
          text += delta;
          await gateway.emitGatewayEvent("agent", {
            runId,
            seq,
            stream: "thinking",
            ts: 1_100 + seq,
            sessionKey,
            data: { text, delta },
          });
        }
      };

      seq += 1;
      await gateway.emitGatewayEvent("agent", {
        runId,
        seq,
        stream: "lifecycle",
        ts: 1_100,
        sessionKey,
        data: { phase: "start" },
      });
      await streamReasoning(24);
      await pane.locator(".chat-thinking").first().waitFor({ timeout: 10_000 });
      // The reasoning now overflows the short viewport and the end stays in view.
      await expect.poll(async () => (await geometry()).scrollHeight > 480).toBe(true);
      await expect
        .poll(async () => (await geometry()).distanceFromEnd, { timeout: 5_000 })
        .toBeLessThanOrEqual(8);
      await streamReasoning(12);
      await expect
        .poll(async () => (await geometry()).distanceFromEnd, { timeout: 5_000 })
        .toBeLessThanOrEqual(8);

      // A reader scrolling up releases the pin, and later reasoning leaves them alone.
      const box = await thread.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.wheel(0, -240);
      await expect.poll(async () => (await geometry()).distanceFromEnd).toBeGreaterThan(100);
      const released = await geometry();
      await streamReasoning(12);
      await expect
        .poll(async () => (await geometry()).scrollHeight)
        .toBeGreaterThan(released.scrollHeight);
      await page.waitForTimeout(300);
      const afterRelease = await geometry();
      expect(afterRelease.scrollTop).toBe(released.scrollTop);
      expect(afterRelease.distanceFromEnd).toBeGreaterThan(released.distanceFromEnd);

      // Returning to the end pins the viewport again.
      await page.mouse.wheel(0, 100_000);
      await expect.poll(async () => (await geometry()).distanceFromEnd).toBeLessThanOrEqual(8);
      await streamReasoning(12);
      await expect
        .poll(async () => (await geometry()).distanceFromEnd, { timeout: 5_000 })
        .toBeLessThanOrEqual(8);
    } finally {
      await suite.closeBrowserContext(context);
    }
  });
});
