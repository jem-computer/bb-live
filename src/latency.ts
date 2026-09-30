import { z } from "zod";

// Operational telemetry is an allowlist: never persist provider payloads or text.
const number = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stamp = number.nullable().default(null);
const model = z
  .string()
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export function safeModel(value: unknown): string | null {
  const parsed = model.safeParse(value);
  return parsed.success && !/sk-|bearer|token|secret/i.test(parsed.data)
    ? parsed.data
    : null;
}
export const classifyUsageSchema = z.object({
  model: model.nullable(),
  inputTokens: stamp,
  outputTokens: stamp,
  totalTokens: stamp,
  cachedInputTokens: stamp,
  reasoningTokens: stamp,
  reportedCostUsd: stamp,
});
export type ClassifyUsage = z.infer<typeof classifyUsageSchema>;
export function classifyUsage(
  raw: unknown,
  requestedModel: string,
): ClassifyUsage {
  const response = z
    .object({
      model: z.unknown().optional(),
      usage: z.unknown().optional(),
      cost_usd: z.unknown().optional(),
    })
    .safeParse(raw);
  const data = response.success ? response.data : {};
  const usage = z
    .object({
      input_tokens: z.unknown().optional(),
      output_tokens: z.unknown().optional(),
      total_tokens: z.unknown().optional(),
      input_tokens_details: z
        .object({ cached_tokens: z.unknown().optional() })
        .nullish(),
      output_tokens_details: z
        .object({ reasoning_tokens: z.unknown().optional() })
        .nullish(),
      cost_usd: z.unknown().optional(),
    })
    .safeParse(data.usage);
  const u = usage.success ? usage.data : {};
  const numeric = (value: unknown) => {
    const p = number.safeParse(value);
    return p.success ? p.data : null;
  };
  return {
    model: safeModel(data.model) ?? safeModel(requestedModel),
    inputTokens: numeric(u.input_tokens),
    outputTokens: numeric(u.output_tokens),
    totalTokens: numeric(u.total_tokens),
    cachedInputTokens: numeric(u.input_tokens_details?.cached_tokens),
    reasoningTokens: numeric(u.output_tokens_details?.reasoning_tokens),
    // Only explicitly dollar-denominated reported cost, never a price-table estimate.
    reportedCostUsd: numeric(u.cost_usd ?? data.cost_usd),
  };
}
export const latencySchema = z.object({
  version: z.literal(1),
  eventReceivedAt: stamp,
  speechEndOffsetMs: stamp,
  delegationOffsetMs: stamp,
  classifyStartedAt: stamp,
  classifyFinishedAt: stamp,
  dispatchStartedAt: stamp,
  dispatchFinishedAt: stamp,
  resultReadyAt: stamp,
  resultSpokenAt: stamp,
  requestedModel: model.nullable().default(null),
  classifiers: z.array(classifyUsageSchema).max(4).default([]),
  classifyReportsDropped: number.int().default(0),
});
export type DelegationLatency = z.infer<typeof latencySchema>;
export const LATENCY_WINDOW = 100;
export const MAX_LATENCY_WINDOW = 1000;
export function newLatency(
  at: number,
  offset: number,
  speechEnd: number | null,
) {
  return latencySchema.parse({
    version: 1,
    eventReceivedAt: at,
    delegationOffsetMs: offset,
    speechEndOffsetMs: speechEnd,
  });
}
export function readLatency(json: unknown): DelegationLatency | null {
  try {
    return latencySchema.parse(JSON.parse(String(json)));
  } catch {
    return null;
  }
}
const elapsed = (start: number | null, end: number | null) =>
  start !== null && end !== null && end >= start ? end - start : null;
