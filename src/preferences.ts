import { z } from "zod";
import { DEFAULT_VOICE_PROMPT, DEFAULT_OPENING } from "./policy";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const voices = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "beacon",
  "bossa",
  "cinder",
  "coral",
  "delta",
  "echo",
  "gleam",
  "meridian",
  "quartz",
  "ripple",
  "sage",
  "shimmer",
  "stone",
  "tempo",
  "verse",
  "vesper",
  "willow",
] as const;
// Public OpenAI speech samples; Live delivery can differ from these recordings.
export const sampledVoices = new Set([
  "alloy",
  "ash",
  "coral",
  "echo",
  "sage",
  "shimmer",
]);
export const voiceNotes: Record<string, string> = {
  marin: "Recommended",
  cedar: "Recommended",
  quartz: "English · Australian",
  ripple: "English · Australian",
  vesper: "English · British",
  willow: "English · Irish",
  stone: "English · Irish",
  gleam: "English · North American",
  meridian: "English · North American",
  bossa: "Portuguese · Brazilian",
  tempo: "Portuguese · Brazilian",
  beacon: "English · Filipino",
  delta: "English · Southern U.S.",
  cinder: "English · Southern U.S.",
};
const identifier = z.string().trim().min(1).max(200);
export const reasoningSchema = z.enum([
  "default",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
]);
export const preferencesSchema = z.object({
  voice: identifier.default("marin"),
  voicePrompt: z.string().trim().min(1).max(8000).default(DEFAULT_VOICE_PROMPT),
  opening: z.string().trim().max(1000).default(DEFAULT_OPENING),
  routerModel: identifier.default("gpt-5.6-terra"),
  operatorProvider: z.string().max(200).default(""),
  operatorModel: z.string().max(200).default(""),
  operatorReasoningLevel: reasoningSchema.default("default"),
  operatorServiceTier: z.enum(["default", "fast"]).default("default"),
  spokenProgress: z
    .enum(["quiet", "important", "verbose"])
    .default("important"),
  transcriptRetentionDays: z.number().int().min(0).max(365).default(30),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const preferencesPatchSchema = z
  .object({
    voice: preferencesSchema.shape.voice.removeDefault().optional(),
    voicePrompt: preferencesSchema.shape.voicePrompt.removeDefault().optional(),
    opening: preferencesSchema.shape.opening.removeDefault().optional(),
    routerModel: preferencesSchema.shape.routerModel.removeDefault().optional(),
    operatorProvider: preferencesSchema.shape.operatorProvider
      .removeDefault()
      .optional(),
    operatorModel: preferencesSchema.shape.operatorModel
      .removeDefault()
      .optional(),
    operatorReasoningLevel: preferencesSchema.shape.operatorReasoningLevel
      .removeDefault()
      .optional(),
    operatorServiceTier: preferencesSchema.shape.operatorServiceTier
      .removeDefault()
      .optional(),
    spokenProgress: preferencesSchema.shape.spokenProgress
      .removeDefault()
      .optional(),
    transcriptRetentionDays: preferencesSchema.shape.transcriptRetentionDays
      .removeDefault()
      .optional(),
  })
  .strict();

export async function createPreferences(bb: BbPluginApi) {
  const key = "preferences.v1";
  let current: Preferences;
  const stored = await bb.storage.kv.get(key);
  if (stored !== undefined) current = preferencesSchema.parse(stored);
  else {
    // Migrate only declared non-secret fields from the old generic settings.
    // A failed read must not silently overwrite an existing user's choices.
    const legacy = await bb.sdk.plugins.getSettings({ pluginId: bb.pluginId });
    current = preferencesSchema.parse(legacy.values);
    await bb.storage.kv.set(key, current);
  }
  let tail: Promise<unknown> = Promise.resolve();
  return {
    get: () => ({ ...current }),
    update(patch: z.infer<typeof preferencesPatchSchema>) {
      const write = tail.then(async () => {
        const next = preferencesSchema.parse({
          ...current,
          ...preferencesPatchSchema.parse(patch),
        });
        await bb.storage.kv.set(key, next);
        current = next;
        return { ...current };
      });
      tail = write.catch(() => {});
      return write;
    },
  };
}
