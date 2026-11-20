"use client";

import { useId, useRef, useState } from "react";

import { ChevronIcon, CodeIcon, WaveIcon } from "../icons";
import { cx } from "../lib/cx";
import { Avatar, Caret } from "../primitives/misc";
import { Chip } from "../primitives/Pill";
import { useKitStrings } from "../strings";
import type { FunctionCall, Turn, TurnChip } from "./types";

/**
 * The pieces of the session panel's log. They're styled for violet: use them inside
 * VoiceSessionPanel (or another violet surface), in an <ol>.
 */

/** A turn's time as h:mm:ss, without AM or PM: the log is short and the hour is never in doubt */
export function clockTime(iso: string | undefined, locale?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", second: "2-digit" })
    .formatToParts(date)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}

export type TurnBubbleProps = {
  turn: Turn;
  /** The caller's avatar text: their initials, or YOU */
  you?: string;
  locale?: string;
  /** A chip under an answer was pressed: light that part of the screen (useFocus().pointAt) */
  onChip?: (chip: TurnChip) => void;
  /** Short names for function rows, by real name: { search_orders: "orders.search" } */
  shortNames?: Record<string, string>;
};

/** One item in the log: a caller bubble (right, white), an agent bubble (left, glass), or a function call. */
export function TurnBubble({ turn, you, locale, onChip, shortNames }: TurnBubbleProps) {
  const s = useKitStrings();
  if (turn.role === "tool") {
    return turn.call ? <FunctionCallRow call={turn.call} shortNames={shortNames} /> : null;
  }
  if (turn.role === "user") {
    const live = turn.final === false;
    return (
      <li className="flex flex-col items-end">
        <span className="label mr-12 mb-1.5 text-[0.65rem] text-white/80">
          {live ? (
            <>
              <span className="mr-1" aria-hidden="true">
                ●
              </span>{" "}
              {s.you} · {s.speaking}
            </>
          ) : (
            <>
              {s.you}
              {turn.at && ` · ${clockTime(turn.at, locale)}`}
            </>
          )}
        </span>
        <div className="flex items-end gap-2.5">
          <p
            className={cx(
              "max-w-[17rem] rounded-2xl px-4 py-3 text-[1.05rem] leading-snug",
              live ? "border border-dashed border-white/70 text-white" : "bg-white text-ink",
            )}
          >
            {turn.text}
            {live && <Caret />}
          </p>
          <Avatar text={you ?? s.you.toUpperCase()} />
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-col">
      <span className="label mb-1.5 ml-12 text-[0.65rem] text-white/80">
        {s.assistant}
        {turn.at && ` · ${clockTime(turn.at, locale)}`}
      </span>
      <div className="flex items-start gap-2.5">
        <span className="mt-auto grid size-9 shrink-0 place-items-center rounded-full border border-white/40 text-white">
          <WaveIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="max-w-[17rem] rounded-2xl border border-white/30 bg-white/12 px-4 py-3 text-[1.05rem] leading-snug text-white">
            {turn.text}
            {turn.pending && <span className="opacity-55">{turn.pending}</span>}
          </p>
          {!!turn.chips?.length && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {turn.chips.map((chip) => (
                <li key={chip.id}>
                  <Chip pointer onClick={onChip ? () => onChip(chip) : undefined}>
                    {chip.label}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

// The arguments that usually say what a call is about, most telling first. Any *_id comes after
// "id" (claim_id, order_id, case_id), then the free-text ones.
const MAIN_ARGUMENT = [/^id$/, /_id$/, /^(question|query|q|search)$/, /^(name|voice|language)$/];

function argumentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.join(", ");
  return "";
}

/** "orders.search(Where is my order…)": the short name and the argument that says what the call is about */
export function callSummary(call: FunctionCall, shortNames: Record<string, string> = {}): string {
  const args = call.args ?? {};
  const keys = Object.keys(args).filter((k) => argumentText(args[k]));
  const key = MAIN_ARGUMENT.map((pattern) => keys.find((k) => pattern.test(k))).find(Boolean) ?? keys[0];
  return `${shortNames[call.name] ?? call.name}(${key ? argumentText(args[key]) : ""})`;
}

function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function JsonValue({ value }: { value: unknown }) {
  const color = typeof value === "string" ? "text-lime" : typeof value === "number" ? "text-yellow" : "text-orange";
  return <span className={color}>{JSON.stringify(value)}</span>;
}

/**
 * A function call in the log: one mono line with its timing; press it for the full request as
 * syntax-colored JSON. Results stay hidden: the agent's answer says what it found.
 */
export function FunctionCallRow({ call, shortNames }: { call: FunctionCall; shortNames?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const bodyId = useId();
  const s = useKitStrings();

  const running = call.status !== "completed";
  const status = call.cancelled ? s.cancelled : running ? s.running : call.ms !== undefined ? duration(call.ms) : s.done;
  const entries: [string, unknown][] = [
    ["function", call.name],
    ...Object.entries(call.args ?? {}),
    ...(call.ms !== undefined ? ([["latency_ms", call.ms]] as [string, unknown][]) : []),
  ];

  const toggle = () => {
    setOpen(!open);
    if (!open) requestAnimationFrame(() => row.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  return (
    <li ref={row}>
      <div
        className={cx(
          "@container overflow-hidden rounded-2xl transition-colors",
          open ? "bg-ink" : "border border-white/30 bg-white/15 hover:bg-white/20",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={s.callLabel(call.name, status, open)}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
        >
          <CodeIcon className={cx("size-4 shrink-0", open ? "text-ring-blue" : "text-white")} />
          <span className="label hidden shrink-0 text-[0.65rem] text-white @sm:inline">{s.functionCall}</span>
          <span
            title={`${call.name}(${JSON.stringify(call.args ?? {})})`}
            className={cx("min-w-0 flex-1 truncate font-mono text-[0.85rem]", open ? "text-lime" : "text-white")}
          >
            {callSummary(call, shortNames)}
          </span>
          <span className={cx("shrink-0 font-mono text-[0.8rem] text-yellow", running && "animate-caret")}>{status}</span>
          <ChevronIcon up={open} className="size-4 shrink-0 text-white" />
        </button>
        {open && (
          <pre id={bodyId} className="overflow-x-auto border-t border-white/10 px-4 py-3 font-mono text-[0.8rem] leading-relaxed text-white">
            {entries.map(([key, value], i) => (
              <span key={key} className="block">
                <span className="text-ring-blue">&quot;{key}&quot;</span>
                <span className="text-white/50">: </span>
                <JsonValue value={value} />
                {i < entries.length - 1 && <span className="text-white/50">,</span>}
              </span>
            ))}
          </pre>
        )}
      </div>
    </li>
  );
}
