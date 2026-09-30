import WebSocket from "ws";
import { classifyUsage, type ClassifyUsage } from "./latency";
import { z } from "zod";
import { intentSchema, ROUTER_PROMPT, type Intent } from "./policy";
export interface LiveTransport {
  create(
    key: string,
    sdp: string,
    voice: string,
    signal: AbortSignal,
    instructions: string,
  ): Promise<{ id: string; sdp: string }>;
  attach(
    key: string,
    id: string,
    onEvent: (event: Record<string, unknown>) => void,
    onLost: () => void,
  ): Promise<LiveSocket>;
  classify(
    key: string,
    model: string,
    context: string,
    signal: AbortSignal,
    onUsage?: (usage: ClassifyUsage) => void,
  ): Promise<Intent>;
  closeRemote(key: string, id: string): Promise<void>;
}
export interface LiveSocket {
  send(event: Record<string, unknown>): void;
  close(): void;
}
async function api(
  key: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      `OpenAI request failed (${response.status}). Check API access and settings.`,
    );
  return response.json();
}
export const transport: LiveTransport = {
  async create(key, sdp, voice, signal, instructions) {
    const raw = await api(
      key,
      "live/sessions",
      {
        session: {
          model: "gpt-live-1",
          instructions,
          audio: { output: { voice } },
          delegation: { type: "client" },
          store: false,
          client: {
            data_channel: {
              allowed_client_events: [],
              allowed_server_events: [
                { type: "session.started" },
                { type: "session.closed" },
                { type: "error" },
              ],
            },
          },
        },
        transport: { type: "webrtc", sdp },
      },
      signal,
    );
    const value = z
      .object({
        session: z.object({ id: z.string() }),
        transport: z.object({ sdp: z.string() }),
      })
      .parse(raw);
    return { id: value.session.id, sdp: value.transport.sdp };
  },
  attach(key, id, onEvent, onLost) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`,
        {
          headers: { Authorization: `Bearer ${key}` },
          maxPayload: 2 * 1024 * 1024,
          handshakeTimeout: 10000,
        },
      );
      let opened = false,
        closed = false;
      socket.on("open", () => {
        opened = true;
        resolve({
          send(event) {
            if (socket.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify(event));
          },
          close() {
            closed = true;
            socket.terminate();
          },
        });
      });
      socket.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString());
          if (typeof event.type === "string" && !event.type.includes("_audio."))
            onEvent(event);
        } catch {
          /* Discard malformed and reflected audio events. */
        }
      });
      socket.on("error", () => {
        if (!opened)
          reject(
            new Error("Live control connection could not be established."),
          );
      });
      socket.on("close", () => {
        if (!opened) reject(new Error("Live control connection closed."));
        else if (!closed) onLost();
      });
    });
  },
  async classify(key, model, context, signal, onUsage) {
    const raw = await api(
      key,
      "responses",
      {
        model,
        store: false,
        instructions: ROUTER_PROMPT,
        input: context,
        text: {
          format: {
            type: "json_schema",
            name: "bb_intent",
            strict: true,
            schema: z.toJSONSchema(intentSchema),
          },
        },
        max_output_tokens: 1800,
      },
      signal,
    );
    onUsage?.(classifyUsage(raw, model));
    const chunks = z
      .object({
        output: z.array(
          z.object({
            content: z
              .array(
                z.object({ type: z.string(), text: z.string().optional() }),
              )
              .optional(),
          }),
        ),
      })
      .parse(raw);
    const text = chunks.output
      .flatMap((x) => x.content ?? [])
      .filter((x) => x.type === "output_text")
      .map((x) => x.text ?? "")
      .join("");
    return intentSchema.parse(JSON.parse(text));
  },
  async closeRemote(key, id) {
    const socket = await transport.attach(
      key,
      id,
      () => {},
      () => {},
    );
    socket.send({ type: "session.close" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    socket.close();
  },
};
