import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  preferencesSchema,
  preferencesPatchSchema,
  reasoningSchema,
} from "./preferences";
import { focusSchema } from "./policy";
export const authSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(32).max(128),
});
const eventSchema = z.object({
  sequence: z.number(),
  at: z.number(),
  kind: z.string(),
  text: z.string(),
  threadId: z.string().nullable(),
});
export type LiveEvent = z.infer<typeof eventSchema>;
const threadSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string(),
  status: z.string(),
  queued: z.number(),
});
export const rpcContract = defineRpcContract({
  preferences: { input: z.null(), output: preferencesSchema },
  savePreferences: { input: preferencesPatchSchema, output: preferencesSchema },
  operatorDefaults: {
    input: z.null(),
    output: z.object({
      providerId: z.string(),
      model: z.string(),
      reasoningLevel: reasoningSchema.exclude(["default"]),
    }),
  },
  config: {
    input: z.null(),
    output: z.object({ configured: z.boolean(), busy: z.boolean() }),
  },
  workspace: {
    input: z.null(),
    output: z.object({
      threads: z.array(threadSchema),
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
      truncated: z.boolean(),
    }),
  },
  start: {
    input: z.object({
      sdp: z.string().min(10).max(128000),
      threadId: z.string().nullable(),
      projectId: z.string().nullable(),
    }),
    output: authSchema.extend({
      sdp: z.string(),
      operatorId: z.string(),
      focus: focusSchema,
    }),
  },
  snapshot: {
    input: authSchema,
    output: z.object({
      status: z.string(),
      focus: focusSchema,
      events: z.array(eventSchema),
      pending: z.array(
        z.object({ id: z.string(), threadId: z.string(), title: z.string() }),
      ),
      openThreadId: z.string().nullable(),
    }),
  },
  focus: {
    input: authSchema.extend({
      kind: z.enum(["global", "project", "thread"]),
      target: z.string().nullable(),
      explicit: z.boolean(),
    }),
    output: focusSchema,
  },
  control: {
    input: authSchema.extend({
      command: z.enum(["interrupt", "end", "heartbeat"]),
    }),
    output: z.object({ ok: z.boolean() }),
  },
});
export type SessionAuth = z.infer<typeof authSchema>;
