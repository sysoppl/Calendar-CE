import type { CSSProperties, ReactNode } from 'react';
import { Check, Repeat } from 'lucide-react';
import { DEFAULT_TASK_COLOR, calendarColor, readableText } from '@/lib/color';
import type { PartStat } from '@/lib/ical/types';
import type { EventStyle } from '@/store/settings';
import { chipColors, type ChipState } from './chipColors';

/**
 * A title that does not fit is cut at the chip's edge and fades out over its
 * last 4 px, instead of ending in an ellipsis: on a phone, where chips are a
 * few letters wide, the ellipsis would take the place of two of them.
 */
export const CLIP_FADE = 'min-w-0 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-4px),transparent)]';
/** The fade alone, for a title over several lines. */
const FADE = '[mask-image:linear-gradient(to_right,#000_calc(100%-4px),transparent)]';

/** Line height of a timed chip's title, in px at the normal text size. */
const TITLE_LINE = 15;

interface TimedChipProps extends ChipState {
  title: string;
  time: string;
  location?: string;
  color: string;
  eventStyle: EventStyle;
  heightPx: number;
  recurring?: boolean;
  selected?: boolean;
  dragging?: boolean;
  /**
   * A phone's narrow columns: the title takes as many lines as the chip has
   * room for (or is cut with a fade on one line), and the time shows only
   * where there is room for it.
   */
  phone?: boolean;
}

export function TimedChipContent({ title, time, location, color, eventStyle, heightPx, past, tentative, cancelled, reply, recurring, selected, dragging, phone = false }: TimedChipProps) {
  const { style, textClass, subClass } = chipColors(color, eventStyle, { past: past && !dragging, tentative, cancelled, reply });
  const compact = heightPx < 38;
  // On a phone a long title wraps instead: its lines are worth more there than the time below it.
  const lines = phone && !compact ? Math.max(1, Math.floor((heightPx - 8) / TITLE_LINE)) : 1;
  const clamp: CSSProperties | undefined = lines > 1 ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' } : undefined;
  // Lines break between words only: a word wider than the column is cut at its edge, with the fade.
  const titleClass = lines > 1 ? `shrink-0 ${FADE}` : phone ? CLIP_FADE : 'truncate';
  return (
    <div
      className={`@container flex h-full w-full overflow-hidden rounded-md text-left leading-tight transition-shadow ${phone ? 'px-1' : 'px-1.5'} ${compact ? 'items-center gap-1.5 py-0' : 'flex-col py-1'} ${
        selected || dragging ? 'ring-bg-elevated shadow-elevated ring-2' : ''
      }`}
      style={style}
    >
      <span className={`text-[0.75rem] font-semibold ${titleClass} ${textClass} ${compact ? `min-w-0 ${phone ? 'flex-1' : 'shrink'}` : ''}`} style={clamp}>
        {title}
      </span>
      <span className={`truncate text-[0.6875rem] ${subClass} ${compact ? 'hidden shrink-0 @[9rem]:inline' : phone ? 'hidden @[4rem]:block' : ''}`}>
        {time}
        {recurring && !compact && <Repeat size={10} className="ml-1 inline-block align-[-1px]" />}
      </span>
      {!compact && heightPx > 64 && location && <span className={`truncate text-[0.6875rem] ${subClass}`}>{location}</span>}
    </div>
  );
}

