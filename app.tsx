import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { definePluginApp, useRpc, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type {
  ExperimentalSidebarFooterDisclosureController,
  ExperimentalSidebarFooterDisclosureProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./src/contract";
import * as live from "./src/client";
import { Icon } from "./src/icons";
import { LiveSettings } from "./src/settings";
import "./style.css";
let footer: ExperimentalSidebarFooterDisclosureController | undefined;
function openDetails() {
  live.details(true);
  footer?.open();
}
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
      Settings <span aria-hidden="true">↗</span>
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
        aria-pressed={s.silenced}
        onClick={live.silence}
      >
        <Icon
          name={s.silenced ? "VolumeX" : "Volume2"}
          style={{ width: 20, height: 20 }}
        />
        <span>{s.silenced ? "Sound on" : "Silence"}</span>
      </button>
      <button aria-label="Stop talking" onClick={() => void live.interrupt()}>
        <Icon name="Square" style={{ width: 17, height: 17 }} />
        <span>Stop talking</span>
      </button>
      <button
        className="bl-end"
        aria-label="End voice session"
        onClick={() => void live.end()}
      >
        <Icon name="PhoneOff" style={{ width: 20, height: 20 }} />
        <span>End</span>
      </button>
    </div>
  );
}
function Wave({ active = false }: { active?: boolean }) {
  return (
    <div className={"bl-wave " + (active ? "is-live" : "")} aria-hidden="true">
      {[12, 26, 40, 20, 54, 34, 64, 44, 28, 48, 20, 34, 12].map((height, i) => (
        <i key={i} style={{ height, animationDelay: `${i * 0.09}s` }} />
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
  return (
    <span className="bl-status" role="status">
      <i className={s.auth ? "on" : ""} />
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
          <div className={"bl-event bl-" + event.kind} key={event.sequence}>
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
                Open thread ↗
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
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <section
      className="bl-details"
      aria-label="BB Live session details"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          live.details(false);
        }
      }}
    >
      <header>
        <div>
          <span className="bl-eyebrow">BB LIVE</span>
          <h2>Your conversation</h2>
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
          {p.title} ↗
        </button>
      ))}
      <Transcript />
      <footer>
        {s.operatorId && (
          <button
            className="bl-text-button"
            onClick={() => nav.toThread(s.operatorId!)}
          >
            Open BB Operator ↗
          </button>
        )}
        <span>Text only · no audio recording</span>
      </footer>
    </section>
  );
}
function Controller() {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const s = useLive();
  useEffect(() => {
    if (s.status === "connecting") footer?.open();
  }, [s.status]);
  useEffect(() => {
    if (s.error) footer?.open();
  }, [s.error]);
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
function FooterIcon({ className }: { className?: string }) {
  const s = useLive();
  const active = !!s.auth || s.status === "connecting";
  const attention = !!s.error || s.pending.length > 0 || s.audioBlocked;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
      {s.muted && active && <path d="m3 3 18 18" />}
      {(active || attention) && (
        <circle
          cx="19"
          cy="5"
          r="3.5"
          fill={attention ? "var(--destructive, #df8585)" : "#7bc39b"}
          stroke="var(--background, #17151b)"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
function FooterPanel({ dismiss }: ExperimentalSidebarFooterDisclosureProps) {
  const s = useLive();
  // Collapsing the footer must release a held microphone without ending voice.
  useEffect(() => () => live.pushToTalk(false), []);
  return (
    <section className="bl bl-footer" aria-label="BB Live voice controls">
      <header className="bl-footer-header">
        <div className="bl-footer-status">
          <strong>BB Live</strong>
          <Status />
          <p title={s.focus.label}>{s.focus.label}</p>
        </div>
        <button
          className="bl-collapse"
          aria-label="Collapse voice controls"
          onClick={dismiss}
        >
          <Icon name="ChevronDown" />
        </button>
      </header>
      {s.auth ? (
        <Controls />
      ) : s.status === "connecting" ? (
        <button className="bl-text-button" onClick={() => void live.end()}>
          Cancel connection
        </button>
      ) : (
        <StartButton />
      )}
      {s.configured === false && (
        <p className="bl-config">
          Add your OpenAI API key in <SettingsLink />.
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
        <div className="bl-error">
          <p role="alert">{s.error}</p>
          <button className="bl-text-button" onClick={live.dismissError}>
            Dismiss error
          </button>
        </div>
      )}
      {s.audioBlocked && (
        <button className="bl-play" onClick={live.play}>
          Tap to enable sound
        </button>
      )}
      {s.pending.length > 0 && (
        <button className="bl-attention" onClick={openDetails}>
          {s.pending.length} waiting for review
        </button>
      )}
      <div className="bl-footer-links">
        <button
          className="bl-text-button"
          aria-expanded={s.details}
          onClick={() => live.details()}
        >
          <Icon name="MessageSquare" style={{ width: 16, height: 16 }} />
          {s.details ? "Hide transcript" : "Transcript"}
        </button>
        <SettingsLink />
      </div>
      {s.details && <Details />}
    </section>
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
              <span className="bl-eyebrow">
                YOUR WORKSPACE, IN CONVERSATION
              </span>
              <h1>
                One conversation.
                <br />
                All your work.
              </h1>
              <p>Check in, change direction, or get something started.</p>
              <Wave active={!!s.auth} />
              <Status />
              <div className="bl-start-row">
                {s.auth ? (
                  <button className="bl-start" onClick={openDetails}>
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
              <div className="bl-prompts">
                <span>“What needs my attention?”</span>
                <span>“Start a review in the API project.”</span>
                <span>“Tell that agent to preserve compatibility.”</span>
              </div>
            </div>
            {s.auth && <Controls />}
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
                        <span aria-hidden="true">↗</span>
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
              <Icon name="GitBranch" style={{ width: 19, height: 19 }} />
              <p>
                Your agents keep working
                <br />
                when the conversation ends.
              </p>
            </div>
          </aside>
        </div>
        <footer className="bl-page-footer">
          <span>
            <i />
            One voice session across BB
          </span>
          <span>Microphone and speaker controls are independent</span>
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
  app.slots.experimental_appOverlay({ id: "voice", component: Controller });
  app.slots.navPanel({
    id: "live",
    path: "live",
    title: "BB Live",
    icon: "Mic",
    component: LivePage,
  });
  app.experimental_icons.register({
    name: "bb-live:voice",
    component: FooterIcon,
  });
  footer = app.experimental_sidebarFooter.register({
    id: "voice",
    kind: "disclosure",
    label: "BB Live voice controls",
    icon: "bb-live:voice",
    component: FooterPanel,
  });
});
