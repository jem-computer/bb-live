import { z } from "zod";
// TypeSafe's Jev is a decision-only model: it answers typed questions about a
// piece of state with calibrated probabilities and never generates text. This
// transport wraps the `systemone` endpoint for the Choice primitive only. The
// router follow-ups (action, target, visual gate) build on it; nothing calls
// it in the delegation path yet.
export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
export const JEV_DEFAULT_MODEL = "jev-latest";
// Documented limit for one Choice question.
export const JEV_MAX_OPTIONS = 255;
// Bounded request size so a workspace directory can't grow the state
// without limit; callers pre-filter before reaching this.
export const JEV_MAX_STATE_CHARS = 60000;
export interface JevChoiceRequest {
  baseUrl?: string;
  model?: string;
  /** Free-text context the model decides over: transcript window, focus, names. */
  state: string;
  /** What is being decided. */
  instructions: string;
  /** Option id -> description. Ids are returned verbatim in the answer. */
  options: Record<string, string>;
}
export interface JevChoiceResult {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}
export interface JevTransport {
  choice(
    key: string,
    request: JevChoiceRequest,
    signal?: AbortSignal,
  ): Promise<JevChoiceResult>;
}
const probability = z.number().min(0).max(1);
export const jevChoiceResponseSchema = z.object({
  model: z.string(),
  answers: z.object({
    decision: z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: probability,
      probabilities: z.record(z.string(), probability),
    }),
  }),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
export type Fetch = typeof fetch;
function bounded(status: number): string {
  // Never include provider bodies: they can echo request text.
  if (status === 401)
    return "Jev request rejected (401). Check the TypeSafe API key in BB Live settings.";
  if (status === 422) return "Jev request failed validation (422).";
  if (status === 429) return "Jev rate limit reached (429). Try again shortly.";
  if (status === 529) return "Jev is overloaded (529). Try again shortly.";
  return `Jev request failed (${status}). Check API access and settings.`;
}
export function createJevTransport(fetchImpl: Fetch = fetch): JevTransport {
  return {
    async choice(key, request, signal) {
      if (!key) throw new Error("Add a TypeSafe API key in BB Live settings.");
      const ids = Object.keys(request.options);
      if (ids.length < 2)
        throw new Error("Jev choice needs at least two options.");
      if (ids.length > JEV_MAX_OPTIONS)
        throw new Error(
          `Jev choice accepts at most ${JEV_MAX_OPTIONS} options; got ${ids.length}.`,
        );
      if (request.state.length > JEV_MAX_STATE_CHARS)
        throw new Error("Jev request state is too large.");
      const base = (request.baseUrl || JEV_DEFAULT_BASE_URL).replace(
        /\/+$/,
        "",
      );
      let response: Response;
      try {
        response = await fetchImpl(`${base}/systemone`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: request.model || JEV_DEFAULT_MODEL,
            state: request.state,
            questions: {
              decision: {
                type: "choice",
                instructions: request.instructions,
                criteria: request.options,
              },
            },
          }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        // Network and timeout errors carry the URL, never the key or body.
        throw new Error("Jev request could not be completed.");
      }
      if (!response.ok) throw new Error(bounded(response.status));
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new Error("Jev returned an unreadable response.");
      }
      const parsed = jevChoiceResponseSchema.safeParse(raw);
      if (!parsed.success)
        throw new Error("Jev returned an unexpected response shape.");
      const answer = parsed.data.answers.decision;
      if (!(answer.choice in request.options))
        throw new Error("Jev chose an option that was not offered.");
      return {
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        usage: {
          inputTokens: parsed.data.usage.input_tokens,
          outputTokens: parsed.data.usage.output_tokens,
        },
        model: parsed.data.model,
      };
    },
  };
}
export const jevTransport = createJevTransport();
