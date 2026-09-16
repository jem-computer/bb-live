import { useEffect, useRef, useState } from "react";
import {
  useRpc,
  experimental_ProviderModelPicker as ProviderModelPicker,
  type ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { DEFAULT_VOICE_PROMPT, DEFAULT_OPENING } from "./policy";
import {
  type Preferences,
  sampledVoices,
  voiceNotes,
  voices,
} from "./preferences";

const intentModels = [
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
];
const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);
export function LiveSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [defaults, setDefaults] =
    useState<ExperimentalProviderModelPickerValue | null>(null);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [openingDraft, setOpeningDraft] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    let alive = true;
    void rpc
      .call("preferences")
      .then((value) => {
        if (alive) {
          setPrefs(value);
          setModelDraft(value.routerModel);
          setPromptDraft(value.voicePrompt);
          setOpeningDraft(value.opening);
        }
      })
      .catch(() => {
        if (alive)
          setError("Settings couldn’t load. Reopen this page to retry.");
      });
    void rpc
      .call("operatorDefaults")
      .then((value) => {
        if (alive) setDefaults(value);
      })
      .catch(() => {
        if (alive)
          setCatalogError(
            "The model catalog is unavailable. Reopen this page to retry.",
          );
      });
    return () => {
      alive = false;
      audio.current?.pause();
    };
  }, [rpc]);
  useEffect(() => {
    const player = audio.current;
    player?.pause();
    setPlaying(false);
    setAudioError("");
  }, [prefs?.voice]);
  async function save(patch: Partial<Preferences>) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const value = await rpc.call("savePreferences", patch);
      setPrefs(value);
      setModelDraft(value.routerModel);
      setSaved(true);
    } catch {
      setError("Couldn’t save that change. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function preview() {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) {
      player.pause();
      setPlaying(false);
      return;
    }
    setAudioError("");
    player.currentTime = 0;
    try {
      await player.play();
    } catch {
      setAudioError("Sample couldn’t play. Try again.");
    }
  }
  if (!prefs)
    return (
      <div className="bl bl-preferences" role="status">
        {error || "Loading settings…"}
      </div>
    );
  const sample = sampledVoices.has(prefs.voice);
  const operatorValue: ExperimentalProviderModelPickerValue | null =
    prefs.operatorProvider
      ? {
          providerId: prefs.operatorProvider,
          model: prefs.operatorModel,
          reasoningLevel:
            prefs.operatorReasoningLevel === "default"
              ? "medium"
              : prefs.operatorReasoningLevel,
          serviceTier: prefs.operatorServiceTier,
        }
      : defaults;
  return (
    <div className="bl bl-preferences">
      <fieldset disabled={saving}>
        <div className="bl-pref-row">
          <div>
            <label htmlFor="bl-voice">Voice</label>
            <p>Applies to your next voice session.</p>
          </div>
          <div className="bl-pref-controls">
            <div className="bl-voice-controls">
              <select
                id="bl-voice"
                value={prefs.voice}
                onChange={(e) => void save({ voice: e.target.value })}
              >
                {!voices.includes(prefs.voice as (typeof voices)[number]) && (
                  <option value={prefs.voice}>{prefs.voice}</option>
                )}
                {voices.map((voice) => (
                  <option key={voice} value={voice}>
                    {titleCase(voice)}
                    {voiceNotes[voice] ? ` · ${voiceNotes[voice]}` : ""}
                    {sampledVoices.has(voice) ? " · ♪" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="bl-preview"
                onClick={() => void preview()}
                disabled={!sample}
                aria-label={
                  playing ? "Stop voice sample" : `Preview ${prefs.voice} voice`
                }
                title={
                  sample
                    ? "Play OpenAI speech sample"
                    : "No published sample for this voice"
                }
              >
                {playing ? "■ Stop" : "▶ Preview"}
              </button>
            </div>
            <small>
              {sample
                ? "OpenAI speech sample · Live delivery may vary."
                : "No published sample for this voice. Voices marked ♪ have previews."}
            </small>
            <audio
              ref={audio}
              src={
                sample
                  ? `https://cdn.openai.com/API/docs/audio/${prefs.voice}.wav`
                  : undefined
              }
              preload="none"
              onPlaying={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => {
                setPlaying(false);
                setAudioError("Sample couldn’t load. Try again.");
              }}
            />
            {audioError && <p role="alert">{audioError}</p>}
          </div>
        </div>
        <form
          className="bl-pref-row"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ voicePrompt: promptDraft, opening: openingDraft });
          }}
        >
          <div>
            <label htmlFor="bl-prompt">Voice prompt</label>
            <p>How Live speaks and helps you. Applies to your next session.</p>
          </div>
          <div className="bl-pref-controls">
            <textarea
              id="bl-prompt"
              value={promptDraft}
              rows={8}
              maxLength={8000}
              required
              onChange={(e) => setPromptDraft(e.target.value)}
            />
            <label htmlFor="bl-opening">Opening words</label>
            <textarea
              id="bl-opening"
              value={openingDraft}
              rows={2}
              maxLength={1000}
              placeholder="Wait for me to speak"
              onChange={(e) => setOpeningDraft(e.target.value)}
            />
            <small>Leave blank to wait for you to speak.</small>
            <div className="bl-prompt-actions">
              <button
                type="submit"
                disabled={
                  !promptDraft.trim() ||
                  (promptDraft === prefs.voicePrompt &&
                    openingDraft === prefs.opening)
                }
              >
                Save prompt
              </button>
              <button
                type="button"
                onClick={() => {
                  setPromptDraft(DEFAULT_VOICE_PROMPT);
                  setOpeningDraft(DEFAULT_OPENING);
                  setSaved(false);
                }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </form>
        <div className="bl-pref-row">
          <div>
            <label htmlFor="bl-progress">Spoken progress</label>
            <p>How often Live speaks up while agents work.</p>
          </div>
          <select
            id="bl-progress"
            value={prefs.spokenProgress}
            onChange={(e) =>
              void save({
                spokenProgress: e.target.value as Preferences["spokenProgress"],
              })
            }
          >
            <option value="quiet">Quiet</option>
            <option value="important">Important updates</option>
            <option value="verbose">All updates</option>
          </select>
        </div>
        <div className="bl-pref-row">
          <div>
            <label htmlFor="bl-operator-defaults">Operator</label>
            <p>
              Defaults for newly created Operators. Change your current Operator
              in its thread.
            </p>
          </div>
          <div className="bl-pref-controls">
            <label className="bl-pref-check">
              <input
                id="bl-operator-defaults"
                type="checkbox"
                checked={!prefs.operatorProvider}
                disabled={!operatorValue}
                onChange={(e) =>
                  void (e.target.checked
                    ? save({
                        operatorProvider: "",
                        operatorModel: "",
                        operatorReasoningLevel: "default",
                        operatorServiceTier: "default",
                      })
                    : operatorValue &&
                      save({
                        operatorProvider: operatorValue.providerId,
                        operatorModel: operatorValue.model,
                        operatorReasoningLevel: operatorValue.reasoningLevel,
                        operatorServiceTier:
                          operatorValue.serviceTier ?? "default",
                      }))
                }
              />
              Use BB defaults
            </label>
            {prefs.operatorProvider && operatorValue && (
              <ProviderModelPicker
                value={operatorValue}
                disabled={saving}
                onChange={(value) =>
                  void save({
                    operatorProvider: value.providerId,
                    operatorModel: value.model,
                    operatorReasoningLevel: value.reasoningLevel,
                    operatorServiceTier: value.serviceTier ?? "default",
                  })
                }
                align="end"
                className="bl-model-picker"
              />
            )}
            {catalogError && !prefs.operatorProvider && (
              <small role="status">{catalogError}</small>
            )}
          </div>
        </div>
        <div className="bl-pref-row">
          <div>
            <label htmlFor="bl-retention">Keep transcripts</label>
            <p>Shorter retention removes older saved transcript text.</p>
          </div>
          <select
            id="bl-retention"
            value={prefs.transcriptRetentionDays}
            onChange={(e) =>
              void save({ transcriptRetentionDays: Number(e.target.value) })
            }
          >
            {[0, 7, 30, 90, 365].includes(
              prefs.transcriptRetentionDays,
            ) ? null : (
              <option value={prefs.transcriptRetentionDays}>
                {prefs.transcriptRetentionDays} days
              </option>
            )}
            <option value={0}>Don’t save transcripts</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
        <details className="bl-pref-advanced">
          <summary>Advanced</summary>
          <div className="bl-pref-row">
            <div>
              <label htmlFor="bl-intent">Intent model</label>
              <p>Routes spoken requests through the OpenAI API.</p>
            </div>
            <div className="bl-pref-controls">
              <select
                id="bl-intent"
                value={
                  customModel || !intentModels.includes(prefs.routerModel)
                    ? "custom"
                    : prefs.routerModel
                }
                onChange={(e) => {
                  const custom = e.target.value === "custom";
                  setCustomModel(custom);
                  if (!custom) void save({ routerModel: e.target.value });
                }}
              >
                {intentModels.map((model) => (
                  <option key={model}>{model}</option>
                ))}
                <option value="custom">Custom model…</option>
              </select>
              {(customModel || !intentModels.includes(prefs.routerModel)) && (
                <form
                  className="bl-custom-model"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (modelDraft.trim())
                      void save({ routerModel: modelDraft.trim() });
                  }}
                >
                  <input
                    aria-label="Custom intent model"
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    maxLength={200}
                    required
                  />
                  <button type="submit">Save</button>
                </form>
              )}
            </div>
          </div>
        </details>
      </fieldset>
      <div className="bl-pref-status" role={error ? "alert" : "status"}>
        {error || (saving ? "Saving…" : saved ? "Saved" : "")}
      </div>
    </div>
  );
}
