import test from "node:test";
import assert from "node:assert/strict";
import {
  GLOBAL,
  chooseFocus,
  resolveTarget,
  redact,
  requiresVisual,
} from "../src/policy";
test("ambiguous names return candidates instead of guessing", () => {
  assert.equal(
    resolveTarget("release", GLOBAL, [
      { id: "1", title: "Release API" },
      { id: "2", title: "Release web" },
    ]).length,
    2,
  );
});
test("explicit active delegation focus survives navigation", () => {
  const focus = {
    kind: "thread" as const,
    id: "1",
    label: "Release",
    explicit: true,
  };
  assert.deepEqual(chooseFocus(focus, { ...GLOBAL }, true), focus);
  assert.equal(chooseFocus(focus, { ...GLOBAL }, false).kind, "global");
});
test("redacts exact secrets, bearer credentials, and common key syntax", () => {
  const text = redact(
    "sk-proj-abcdef Bearer abc123 api_key=abc secret: yep custom-value",
    ["custom-value"],
  );
  assert.ok(!text.includes("abcdef"));
  assert.ok(!text.includes("abc123"));
  assert.ok(!text.includes("custom-value"));
  assert.ok(!text.includes("yep"));
});
test("consequential instructions cannot become direct follow-ups", () => {
  for (const text of [
    "deploy it",
    "merge PR 20",
    "read credentials",
    "delete the checkout",
    "approve that interaction",
  ])
    assert.ok(requiresVisual(text));
  assert.ok(!requiresVisual("run integration tests"));
});
