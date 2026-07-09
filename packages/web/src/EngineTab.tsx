import { useCallback, useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiFileText, FiZap } from "react-icons/fi";
import {
  ENGINE_CATEGORY_LABELS,
  ENGINE_OPTIONS,
  ENGINE_PRESETS,
  type EngineOptionKey,
  type EngineOptionMeta,
  type EngineSettings,
  type EngineSettingsStatus,
} from "@palserver/shared";
import type { AgentClient } from "./api";
import { FileEditor } from "./FileManager";
import { btn, btnGhost, card, errorCls, inputCls } from "./ui";

const KEYS = Object.keys(ENGINE_OPTIONS) as EngineOptionKey[];

/** Effective value: what the server will use, i.e. the file value or the
 * engine default when the key is absent. */
const effective = (values: EngineSettings, key: EngineOptionKey) =>
  values[key] ?? ENGINE_OPTIONS[key].default;

export function EngineTab({ client, instanceId }: { client: AgentClient; instanceId: string }) {
  const [status, setStatus] = useState<EngineSettingsStatus | null>(null);
  const [draft, setDraft] = useState<EngineSettings>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingRaw, setEditingRaw] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await client.engineSettings(instanceId);
      setStatus(next);
      setDraft(Object.fromEntries(KEYS.map((k) => [k, effective(next.values, k)])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, instanceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dirtyKeys = useMemo(() => {
    if (!status) return [];
    return KEYS.filter((k) => draft[k] !== effective(status.values, k));
  }, [draft, status]);

  if (!status) return <p className="text-ink-muted">{error ?? "載入中…"}</p>;

  if (!status.supported) {
    return (
      <div className="rounded-(--radius-cute) border-2 border-dashed border-line px-6 py-12 text-center text-ink-muted">
        <FiZap className="mx-auto mb-2 size-11" />
        <p className="mt-1 text-[13px]">{status.reason}</p>
      </div>
    );
  }

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const save = async (values: EngineSettings = draft) => {
    setSaving(true);
    setError(null);
    try {
      await client.updateEngineSettings(instanceId, values);
      flash("已儲存,重啟伺服器後生效");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (key: keyof typeof ENGINE_PRESETS) => {
    const preset = ENGINE_PRESETS[key];
    if (!confirm(`套用「${preset.label}」?\n\n${preset.description}\n\n會覆蓋下方欄位,儲存後才寫入檔案。`)) return;
    setDraft({ ...draft, ...preset.values });
  };

  const grouped = new Map<string, EngineOptionKey[]>();
  for (const key of KEYS) {
    const label = ENGINE_CATEGORY_LABELS[ENGINE_OPTIONS[key].category];
    grouped.set(label, [...(grouped.get(label) ?? []), key]);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className={errorCls}>{error}</p>}
      {notice && (
        <p className="rounded-xl bg-grass/10 px-3 py-2 text-[13px] font-bold text-grass">{notice}</p>
      )}

      <div className={`${card} flex flex-col gap-3`}>
        <h3 className="inline-flex items-center gap-2 text-sm font-extrabold">
          <FiZap className="size-4 text-pal" /> 效能預設組合
        </h3>
        <p className="text-[13px] text-ink-muted">
          這些設定寫入伺服器的 <code className="rounded bg-card-soft px-1.5 py-0.5 text-xs">Engine.ini</code>
          。沒有萬用解 —— 提高 Tick 率吃 CPU,人數與據點越多越吃力。改完請觀察「玩家」分頁的伺服器 FPS。
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ENGINE_PRESETS) as (keyof typeof ENGINE_PRESETS)[]).map((key) => (
            <button key={key} className={btnGhost} onClick={() => applyPreset(key)} title={ENGINE_PRESETS[key].description}>
              {ENGINE_PRESETS[key].label}
            </button>
          ))}
          {status.path && (
            <button
              className={`${btnGhost} inline-flex items-center gap-1.5`}
              onClick={() => setEditingRaw(true)}
              disabled={!status.exists}
              title={status.exists ? "直接編輯 Engine.ini" : "檔案尚未產生"}
            >
              <FiFileText className="size-4" /> 編輯原始檔
            </button>
          )}
        </div>
        {!status.exists && <p className="text-[13px] text-sun">{status.reason}</p>}
      </div>

      {[...grouped.entries()].map(([category, keys]) => (
        <div key={category} className={card}>
          <h3 className="mb-1 text-sm font-extrabold text-ink-muted">{category}</h3>
          <div className="flex flex-col divide-y divide-line">
            {keys.map((key) => (
              <OptionRow
                key={key}
                optionKey={key}
                value={draft[key] ?? ENGINE_OPTIONS[key].default}
                fileValue={status.values[key]}
                onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              />
            ))}
          </div>
        </div>
      ))}

      {dirtyKeys.length > 0 && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-cute) border-2 border-sun/50 bg-card p-3 shadow-(--shadow-cute)">
          <span className="text-[13px] font-bold text-ink-muted">
            小心~您有 {dirtyKeys.length} 項變更尚未儲存!(重啟伺服器後生效)
          </span>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => void refresh()} disabled={saving}>
              重置
            </button>
            <button className={btn} onClick={() => save()} disabled={saving}>
              {saving ? "儲存中…" : "確定修改"}
            </button>
          </div>
        </div>
      )}

      {editingRaw && status.path && (
        <FileEditor
          client={client}
          instanceId={instanceId}
          path={status.path}
          onClose={() => setEditingRaw(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function OptionRow({
  optionKey,
  value,
  fileValue,
  onChange,
}: {
  optionKey: EngineOptionKey;
  value: number | boolean;
  fileValue: number | boolean | undefined;
  onChange: (value: number | boolean) => void;
}) {
  // `as const satisfies` narrows each entry to its literal shape, so read it
  // back through the common interface to reach optional fields.
  const meta: EngineOptionMeta = ENGINE_OPTIONS[optionKey];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-64 flex-1">
        <p className="text-sm font-bold">
          {meta.label}
          {fileValue === undefined && (
            <span className="ml-2 text-xs font-normal text-ink-muted">(未設定,使用引擎預設)</span>
          )}
        </p>
        <p className="font-mono text-xs text-ink-muted">{optionKey}</p>
        {meta.hint && <p className="mt-1 max-w-xl text-xs text-ink-muted">{meta.hint}</p>}
        {meta.warn && (
          <p className="mt-1 inline-flex max-w-xl items-start gap-1.5 text-xs text-sun">
            <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {meta.warn}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {meta.type === "bool" ? (
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            aria-label={meta.label}
            onClick={() => onChange(!value)}
            className={`relative h-7 w-12 rounded-full transition ${value ? "bg-grass" : "bg-line"}`}
          >
            <span
              className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${value ? "left-6" : "left-1"}`}
            />
          </button>
        ) : (
          <>
            <input
              type="number"
              className={`${inputCls} w-28 text-right`}
              value={String(value)}
              min={meta.min}
              max={meta.max}
              step={meta.type === "float" ? (meta.step ?? 0.1) : 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n)) onChange(meta.type === "int" ? Math.trunc(n) : n);
              }}
            />
            {meta.min !== undefined && meta.max !== undefined && (
              <input
                type="range"
                className="w-36 accent-(--color-pal) sm:w-48"
                value={Number(value)}
                min={meta.min}
                max={meta.max}
                step={meta.type === "float" ? (meta.step ?? 0.1) : 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange(meta.type === "int" ? Math.trunc(n) : n);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
