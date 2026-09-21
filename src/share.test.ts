import assert from "node:assert/strict";
import { test } from "node:test";
import { PUBLIC_GAME_URL, shareOrCopy, shareText } from "./share.ts";

test("R4 sharing uses the configured game URL and Japanese result text", () => {
  const text = shareText({ result: { totalTimeMs: 12_340, totalMoves: 27 } });
  assert.match(text, /石板回し/);
  assert.match(text, /00:12\.34/);
  assert.match(text, /27手/);
  assert.match(text, new RegExp(PUBLIC_GAME_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("R4 sharing cancellation does not copy or claim success", async () => {
  let copied = false;
  const result = await shareOrCopy("結果", {
    share: async () => {
      const error = new Error("user cancelled");
      error.name = "AbortError";
      throw error;
    },
    clipboard: { writeText: async () => { copied = true; } },
  });
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(copied, false);
});

test("R4 sharing falls back to clipboard after a non-cancel share error", async () => {
  let copied = "";
  const result = await shareOrCopy("結果", {
    share: async () => { throw new Error("unsupported"); },
    clipboard: { writeText: async (value) => { copied = value; } },
  });
  assert.deepEqual(result, { status: "copied" });
  assert.equal(copied, "結果");
});

test("R4 sharing returns selectable text when clipboard is unavailable", async () => {
  const result = await shareOrCopy("結果", {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  assert.deepEqual(result, { status: "selectable", text: "結果" });
});
