import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { definePluginApp, useRpc, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./src/contract";
import * as live from "./src/client";
import { Icon } from "./src/icons";
import { LiveSettings } from "./src/settings";
import "./style.css";
let hasOverlay = false;
const useLive = () => useSyncExternalStore(live.subscribe, live.snapshot);
function SettingsLink() {
  return (
    <a
      className="bl-settings"
      href="/settings/plugins/bb-live"
      onClick={(event) => {
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          history.pushState(null, "", "/settings/plugins/bb-live");
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      }}
    >
      Settings
      <Icon name="ArrowUpRight" style={{ width: 14, height: 14 }} />
    </a>
  );
}
function StartButton() {
  const s = useLive();
  return (
    <button
      className="bl-start"
      disabled={
        s.configured !== true ||
        (s.busy && !s.auth) ||
        ["connecting", "ending"].includes(s.status)
      }
      onClick={() => void live.start(null, null)}
    >
      <Icon name="Mic" style={{ width: 20, height: 20 }} />
      {s.status === "connecting" ? "Connecting…" : "Start voice"}
    </button>
  );
}
function Controls() {
  const s = useLive();
  return (
    <div className="bl-controls">
      <button
        aria-label={s.muted ? "Unmute microphone" : "Mute microphone"}
        title={s.muted ? "Unmute microphone" : "Mute microphone"}
        aria-pressed={s.muted}
        onClick={live.mute}
      >
        <Icon
          name={s.muted ? "MicOff" : "Mic"}
          style={{ width: 20, height: 20 }}
        />
        <span>{s.muted ? "Unmute" : "Mute"}</span>
      </button>
      {s.muted && (
        <button
          className={"bl-ptt " + (s.ptt ? "is-down" : "")}
          aria-label="Hold to talk"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            live.pushToTalk(true);
          }}
          onPointerUp={() => live.pushToTalk(false)}
          onPointerCancel={() => live.pushToTalk(false)}
          onLostPointerCapture={() => live.pushToTalk(false)}
          onKeyDown={(event) => {
            if ([" ", "Enter"].includes(event.key)) {
              event.preventDefault();
              live.pushToTalk(true);
            }
          }}
          onKeyUp={() => live.pushToTalk(false)}
          onBlur={() => live.pushToTalk(false)}
        >
          Hold to talk
        </button>
      )}
      <button
        aria-label={s.silenced ? "Unsilence BB Live" : "Silence BB Live"}
        title={s.silenced ? "Turn BB's voice back on" : "Silence BB's voice"}
        aria-pressed={s.silenced}
        onClick={live.silence}
      >
        <Icon
          name={s.silenced ? "VolumeX" : "Volume2"}
          style={{ width: 20, height: 20 }}
        />
        <span>{s.silenced ? "Sound on" : "Silence"}</span>
      </button>
      <button
        aria-label="Stop talking"
        title="Interrupt BB"
        onClick={() => void live.interrupt()}
      >
        <Icon name="Square" style={{ width: 16, height: 16 }} />
        <span>Interrupt</span>
      </button>
      <button
        aria-label="Open transcript and details"
        title="Transcript and focus"
        aria-expanded={s.details}
        aria-pressed={s.details}
        onClick={() => live.details()}
      >
        <Icon name="MessageSquare" style={{ width: 20, height: 20 }} />
        <span>Transcript</span>
      </button>
      <span className="bl-divider" aria-hidden="true" />
      <button
        className="bl-end"
        title="End voice session"
        aria-label="End voice session"
        onClick={() => void live.end()}
      >
        <Icon name="PhoneOff" style={{ width: 20, height: 20 }} />
        <span>End</span>
      </button>
    </div>
  );
}
function Wave() {
  const s = useLive();
  const mode = !s.auth
    ? "idle"
    : s.status === "speaking"
      ? "speaking"
      : s.muted && !s.ptt
        ? "muted"
        : "listening";
  return (
    <div className="bl-wave" data-mode={mode} aria-hidden="true">
      {[12, 26, 40, 20, 54, 34, 64, 44, 28, 48, 20, 34, 12].map((height, i) => (
        <i
          key={i}
          style={{
            height,
            animationDelay: `${(i % 5) * 0.11}s`,
            animationDuration: `${0.9 + (i % 3) * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}
function Status() {
  const s = useLive();
  const labels = {
    ending: "Ending voice",
    idle: "Ready when you are",
    connecting: "Connecting",
    listening: s.muted && !s.ptt ? "Microphone muted" : "Listening",
    speaking: "Speaking",
    delegated: "Working in BB",
    reconnecting: "Reconnecting",
    error: "Connection needs attention",
  };
  const tone =
    s.status === "speaking"
      ? "speaking"
      : s.status === "listening"
        ? s.muted && !s.ptt
          ? "muted"
          : "listening"
        : ["reconnecting", "error"].includes(s.status)
          ? "warn"
          : s.status === "connecting"
            ? "busy"
            : "";
  return (
    <span className="bl-status" role="status" data-tone={tone}>
      <i />
      {labels[s.status]}
    </span>
  );
}
function Transcript() {
  const s = useLive();
  const nav = useBbNavigate();
  const bottom = useRef<HTMLDivElement>(null);
  const grouped = s.events.reduce<typeof s.events>((items, event) => {
    const previous = items.at(-1);
    if (
      previous &&
      ["speech", "user"].includes(event.kind) &&
      previous.kind === event.kind &&
      event.at - previous.at < 2000
    ) {
      items[items.length - 1] = {
        ...previous,
        text: previous.text + event.text,
        at: event.at,
      };
    } else items.push({ ...event });
    return items;
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [s.events.length]);
  return (
    <div className="bl-transcript" aria-label="Session transcript">
      {grouped.length === 0 ? (
        <div className="bl-empty">Your conversation will appear here.</div>
      ) : (
        grouped.map((event) => (
          <div
            className={"bl-event bl-kind-" + event.kind}
            key={event.sequence}
          >
            <div className="bl-event-heading">
              <span>
                {(
                  {
                    user: "You",
                    speech: "BB",
                    delegation: "Delegated",
                    result: "BB result",
                    approval: "Needs your attention",
                    focus: "Focus",
                    failure: "Unable to verify",
                    notice: "Session",
                  } as Record<string, string>
                )[event.kind] ?? event.kind}
              </span>
              <time>
                {new Date(event.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p>{event.text}</p>
            {event.threadId && (
              <button
                className="bl-text-button"
                onClick={() => nav.toThread(event.threadId!)}
              >
                Open thread
                <Icon name="ArrowUpRight" style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        ))
      )}
      <div ref={bottom} />
    </div>
  );
}
function FocusPicker() {
  const s = useLive();
  const rpc = useRpc<typeof rpcContract>();
  const [world, setWorld] = useState<Awaited<ReturnType<typeof load>> | null>(
    null,
  );
  const load = () => rpc.call("workspace");
  useEffect(() => {
    void load().then(setWorld, () => {});
  }, [rpc]);
  return (
    <label className="bl-focus">
      <span>Focus</span>
      <select
        aria-label="Conversation focus"
        value={
          s.focus.kind === "global" ? "global" : `${s.focus.kind}:${s.focus.id}`
        }
        onChange={(event) => {
          const [kind, id] = event.target.value.split(":");
          void live.focus(kind as "global" | "project" | "thread", id ?? null);
        }}
      >
        <option value="global">All of BB</option>
        {world?.projects.map((p) => (
          <optgroup key={p.id} label={p.name}>
            <option value={`project:${p.id}`}>{p.name} · whole project</option>
            {world.threads
              .filter((t) => t.projectId === p.id)
              .map((t) => (
                <option key={t.id} value={`thread:${t.id}`}>
                  {t.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
function Details() {
  const s = useLive();
  const nav = useBbNavigate();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => before?.focus();
  }, []);
  return (
    <section
      className="bl-details"
      role="dialog"
      aria-label="BB Live session details"
      onKeyDown={(e) => {
        if (e.key === "Escape") live.details(false);
      }}
    >
      <header>
        <div>
          <span className="bl-eyebrow">BB Live</span>
          <h2>Transcript</h2>
        </div>
        <button
          ref={close}
          aria-label="Close details"
          onClick={() => live.details(false)}
        >
          <Icon name="X" style={{ width: 20, height: 20 }} />
        </button>
      </header>
      <FocusPicker />
      {s.pending.map((p) => (
        <button
          className="bl-approval"
          key={p.id}
          onClick={() => nav.toThread(p.threadId)}
        >
          <Icon name="AlertCircle" style={{ width: 18, height: 18 }} />
          <span>{p.title}</span>
          <Icon name="ArrowUpRight" style={{ width: 14, height: 14 }} />
        </button>
      ))}
      <Transcript />
      <footer>
        {s.operatorId && (
          <button
            className="bl-text-button"
            onClick={() => nav.toThread(s.operatorId!)}
          >
            Open BB Operator
            <Icon name="ArrowUpRight" style={{ width: 13, height: 13 }} />
          </button>
        )}
        <span>Text only · no audio is recorded</span>
      </footer>
    </section>
  );
}
function Controller() {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const s = useLive();
  useEffect(() => {
    const start = () => void live.start(null, null);
    window.addEventListener("bb-live-start", start);
    return () => window.removeEventListener("bb-live-start", start);
  }, []);
  live.configure(rpc, nav.toThread);
  useEffect(() => {
    void live.refreshConfig();
    const refresh = setInterval(() => void live.refreshConfig(), 15000);
    const detach = live.attachLifecycle();
    return () => {
      clearInterval(refresh);
      detach();
    };
  }, []);
  return null;
}
function Overlay() {
  const s = useLive();
  const bar = useRef<HTMLElement>(null);
  const [barHeight, setBarHeight] = useState(100);
  useEffect(() => {
    if (!bar.current) return;
    const observer = new ResizeObserver((entries) =>
      setBarHeight(entries[0].contentRect.height + 24),
    );
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, [!!s.auth, s.status === "connecting"]);
  return (
    <>
      <Controller />
      {s.error && !s.auth && (
        <aside className="bl bl-overlay bl-global-error">
          <p role="alert">{s.error}</p>
          <StartButton />
          <button aria-label="Dismiss voice error" onClick={live.dismissError}>
            Dismiss
          </button>
        </aside>
      )}
      {s.details && (
        <div
          className="bl bl-details-wrap"
          style={{
            bottom: `calc(${barHeight + 28}px + env(safe-area-inset-bottom, 0px))`,
          }}
        >
          <Details />
        </div>
      )}
      {(s.auth || s.status === "connecting") && (
        <aside
          ref={bar}
          className="bl bl-overlay"
          data-status={s.status}
          aria-label="BB Live voice controls"
        >
          <div className="bl-mini">
            <div className="bl-live-mark" data-status={s.status}>
              <Icon
                name={s.muted && !s.ptt ? "MicOff" : "Mic"}
                style={{ width: 18, height: 18 }}
              />
            </div>
            <div>
              <Status />
              <p>{s.focus.label}</p>
            </div>
            {s.status === "connecting" && (
              <button onClick={() => void live.end()}>Cancel</button>
            )}
          </div>
          {s.auth && <Controls />}
          {s.audioBlocked && (
            <button className="bl-play" onClick={live.play}>
              Tap to enable sound
            </button>
          )}
          {s.pending.length > 0 && (
            <button className="bl-attention" onClick={() => live.details(true)}>
              <Icon name="AlertCircle" style={{ width: 15, height: 15 }} />
              {s.pending.length} waiting for review
            </button>
          )}
        </aside>
      )}
    </>
  );
}
function LivePage() {
  const s = useLive();
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [world, setWorld] = useState<Awaited<ReturnType<typeof load>> | null>(
    null,
  );
  const [worldError, setWorldError] = useState(false);
  const load = () => rpc.call("workspace");
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      void load().then(
        (w) => {
          if (mounted) {
            setWorld(w);
            setWorldError(false);
          }
        },
        () => {
          if (mounted) setWorldError(true);
        },
      );
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [rpc]);
  const attention =
    world?.threads.filter((t) =>
      ["needs attention", "error"].includes(t.status),
    ) ?? [];
  return (
    <main className="bl bl-page">
      {!hasOverlay && <Controller />}
      <div className="bl-page-inner">
        <header className="bl-page-header">
          <div className="bl-wordmark">
            <Icon name="Mic" style={{ width: 22, height: 22 }} />
            <span>BB Live</span>
          </div>
          <SettingsLink />
        </header>
        <div className="bl-layout">
          <section className="bl-conversation">
            <div className="bl-hero">
              <span className="bl-eyebrow">Voice for your workspace</span>
              <h1>Talk to BB while your agents work.</h1>
              <p>Check in, change direction, or get something started.</p>
              <Wave />
              <Status />
              <div className="bl-start-row">
                {s.auth ? (
                  <button
                    className="bl-start"
                    onClick={() => live.details(true)}
                  >
                    <Icon
                      name="MessageSquare"
                      style={{ width: 19, height: 19 }}
                    />
                    Open conversation
                  </button>
                ) : (
                  <StartButton />
                )}
              </div>
              {s.configured === false && (
                <p className="bl-config">
                  Add your OpenAI API key in <SettingsLink /> to start.
                </p>
              )}
              {s.busy && !s.auth && s.status !== "connecting" && (
                <p className="bl-config">Voice is open in another BB window.</p>
              )}
              {s.notice && (
                <p className="bl-notice" role="status">
                  {s.notice}
                </p>
              )}
              {s.error && (
                <p className="bl-error" role="alert">
                  {s.error}
                </p>
              )}
              <div className="bl-prompts" aria-label="Things you can say">
                <span>“What needs my attention?”</span>
                <span>“Start a review in the API project.”</span>
                <span>“Tell that agent to preserve compatibility.”</span>
              </div>
            </div>
            {!hasOverlay && s.auth && <Controls />}
            {!hasOverlay && s.details && <Details />}
          </section>
          <aside className="bl-workspace">
            <header>
              <h2>In your workspace</h2>
              <span className="bl-live-label">
                <i />
                Live
              </span>
            </header>
            {worldError ? (
              <p role="alert">Couldn’t load BB status. Reconnecting…</p>
            ) : !world ? (
              <p>Loading your threads…</p>
            ) : (
              <>
                <div className="bl-counts">
                  <div>
                    <strong>
                      {
                        world.threads.filter((t) =>
                          ["active", "starting"].includes(t.status),
                        ).length
                      }
                    </strong>
                    <span>Working</span>
                  </div>
                  <div>
                    <strong>{attention.length}</strong>
                    <span>Need attention</span>
                  </div>
                  <div>
                    <strong>{world.projects.length}</strong>
                    <span>Projects</span>
                  </div>
                </div>
                <div className="bl-thread-list">
                  {[...world.threads]
                    .sort(
                      (a, b) =>
                        Number(
                          ["needs attention", "error"].includes(b.status),
                        ) -
                        Number(["needs attention", "error"].includes(a.status)),
                    )
                    .slice(0, 8)
                    .map((t) => (
                      <button
                        key={t.id}
                        className="bl-thread"
                        onClick={() => nav.toThread(t.id)}
                      >
                        <i
                          className={
                            t.status === "active"
                              ? "active"
                              : ["error", "needs attention"].includes(t.status)
                                ? "attention"
                                : ""
                          }
                        />
                        <div>
                          <span>{t.title}</span>
                          <small>
                            {
                              world.projects.find((p) => p.id === t.projectId)
                                ?.name
                            }{" "}
                            · {t.status}
                          </small>
                        </div>
                        <Icon
                          name="ArrowUpRight"
                          style={{ width: 14, height: 14 }}
                        />
                      </button>
                    ))}
                  {world.threads.length === 0 && <p>No threads yet.</p>}
                </div>
                {world.truncated && (
                  <p className="bl-notice">Showing up to 2,000 open threads.</p>
                )}
              </>
            )}
            <div className="bl-continuity">
              <Icon name="GitBranch" style={{ width: 16, height: 16 }} />
              <p>Agents keep working after the conversation ends.</p>
            </div>
          </aside>
        </div>
        <footer className="bl-page-footer">
          <span>One voice session per BB</span>
          <span>Text transcript only · no audio is recorded</span>
        </footer>
      </div>
    </main>
  );
}
export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "preferences",
    title: "Preferences",
    component: LiveSettings,
  });
  hasOverlay = typeof app.slots.experimental_appOverlay === "function";
  if (hasOverlay)
    app.slots.experimental_appOverlay({ id: "voice", component: Overlay });
  app.slots.navPanel({
    id: "live",
    path: "live",
    title: "BB Live",
    icon: "Mic",
    component: LivePage,
  });
  app.slots.sidebarFooterAction({
    id: "start-voice",
    title: "Start BB Live",
    icon: "Mic",
    run: (context) => {
      const s = live.snapshot();
      if (s.configured === false || !hasOverlay) context.openSettings();
      else if (s.auth) live.details(true);
      else window.dispatchEvent(new Event("bb-live-start"));
    },
  });
});