/** Bar used for all-day / multi-day events in month rows and the all-day strip. */
export function BarChip({
  title,
  color,
  eventStyle,
  continuesBefore,
  continuesAfter,
  prefix,
  dense = false,
  ...state
}: ChipState & {
  title: ReactNode;
  color: string;
  eventStyle: EventStyle;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  prefix?: ReactNode;
  /**
   * The phone's chip: 11 px text of medium weight, tighter padding and
   * corners, and a title cut with a fade rather than an ellipsis, so that
   * six or seven letters fit in a day of a month on a 360 px screen.
   */
  dense?: boolean;
}) {
  const { style, textClass } = chipColors(color, eventStyle, state);
  const left = continuesBefore ? 'rounded-l-none' : dense ? 'rounded-l-sm' : 'rounded-l-md';
  const right = continuesAfter ? 'rounded-r-none' : dense ? 'rounded-r-sm' : 'rounded-r-md';
  return (
    <div
      className={`flex h-full items-center overflow-hidden ${
        dense ? 'gap-0.5 pr-px pl-1 text-[0.6875rem] leading-tight font-medium tracking-[-0.01em]' : 'gap-1 px-1.5 text-[0.75rem] font-semibold'
      } ${left} ${right}`}
      style={style}
    >
      {prefix}
      <span className={`${dense ? `${CLIP_FADE} flex-1` : 'truncate'} ${textClass}`}>{title}</span>
    </div>
  );
}

/** Marker of an event's colour; a ring while an invitation is unanswered or declined. */
export function EventDot({ color, reply, className = '' }: { color: string; reply?: PartStat; className?: string }) {
  const hollow = reply === 'NEEDS-ACTION' || reply === 'DECLINED';
  const c = calendarColor(color);
  return <span className={`shrink-0 rounded-full ${className}`} style={hollow ? { boxShadow: `inset 0 0 0 1.5px ${c}` } : { background: c }} />;
}

/**
 * Single-line timed event in month view: coloured dot, time, title. A past or
 * declined one has its text in the weaker colour rather than faded out, so the
 * text keeps its contrast.
 */
export function DotChip({ title, time, color, past, cancelled, reply }: ChipState & { title: string; time: string; color: string }) {
  const declined = reply === 'DECLINED';
  const dim = past || declined;
  return (
    <div className="hover:bg-bg-weak flex h-full items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-[0.75rem]">
      <EventDot color={color} reply={reply} className="h-2 w-2" />
      <span className={`shrink-0 tabular-nums ${dim ? 'text-text-hint' : 'text-text-weak'}`}>{time}</span>
      <span className={`truncate font-medium ${dim ? 'text-text-weak' : ''} ${cancelled || declined ? 'line-through' : ''}`}>{title}</span>
    </div>
  );
}

/**
 * Task chip with a checkbox, shown at the due date. `dense` is the phone's:
 * the checkbox, far too small for a finger there, becomes a ring that only
 * marks a task (the chip opens the task, where it can be ticked off), and the
 * title is cut with a fade like an event's.
 */
export function TaskChip({
  title,
  color,
  completed,
  onToggle,
  time,
  dense = false,
}: {
  title: string;
  color: string;
  completed: boolean;
  onToggle: () => void;
  time?: string;
  dense?: boolean;
}) {
  const c = calendarColor(color, DEFAULT_TASK_COLOR);
  if (dense) {
    return (
      <div
        className={`bg-bg border-border-weak flex h-full items-center gap-1 overflow-hidden rounded-sm border pr-px pl-1 text-[0.6875rem] leading-tight font-medium tracking-[-0.01em] ${completed ? 'opacity-60' : ''}`}
      >
        <span data-task-ring aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ boxShadow: `inset 0 0 0 1.5px ${c}`, background: completed ? c : 'transparent' }} />
        <span className={`${CLIP_FADE} flex-1 ${completed ? 'line-through' : ''}`}>{title}</span>
      </div>
    );
  }
  return (
    <div
      className={`bg-bg border-border-weak flex h-full items-center gap-1.5 overflow-hidden rounded-md border px-1.5 text-[0.75rem] ${completed ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={completed}
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px]"
        style={{ borderColor: c, background: completed ? c : 'transparent' }}
      >
        {completed && <Check size={9} strokeWidth={4} color={readableText(c)} />}
      </button>
      {time && <span className="text-text-weak shrink-0 tabular-nums">{time}</span>}
      <span className={`truncate font-medium ${completed ? 'line-through' : ''}`}>{title}</span>
    </div>
  );
}
