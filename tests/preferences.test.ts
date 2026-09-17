import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  createPreferences,
  preferencesPatchSchema,
  preferencesSchema,
} from "../src/preferences";

test("legacy preferences migrate once, exclude secrets, and survive reload", async () => {
  let reads = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb-live",
    sdk: {
      plugins: {
        getSettings: async () => {
          reads++;
          return {
            ok: true,
            schema: {},
            values: {
              openaiApiKey: "sk-secret",
              voice: "cedar",
              routerModel: "custom-model",
              operatorProvider: "codex",
              operatorModel: "custom-operator",
              operatorReasoningLevel: "xhigh",
              spokenProgress: "quiet",
              transcriptRetentionDays: 14,
            },
          };
        },
      },
    },
  });
  try {
    const prefs = await createPreferences(bb);
    assert.equal(prefs.get().voice, "cedar");
    assert.equal(prefs.get().routerModel, "custom-model");
    assert.equal(prefs.get().operatorModel, "custom-operator");
    assert.equal(prefs.get().transcriptRetentionDays, 14);
    assert.equal(prefs.get().jevEnabled, false);
    assert.equal(prefs.get().jevModel, "jev-latest");
    assert.ok(
      !JSON.stringify(await bb.storage.kv.get("preferences.v1")).includes(
        "sk-secret",
      ),
    );
    await Promise.all([
      prefs.update({
        voice: "ash",
        voicePrompt: "Keep it brief.",
        opening: "",
      }),
      prefs.update({ spokenProgress: "verbose" }),
    ]);
    const reloaded = await createPreferences(bb);
    assert.equal(reloaded.get().voice, "ash");
    assert.equal(reloaded.get().voicePrompt, "Keep it brief.");
    assert.equal(reloaded.get().opening, "");
    assert.equal(reloaded.get().spokenProgress, "verbose");
    assert.equal(reloaded.get().transcriptRetentionDays, 14);
    assert.equal(reads, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("fresh-install settings lookup failure falls back to persisted defaults", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb-live",
    sdk: {
      plugins: {
        getSettings: async () => {
          throw new Error("unavailable");
        },
      },
    },
  });
  try {
    const prefs = await createPreferences(bb);
    assert.deepEqual(prefs.get(), preferencesSchema.parse({}));
    assert.deepEqual(await bb.storage.kv.get("preferences.v1"), prefs.get());
    await prefs.update({ voice: "cedar", transcriptRetentionDays: 14 });
    const reloaded = await createPreferences(bb);
    assert.equal(reloaded.get().voice, "cedar");
    assert.equal(reloaded.get().transcriptRetentionDays, 14);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("preference writes reject secrets and invalid retention", () => {
  for (const patch of [
    { openaiApiKey: "secret" },
    { transcriptRetentionDays: -1 },
    { transcriptRetentionDays: 400 },
    { transcriptRetentionDays: 1.5 },
    { spokenProgress: "sometimes" },
    { voice: "" },
    { voicePrompt: "   " },
    { voicePrompt: "x".repeat(8001) },
    { opening: "x".repeat(1001) },
    { typesafeApiKey: "secret" },
    { jevEnabled: "yes" },
    { jevModel: "" },
    { jevBaseUrl: "not a url" },
  ])
    assert.equal(preferencesPatchSchema.safeParse(patch).success, false);
});

test("jev preferences default off and accept a gateway base URL", () => {
  assert.deepEqual(
    preferencesPatchSchema.parse({
      jevEnabled: true,
      jevModel: "jev-1.13.0",
      jevBaseUrl: "https://gateway.example.com/typesafe/",
    }),
    {
      jevEnabled: true,
      jevModel: "jev-1.13.0",
      jevBaseUrl: "https://gateway.example.com/typesafe/",
    },
  );
});
