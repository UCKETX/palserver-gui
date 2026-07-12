import { useEffect, useMemo, useState } from "react";
import { FiFileText } from "react-icons/fi";
import type { FileHealth } from "@palserver/shared";
import {
  OPTION_CATEGORIES,
  WORLD_OPTIONS,
  optionKeysByCategory,
  type OptionCategory,
  type WorldOptionKey,
  type WorldOptionValue,
  type WorldSettings,
} from "@palserver/shared";
import type { AgentClient } from "./api";
import { FileEditor } from "./FileManager";
import { ConfigCorruptModal } from "./ConfigCorruptModal";
import { ConfigBackupPanel } from "./ConfigBackupPanel";
import { CATEGORY_LABELS, ENUM_LABELS, OPTION_LABELS } from "./labels";
import { t, useI18n } from "./i18n";
import { btn, btnGhost, errorCls, inputCls } from "./ui";

/** Where the native driver renders the ini, relative to the server dir. */
const INI_PATHS = [
  "Pal/Saved/Config/WindowsServer/PalWorldSettings.ini",
  "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini",
];

/** Schema-driven world-settings editor. Renders every option in
 * WORLD_OPTIONS by its metadata; no per-option UI code. */
export function SettingsEditor({
  settings,
  saving,
  onSave,
  client,
  instanceId,
  canEditRaw,
  running,
  restoreAllowed,
}: {
  settings: WorldSettings;
  saving: boolean;
  onSave: (patch: Partial<WorldSettings>) => Promise<void>;
  client: AgentClient;
  instanceId: string;
  canEditRaw: boolean;
  running: boolean;
  restoreAllowed: boolean;
}) {
  useI18n();
  const [category, setCategory] = useState<OptionCategory>("server");
  const [draft, setDraft] = useState<Partial<WorldSettings>>({});
  const [error, setError] = useState<string | null>(null);
  const [rawPath, setRawPath] = useState<string | null>(null);
  const [corrupt, setCorrupt] = useState<FileHealth | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!canEditRaw) return;
    client
      .configHealth(instanceId)
      .then((h) => setCorrupt(h.world.corrupted ? h.world : null))
      .catch(() => setCorrupt(null));
  }, [client, instanceId, canEditRaw]);

  const dirtyKeys = useMemo(
    () =>
      (Object.keys(draft) as WorldOptionKey[]).filter(
        (k) => draft[k] !== undefined && draft[k] !== settings[k],
      ),
    [draft, settings],
  );

  const valueOf = (key: WorldOptionKey): WorldOptionValue =>
    draft[key] !== undefined ? draft[key]! : settings[key];

  const setValue = (key: WorldOptionKey, value: WorldOptionValue) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setError(null);
    const patch = Object.fromEntries(dirtyKeys.map((k) => [k, draft[k]]));
    try {
      await onSave(patch);
      setDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** The ini lives under the platform dir of whichever OS the agent runs on;
   * try Windows first and fall back to Linux. */
  const openRaw = async () => {
    setError(null);
    for (const candidate of INI_PATHS) {
      try {
        await client.readFile(instanceId, candidate);
        setRawPath(candidate);
        return;
      } catch {
        /* try next */
      }
    }
    setError(t("找不到 PalWorldSettings.ini — 先啟動一次伺服器讓它生成設定檔"));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {OPTION_CATEGORIES.map((c) => (
            <button
              key={c}
              className={
                c === category
                  ? "rounded-full bg-pal px-4 py-1.5 text-[13px] font-extrabold text-white"
                  : "rounded-full border-2 border-line bg-card-soft px-4 py-1.5 text-[13px] font-extrabold text-ink-muted transition hover:border-pal"
              }
              onClick={() => setCategory(c)}
            >
              {t(CATEGORY_LABELS[c])}
            </button>
          ))}
        </div>
        {canEditRaw && (
          <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={openRaw}>
            <FiFileText className="size-4" /> {t("編輯原始檔")}
          </button>
        )}
      </div>

      <div className="flex flex-col divide-y divide-line">
        {optionKeysByCategory(category).map((key) => (
          <OptionRow key={key} optionKey={key} value={valueOf(key)} onChange={(v) => setValue(key, v)} />
        ))}
      </div>

      {error && <p className={errorCls}>{error}</p>}
      {dirtyKeys.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-(--radius-cute) border-2 border-sun/50 bg-card p-3 shadow-(--shadow-cute)">
          <span className="text-[13px] font-bold text-ink-muted">
            {t("小心~您有 {n} 項變更尚未儲存!(重啟伺服器後生效)", { n: dirtyKeys.length })}
          </span>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => setDraft({})} disabled={saving}>
              {t("重置")}
            </button>
            <button className={btn} onClick={save} disabled={saving}>
              {saving ? t("儲存中…") : t("確定修改")}
            </button>
          </div>
        </div>
      )}

      {rawPath && (
        <FileEditor
          client={client}
          instanceId={instanceId}
          path={rawPath}
          onClose={() => setRawPath(null)}
        />
      )}

      {corrupt && !dismissed && (
        <ConfigCorruptModal
          client={client}
          instanceId={instanceId}
          file="world"
          health={corrupt}
          running={running}
          onResolved={() => setDismissed(true)}
        />
      )}

      <ConfigBackupPanel client={client} instanceId={instanceId} restoreAllowed={restoreAllowed} />
    </div>
  );
}

function OptionRow({
  optionKey,
  value,
  onChange,
}: {
  optionKey: WorldOptionKey;
  value: WorldOptionValue;
  onChange: (v: WorldOptionValue) => void;
}) {
  useI18n();
  const meta = WORLD_OPTIONS[optionKey];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-52">
        <p className="text-sm font-bold">{t(OPTION_LABELS[optionKey])}</p>
        <p className="text-xs text-ink-muted">{optionKey}</p>
      </div>
      <div className="flex items-center gap-3">
        {meta.type === "bool" && (
          <Toggle checked={Boolean(value)} onChange={(v) => onChange(v)} />
        )}
        {(meta.type === "float" || meta.type === "int") && (
          <>
            <input
              type="number"
              className={`${inputCls} w-24 text-right`}
              value={String(value)}
              min={meta.min}
              max={meta.max}
              step={meta.type === "float" ? meta.step : 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n)) onChange(meta.type === "int" ? Math.trunc(n) : n);
              }}
            />
            <input
              type="range"
              className="w-40 accent-(--color-pal) sm:w-56"
              value={Number(value)}
              min={meta.min}
              max={meta.max}
              step={meta.type === "float" ? meta.step : 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange(meta.type === "int" ? Math.trunc(n) : n);
              }}
            />
          </>
        )}
        {meta.type === "enum" && (
          <select
            className={`${inputCls} min-w-36`}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          >
            {meta.choices.map((c) => (
              <option key={c} value={c}>
                {t(ENUM_LABELS[c] ?? c)}
              </option>
            ))}
          </select>
        )}
        {meta.type === "string" && (
          <input
            type={"secret" in meta && meta.secret ? "password" : "text"}
            className={`${inputCls} w-56`}
            value={String(value)}
            maxLength={meta.maxLength}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition ${checked ? "bg-grass" : "bg-line"}`}
    >
      <span
        className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  );
}
