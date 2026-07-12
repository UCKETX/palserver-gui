import { FiChevronDown } from "react-icons/fi";
import type { InstanceStatus } from "@palserver/shared";
import { STATUS_LABELS } from "./labels";
import { t, useI18n } from "./i18n";

export const btn =
  "rounded-full bg-pal px-5 py-2 text-sm font-extrabold text-white transition " +
  "hover:-translate-y-px hover:bg-pal-strong active:translate-y-0 active:scale-95 " +
  "disabled:pointer-events-none disabled:opacity-50";
export const btnGhost =
  "rounded-full border-2 border-line bg-card-soft px-5 py-2 text-sm font-extrabold text-ink " +
  "transition hover:-translate-y-px hover:border-pal active:translate-y-0 active:scale-95 " +
  "disabled:pointer-events-none disabled:opacity-50";
export const btnDanger = btnGhost + " text-berry hover:border-berry";
/** 粉色主按鈕:贊助 / 捐款用(Buy Me a Coffee、贊助我們)。 */
export const btnSponsor =
  "rounded-full bg-sponsor px-5 py-2 text-sm font-extrabold text-white transition " +
  "hover:-translate-y-px hover:brightness-95 active:translate-y-0 active:scale-95 " +
  "disabled:pointer-events-none disabled:opacity-50";
export const card = "rounded-(--radius-cute) border-2 border-line bg-card p-5 shadow-(--shadow-cute)";
export const inputCls =
  "rounded-xl border-2 border-line bg-card-soft px-3 py-2 text-sm text-ink outline-none " +
  "transition focus:border-pal";
export const labelCls = "flex flex-col gap-1.5 text-left text-[13px] font-bold text-ink-muted";
export const errorCls = "rounded-xl bg-berry/10 px-3 py-2 text-[13px] font-bold text-berry";

/** 下拉選單:隱藏各瀏覽器不一致的原生箭頭,改用自繪 chevron(和語言切換一致)。 */
export function Select({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className="relative inline-flex w-full">
      <select
        className={`${inputCls} w-full cursor-pointer appearance-none pr-10 ${className}`}
        value={value}
        onChange={onChange}
      >
        {children}
      </select>
      <FiChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted" />
    </span>
  );
}

const STATUS_CLS: Record<InstanceStatus, string> = {
  running: "border-grass/40 bg-grass/15 text-grass",
  installing: "border-sun/40 bg-sun/15 text-sun",
  restarting: "border-sun/40 bg-sun/15 text-sun",
  starting: "border-pal/40 bg-pal/15 text-pal",
  exited: "border-berry/35 bg-berry/10 text-berry",
  missing: "border-berry/35 bg-berry/10 text-berry",
  created: "border-line bg-card-soft text-ink-muted",
};

export function StatusBadge({ status }: { status: InstanceStatus }) {
  useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold ${STATUS_CLS[status]}`}
    >
      <span className="size-2 rounded-full bg-current" />
      {t(STATUS_LABELS[status])}
    </span>
  );
}

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(35_32_48/0.55)] p-6 backdrop-blur-[3px]"
      onClick={onClose}
    >
      {children}
    </div>
  );
}
