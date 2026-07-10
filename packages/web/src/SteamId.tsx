import { useState } from "react";
import { FiCheck, FiCopy, FiEye, FiEyeOff } from "react-icons/fi";
import { copyText } from "./clipboard";

/**
 * Steam IDs identify a real person, so every surface that shows one masks it
 * by default — enough to tell players apart, not enough to paste into a
 * lookup site or leak in a screenshot. Reveal + copy are per-occurrence.
 */
export function maskSteamId(userId: string): string {
  const digits = userId.replace(/^steam_/, "");
  if (digits.length <= 8) return digits;
  return `${digits.slice(0, 4)}${"•".repeat(6)}${digits.slice(-4)}`;
}

/** Mask any steam-id-looking token inside an arbitrary string (e.g. a command
 * preview or a log line) for display, leaving the rest intact. Matches an
 * explicit `steam_…` id, a `platform_…` id, or a bare 15-20 digit run
 * (Steam64 is 17), so short numbers like day counts or ports are untouched. */
export function maskSteamIdsInText(text: string): string {
  return text.replace(/(?:steam_\d+|[a-z]+_\d{8,}|\d{15,20})/gi, (m) => maskSteamId(m));
}

export function SteamId({ userId }: { userId: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const raw = userId.replace(/^steam_/, "");

  const copy = async () => {
    if (await copyText(raw)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-muted">
      {revealed ? raw : maskSteamId(userId)}
      <button
        onClick={() => setRevealed((v) => !v)}
        className="text-ink-muted transition hover:text-pal"
        aria-label={revealed ? "隱藏 Steam ID" : "顯示 Steam ID"}
        title={revealed ? "隱藏" : "顯示完整 Steam ID"}
      >
        {revealed ? <FiEyeOff className="size-3.5" /> : <FiEye className="size-3.5" />}
      </button>
      <button
        onClick={copy}
        className="text-ink-muted transition hover:text-pal"
        aria-label="複製 Steam ID"
        title="複製"
      >
        {copied ? <FiCheck className="size-3.5 text-grass" /> : <FiCopy className="size-3.5" />}
      </button>
    </span>
  );
}