export function stages(m: DelegationLatency) {
  return {
    liveSpeechToDelegationProxy: elapsed(
      m.speechEndOffsetMs,
      m.delegationOffsetMs,
    ),
    waitForClassify: elapsed(m.eventReceivedAt, m.classifyStartedAt),
    classify: elapsed(m.classifyStartedAt, m.classifyFinishedAt),
    dispatch: elapsed(m.dispatchStartedAt, m.dispatchFinishedAt),
    receivedToDispatch: elapsed(m.eventReceivedAt, m.dispatchFinishedAt),
    dispatchToResult: elapsed(m.dispatchFinishedAt, m.resultReadyAt),
    resultToSpeechProxy: elapsed(m.resultReadyAt, m.resultSpokenAt),
    receivedToSpeechProxy: elapsed(m.eventReceivedAt, m.resultSpokenAt),
  };
}
export function answeringModels(m: DelegationLatency) {
  return [
    ...new Set(
      m.classifiers.map((c) => c.model).filter((v): v is string => v !== null),
    ),
  ].sort();
}
export function answeredBy(m: DelegationLatency) {
  const models = answeringModels(m);
  const jev = models.some((v) => /jev/i.test(v)),
    terra = models.some((v) => /terra/i.test(v));
  return jev && terra
    ? "both"
    : jev
      ? "jev"
      : terra
        ? "terra"
        : models.length
          ? "other"
          : null;
}
export function distribution(values: (number | null)[]) {
  const sorted = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1] : null,
    p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
  };
}
function summarize(metrics: DelegationLatency[]) {
  const durations = metrics.map(stages);
  const keys = Object.keys(stages(newLatency(0, 0, null))) as (keyof ReturnType<
    typeof stages
  >)[];
  const usageKeys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "reasoningTokens",
    "reportedCostUsd",
  ] as const;
  return {
    n: metrics.length,
    classifyReportsDropped: metrics.reduce(
      (sum, m) => sum + m.classifyReportsDropped,
      0,
    ),
    stagesMs: Object.fromEntries(
      keys.map((key) => [key, distribution(durations.map((d) => d[key]))]),
    ),
    classifyUsage: Object.fromEntries(
      usageKeys.map((key) => {
        const values = metrics.map((m) =>
          m.classifyReportsDropped === 0 &&
          m.classifiers.length &&
          m.classifiers.every((c) => c[key] !== null)
            ? m.classifiers.reduce((sum, c) => sum + c[key]!, 0)
            : null,
        );
        const stats = distribution(values);
        return [
          key,
          {
            ...stats,
            total: stats.n
              ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
              : null,
          },
        ];
      }),
    ),
  };
}
export function summarizeLatency(
  rows: { metrics_json: unknown; status?: string }[],
  window: number,
) {
  const metrics = rows
    .map((r) => readLatency(r.metrics_json))
    .filter((v): v is DelegationLatency => !!v);
  const groups = new Map<string, DelegationLatency[]>();
  for (const m of metrics) {
    const key = JSON.stringify([m.requestedModel, answeringModels(m)]);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return {
    window,
    sampled: rows.length,
    instrumented: metrics.length,
    outcomes: Object.fromEntries(
      [
        "received",
        "resolving",
        "dispatched",
        "working",
        "completed",
        "failed",
        "cancelled",
        "unknown",
      ].map((state) => [state, rows.filter((r) => r.status === state).length]),
    ),
    ...summarize(metrics),
    omittedModelGroups: Math.max(0, groups.size - 8),
    byModel: [...groups.values()].slice(0, 8).map((group) => ({
      requestedModel: group[0].requestedModel,
      models: answeringModels(group[0]),
      answeredBy: answeredBy(group[0]),
      ...summarize(group),
    })),
  };
}
export function formatLatency(m: DelegationLatency) {
  const d = stages(m);
  const ms = (v: number | null) => (v === null ? "—" : `${v} ms`);
  return `Live ≈ ${ms(d.liveSpeechToDelegationProxy)} · Wait ${ms(d.waitForClassify)} · Classify ${ms(d.classify)} (${answeringModels(m).join(" + ") || m.requestedModel || "—"}) · Dispatch ${ms(d.dispatch)} · Work ${ms(d.dispatchToResult)} · Result → speech ≈ ${ms(d.resultToSpeechProxy)}`;
}
