import test from "node:test";
import assert from "node:assert/strict";
import {
  createJevTransport,
  jevChoiceResponseSchema,
  JEV_DEFAULT_BASE_URL,
  JEV_MAX_OPTIONS,
  type Fetch,
} from "../src/jev-transport";
const key = "ts-live-do-not-leak";
const options = {
  status: "Ask how a thread is doing",
  stop: "Stop a running task",
  open: "Open a thread in BB",
};
function answer(choice = "status") {
  return {
    model: "jev-1.13.0",
    answers: {
      decision: {
        type: "choice",
        choice,
        confidence: 0.91,
        probabilities: { status: 0.94, stop: 0.04, open: 0.02 },
      },
    },
    usage: { input_tokens: 412, output_tokens: 0 },
  };
}
function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl: Fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  };
  return { impl, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("choice posts one systemone question and returns the parsed decision", async () => {
  const fetch = fakeFetch(() => json(answer()));
  const jev = createJevTransport(fetch.impl);
  const result = await jev.choice(key, {
    state: "user: how's the release thread going?",
    instructions: "Which action does the user want?",
    options,
  });
  assert.equal(result.choice, "status");
  assert.equal(result.confidence, 0.91);
  assert.equal(result.probabilities.status, 0.94);
  assert.deepEqual(result.usage, { inputTokens: 412, outputTokens: 0 });
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, `${JEV_DEFAULT_BASE_URL}/systemone`);
  const headers = fetch.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${key}`);
  const body = JSON.parse(String(fetch.calls[0].init.body));
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state, "user: how's the release thread going?");
  assert.deepEqual(body.questions, {
    decision: {
      type: "choice",
      instructions: "Which action does the user want?",
      criteria: options,
    },
  });
});

test("base URL and model overrides are honored and trailing slashes trimmed", async () => {
  const fetch = fakeFetch(() => json(answer()));
  const jev = createJevTransport(fetch.impl);
  await jev.choice(key, {
    baseUrl: "https://gateway.example.com/typesafe/",
    model: "jev-1.13.0",
    state: "x",
    instructions: "y",
    options,
  });
  assert.equal(
    fetch.calls[0].url,
    "https://gateway.example.com/typesafe/systemone",
  );
  assert.equal(
    JSON.parse(String(fetch.calls[0].init.body)).model,
    "jev-1.13.0",
  );
});

test("provider errors become bounded messages without the key or body", async () => {
  for (const [status, pattern] of [
    [401, /TypeSafe API key/],
    [422, /validation/],
    [429, /rate limit/i],
    [529, /overloaded/i],
    [500, /failed \(500\)/],
  ] as const) {
    const fetch = fakeFetch(() =>
      json({ error: `echoed secret ${key} and state` }, status),
    );
    const jev = createJevTransport(fetch.impl);
    await assert.rejects(
      jev.choice(key, { state: "s", instructions: "i", options }),
      (error: Error) => {
        assert.match(error.message, pattern);
        assert.ok(!error.message.includes(key));
        assert.ok(!error.message.includes("echoed"));
        return true;
      },
    );
  }
});

test("network failures are replaced by a bounded message, aborts propagate", async () => {
  const failing = createJevTransport(async () => {
    throw new TypeError(`fetch failed: https://api.typesafe.ai/v1?k=${key}`);
  });
  await assert.rejects(
    failing.choice(key, { state: "s", instructions: "i", options }),
    (error: Error) => {
      assert.equal(error.message, "Jev request could not be completed.");
      return true;
    },
  );
  const controller = new AbortController();
  const aborting = createJevTransport(async (_url, init) => {
    controller.abort();
    init?.signal?.throwIfAborted();
    return json(answer());
  });
  await assert.rejects(
    aborting.choice(
      key,
      { state: "s", instructions: "i", options },
      controller.signal,
    ),
    (error: Error) => error.name === "AbortError",
  );
});

test("malformed, unexpected, and out-of-menu answers are rejected", async () => {
  const cases: [string, () => Response][] = [
    ["unreadable", () => new Response("not json", { status: 200 })],
    ["wrong shape", () => json({ model: "jev", answers: {} })],
    [
      "probability out of range",
      () =>
        json({
          ...answer(),
          answers: {
            decision: { ...answer().answers.decision, confidence: 1.4 },
          },
        }),
    ],
    ["not offered", () => json(answer("merge"))],
  ];
  for (const [name, make] of cases) {
    const jev = createJevTransport(fakeFetch(make).impl);
    await assert.rejects(
      jev.choice(key, { state: "s", instructions: "i", options }),
      Error,
      name,
    );
  }
});

test("requests are validated before any network call", async () => {
  const fetch = fakeFetch(() => json(answer()));
  const jev = createJevTransport(fetch.impl);
  await assert.rejects(
    jev.choice("", { state: "s", instructions: "i", options }),
    /TypeSafe API key/,
  );
  await assert.rejects(
    jev.choice(key, { state: "s", instructions: "i", options: { only: "1" } }),
    /at least two/,
  );
  const tooMany = Object.fromEntries(
    Array.from({ length: JEV_MAX_OPTIONS + 1 }, (_, i) => [`t${i}`, "x"]),
  );
  await assert.rejects(
    jev.choice(key, { state: "s", instructions: "i", options: tooMany }),
    /at most/,
  );
  await assert.rejects(
    jev.choice(key, {
      state: "x".repeat(60001),
      instructions: "i",
      options,
    }),
    /too large/,
  );
  assert.equal(fetch.calls.length, 0);
});

test("response schema matches the documented systemone choice answer", () => {
  assert.ok(jevChoiceResponseSchema.safeParse(answer()).success);
  assert.equal(
    jevChoiceResponseSchema.safeParse({
      ...answer(),
      usage: { input_tokens: -1, output_tokens: 0 },
    }).success,
    false,
  );
  assert.equal(
    jevChoiceResponseSchema.safeParse({
      ...answer(),
      answers: { decision: { type: "score", score: 2 } },
    }).success,
    false,
  );
});
