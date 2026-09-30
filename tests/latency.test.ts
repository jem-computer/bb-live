import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyUsage,
  distribution,
  newLatency,
  summarizeLatency,
  formatLatency,
  safeModel,
  stages,
} from "../src/latency";
import { transport } from "../src/live-transport";

test("nearest-rank percentiles omit unknown samples and preserve measured zero", () => {
  assert.deepEqual(distribution([null, 0, 10, 20, 30]), {
    n: 4,
    p50: 10,
    p95: 30,
  });
  assert.deepEqual(distribution([]), { n: 0, p50: null, p95: null });
  assert.deepEqual(distribution(Array.from({ length: 100 }, (_, i) => i + 1)), {
    n: 100,
    p50: 50,
    p95: 95,
  });
  const m = newLatency(100, 10, 20);
  assert.equal(stages(m).liveSpeechToDelegationProxy, null);
});

test("usage projection drops text, secrets and invalid numbers without inventing missing cost", () => {
  const usage = classifyUsage(
    {
      model: "gpt-5.6-terra",
      input: "secret transcript",
      usage: {
        input_tokens: 0,
        output_tokens: -1,
        total_tokens: Infinity,
        cost_usd: "0.1",
        input_tokens_details: { cached_tokens: 5, text: "private" },
        output_tokens_details: { reasoning_tokens: 3 },
      },
    },
    "fallback",
  );
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, null);
  assert.equal(usage.totalTokens, null);
  assert.equal(usage.reportedCostUsd, null);
  assert.equal(usage.cachedInputTokens, 5);
  assert.doesNotMatch(JSON.stringify(usage), /private|transcript/);
  assert.equal(safeModel("sk-private-key"), null);
  assert.equal(safeModel("a model with text"), null);
  assert.equal(safeModel("x".repeat(101)), null);
});

test("mixed Jev/Terra reports are grouped as both; incomplete cost is not counted as free", () => {
  const m = newLatency(100, 10, 0);
  m.classifiers = [
    classifyUsage(
      { model: "jev", usage: { input_tokens: 50, cost_usd: 0 } },
      "jev",
    ),
    classifyUsage(
      { model: "gpt-5.6-terra", usage: { input_tokens: 100 } },
      "terra",
    ),
  ];
  const summary = summarizeLatency([{ metrics_json: JSON.stringify(m) }], 100);
  assert.equal(summary.byModel[0].answeredBy, "both");
  assert.deepEqual(summary.byModel[0].models, ["gpt-5.6-terra", "jev"]);
  assert.equal(summary.classifyUsage.inputTokens.total, 150);
  assert.equal(summary.classifyUsage.reportedCostUsd.n, 0);
  assert.equal(summary.classifyUsage.reportedCostUsd.total, null);
  assert.match(formatLatency(m), /Live ≈ 10 ms/);
  assert.match(formatLatency(m), /Classify — \(gpt-5.6-terra \+ jev\)/);
  assert.match(formatLatency(m), /Result → speech ≈ —/);
});

test("status bounds model groups and treats legacy or corrupt telemetry as uninstrumented", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => {
    const m = newLatency(i, i, null);
    m.requestedModel = `model-${i}`;
    return { metrics_json: JSON.stringify(m) };
  });
  const summary = summarizeLatency(
    [...rows, { metrics_json: "malformed" }, { metrics_json: null }],
    1000,
  );
  assert.equal(summary.sampled, 1002);
  assert.equal(summary.instrumented, 1000);
  assert.equal(summary.byModel.length, 8);
  assert.equal(summary.omittedModelGroups, 992);
  assert.ok(JSON.stringify(summary).length < 20000);
});

test("Responses transport reports actual model and usage before validating intent, even on malformed output", async () => {
  const original = globalThis.fetch;
  const reports: unknown[] = [];
  let text = JSON.stringify({
    action: "capabilities",
    target: null,
    message: "private answer",
    uncertain: false,
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "gpt-5.6-terra-2026-09-01",
        usage: {
          input_tokens: 200,
          output_tokens: 30,
          total_tokens: 230,
          cost_usd: 0.003,
        },
        output: [{ content: [{ type: "output_text", text }] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const intent = await transport.classify(
      "sk-test",
      "gpt-5.6-terra",
      "private prompt",
      new AbortController().signal,
      (r) => reports.push(r),
    );
    assert.equal(intent.action, "capabilities");
    assert.deepEqual(reports[0], {
      model: "gpt-5.6-terra-2026-09-01",
      inputTokens: 200,
      outputTokens: 30,
      totalTokens: 230,
      cachedInputTokens: null,
      reasoningTokens: null,
      reportedCostUsd: 0.003,
    });
    text = "invalid JSON private output";
    await assert.rejects(
      transport.classify(
        "sk-test",
        "gpt-5.6-terra",
        "private prompt",
        new AbortController().signal,
        (r) => reports.push(r),
      ),
    );
    assert.equal(reports.length, 2);
    assert.doesNotMatch(JSON.stringify(reports), /private|sk-test/);
  } finally {
    globalThis.fetch = original;
  }
});
