import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { autoUpdate, flip, offset, shift, useFloating, FloatingPortal, size } from '@floating-ui/react';
import { Pencil, Trash2, Copy, X, MapPin, Users, Bell, CalendarDays as CalendarIcon, AlignLeft, Link2, MoreHorizontal, Download, ClipboardCopy, CircleSlash, Eye, EyeOff, Video, MailQuestion } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useT, type MessageKey } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { currentOccurrence, useCalendarMap, getParsedObject, selfEmailsFor } from '@/hooks/useCalendarData';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { eventDataFor } from '@/lib/ical/events';
import type { PartStat } from '@/lib/ical/types';
import { describeAlarm, describeAsWritten, describeRule, splitLinks } from '@/lib/describe';
import { deleteOccurrence, duplicateOccurrence, occurrenceIcs, openEditEvent, respondToOccurrence } from '@/lib/actions';
import { isSameDay } from '@/lib/date';
import { fileNameFrom, saveTextFile } from '@/lib/files';
import { findMeetingLink, type MeetingLink } from '@/lib/meeting';
import { describeMilestone, describeSince, milestoneOf, titleWithYears } from '@/lib/milestone';
import { externalLink } from '@/lib/externalLink';
import { IconButton } from '@/components/ui/Button';
import { IconRow } from '@/components/ui/Controls';
import { Menu } from '@/components/ui/Menu';
import { useBackdropDismiss } from '@/components/ui/backdrop';
import { placedStyle, popIn } from '@/components/ui/floating';
import { EASE_OUT, animatePeriod, prefersReducedMotion } from '@/hooks/usePeriodTransition';
import { VelocityTracker } from '@/hooks/useSwipePager';
import { canDeleteItems, useData } from '@/store/data';
import { eventColor, normalizeItemColor } from '@/lib/color';

export function EventPopover() {
  const popover = useUi((s) => s.popover);
  const close = () => useUi.getState().openPopover(null);
  const mobile = useIsMobile();
  const backdrop = useBackdropDismiss(close);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useSheetDrag(sheet, close);
  // Keep popover in sync with store revisions (e.g. after an edit).
  const revision = useData((s) => s.revision);

  const { refs, floatingStyles, isPositioned } = useFloating({
    open: !!popover,
    placement: 'right-start',
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['left-start', 'bottom', 'top'] }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(240, availableHeight)}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
    // Placed by left/top: the pop-in animation owns `transform` (see floating.ts).
    transform: false,
  });

  useEffect(() => {
    if (!popover) return;
    const a = popover.anchor;
    refs.setPositionReference({
      getBoundingClientRect: () => ({ x: a.x, y: a.y, left: a.x, top: a.y, width: a.width, height: a.height, right: a.x + a.width, bottom: a.y + a.height }),
    });
  }, [popover, refs]);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: PointerEvent) => {
      const el = refs.floating.current;
      const target = e.target as HTMLElement;
      if (el && !el.contains(target) && !target.closest('[data-occ],[role="dialog"],[role="menu"],[role="listbox"]')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [popover, refs.floating]);

  if (!popover) return null;

  if (mobile) {
    return (
      <FloatingPortal>
        <div className="animate-fade fixed inset-0 z-40" style={{ background: 'var(--backdrop)' }} {...backdrop}>
          <div
            ref={sheet}
            role="dialog"
            aria-label={titleWithYears(popover.occurrence)}
            className="animate-slide-up bg-bg-elevated pb-safe absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto rounded-t-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* The handle: pulled down, the sheet goes. */}
            <div data-sheet-handle aria-hidden className="flex h-5 cursor-grab touch-none justify-center pt-2 active:cursor-grabbing" {...drag}>
              <div className="bg-border h-1 w-10 rounded-full" />
            </div>
            <PopoverBody key={revision} onClose={close} />
          </div>
        </div>
      </FloatingPortal>
    );
  }

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={placedStyle(floatingStyles, isPositioned)}
        className={`${popIn(isPositioned)} bg-bg-elevated border-border-weak shadow-elevated text-text z-40 w-[380px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border`}
        role="dialog"
        aria-label={titleWithYears(popover.occurrence)}
      >
        <PopoverBody key={revision} onClose={close} />
      </div>
    </FloatingPortal>
  );
}

/** A sheet pulled down this far, or flicked down this fast (px/ms), closes. */
export const SHEET_CLOSE_PX = 96;
export const SHEET_CLOSE_SPEED = 0.5;

/** Whether a sheet let go after being pulled down `dy` px at `vy` px/ms closes. */
export function sheetCloses(dy: number, vy: number): boolean {
  return dy > SHEET_CLOSE_PX || vy > SHEET_CLOSE_SPEED;
}

/**
 * Pulling the sheet down by its handle: the sheet follows the pointer (not
 * above where it rests), and closes when let go far enough down or with a
 * flick; otherwise it springs back.
 */
function useSheetDrag(sheet: RefObject<HTMLDivElement | null>, close: () => void) {
  const start = useRef<{ id: number; y: number; tracker: VelocityTracker } | null>(null);
  const offset = (e: ReactPointerEvent) => Math.max(0, e.clientY - (start.current?.y ?? e.clientY));
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      start.current = { id: e.pointerId, y: e.clientY, tracker: new VelocityTracker() };
      start.current.tracker.add(e.clientY, e.timeStamp);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (start.current?.id !== e.pointerId || !sheet.current) return;
      start.current.tracker.add(e.clientY, e.timeStamp);
      if (!prefersReducedMotion()) sheet.current.style.transform = `translateY(${offset(e)}px)`;
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = start.current;
      if (s?.id !== e.pointerId) return;
      const dy = offset(e);
      start.current = null;
      const el = sheet.current;
      if (sheetCloses(dy, s.tracker.velocity())) {
        if (el && !prefersReducedMotion()) {
          const out = animatePeriod(el, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(100%)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
          if (out) return void out.finished.then(close, close);
        }
        return close();
      }
      if (!el) return;
      el.style.transform = '';
      if (dy && !prefersReducedMotion()) animatePeriod(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: EASE_OUT });
    },
    onPointerCancel: () => {
      start.current = null;
      if (sheet.current) sheet.current.style.transform = '';
    },
  };
}

const REPLIES: { status: PartStat; label: MessageKey; active: string }[] = [
  { status: 'ACCEPTED', label: 'rsvp.yes', active: 'bg-success/20 border-success' },
  { status: 'TENTATIVE', label: 'rsvp.maybe', active: 'bg-warning/20 border-warning' },
  { status: 'DECLINED', label: 'rsvp.no', active: 'bg-danger/20 border-danger' },
];

function PopoverBody({ onClose }: { onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const opened = useUi((s) => s.popover!.occurrence);
  const revision = useData((s) => s.revision);
  // The event as it is now: a sync may have moved it since the popover opened.
  const occ = useMemo(() => currentOccurrence(opened) ?? opened, [opened, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const calendars = useCalendarMap();
  const calendar = calendars.get(occ.calendarId);
  const toast = useUi((s) => s.toast);

  const data = useMemo(() => {
    const obj = getParsedObject(occ.objectUrl);
    return obj ? eventDataFor(obj, occ) : undefined;
  }, [occ, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // The event disappeared (deleted elsewhere or by a sync): close.
    if (!data) onClose();
  }, [data, onClose]);

  if (!data) return null;
  const color = eventColor(occ.color, calendar?.color);
  const readOnly = calendar?.readOnly;
  const deletable = canDeleteItems(calendar);
  const milestone = milestoneOf(data, occ.start);

  // An invitation can be answered when the user is a guest, not the host.
  const self = selfEmailsFor(occ.calendarId);
  const isSelf = (email?: string) => !!email && self.has(email.toLowerCase());
  const me = data.attendees.find((a) => isSelf(a.email));
  const canReply = !!me && !isSelf(data.organizer?.email) && !readOnly;
  const guests = data.attendees.filter((a) => a.email.toLowerCase() !== data.organizer?.email.toLowerCase());
  const counts = (['ACCEPTED', 'TENTATIVE', 'DECLINED', 'NEEDS-ACTION'] as const)
    .map((s) => ({ s, n: guests.filter((a) => (a.status ?? 'NEEDS-ACTION') === s).length }))
    .filter((c) => c.n > 0);
  const meeting = findMeetingLink(data.location, data.url, data.description);

  const lastDay = new Date(occ.end.getTime() - (occ.allDay ? 1 : 0));
  let when: string;
  if (occ.allDay) {
    when = isSameDay(occ.start, lastDay)
      ? fmt.date(occ.start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : `${fmt.date(occ.start, { day: 'numeric', month: 'short' })} – ${fmt.date(lastDay, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } else if (isSameDay(occ.start, occ.end)) {
    when = `${fmt.date(occ.start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${fmt.timeRange(occ.start, occ.end)}`;
  } else {
    when = `${fmt.date(occ.start, { day: 'numeric', month: 'short' })} ${fmt.time(occ.start)} – ${fmt.date(occ.end, { day: 'numeric', month: 'short' })} ${fmt.time(occ.end)}`;
  }

  const copyDetails = async () => {
    const lines = [data.title, when, data.location, data.description].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      toast(t('event.copied'), 'success');
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const download = async () => {
    const ics = occurrenceIcs(occ);
    if (!ics) return;
    // In the Android app the system's file picker asks where; a failure there is said.
    if ((await saveTextFile(`${fileNameFrom(data.title, 'event')}.ics`, ics, 'text/calendar')) === 'failed') toast(t('files.saveFailed'), 'error');
  };

  return (
    <div className="pb-4">
      <div className="flex items-center justify-end gap-0.5 px-3 pt-3">
        {!readOnly && (
          <IconButton label={t('event.edit')} onClick={() => openEditEvent(occ)}>
            <Pencil size={18} />
          </IconButton>
        )}
        <IconButton label={t('event.duplicate')} onClick={() => void duplicateOccurrence(occ)}>
          <Copy size={18} />
        </IconButton>
        {deletable && (
          <IconButton label={t('event.delete')} onClick={() => void deleteOccurrence(occ)}>
            <Trash2 size={18} />
          </IconButton>
        )}
        <Menu
          trigger={
            <IconButton label={t('common.more')}>
              <MoreHorizontal size={18} />
            </IconButton>
          }
          items={[
            { label: t('event.copyDetails'), icon: <ClipboardCopy size={16} />, onSelect: () => void copyDetails() },
            { label: t('event.download'), icon: <Download size={16} />, onSelect: () => void download() },
          ]}
        />
        <span className="bg-border-weak mx-1.5 h-6 w-px" aria-hidden />
        <IconButton label={t('event.close')} onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>

      {/* Colour bar with the title, the time and the repeat rule beside it. */}
      <div className="flex gap-3.5 px-5 pt-1 pb-4">
        <span className="w-2 shrink-0 rounded-sm" style={me && (me.status ?? 'NEEDS-ACTION') === 'NEEDS-ACTION' ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { background: color }} />
        <div className="min-w-0 py-0.5">
          <h2 className={`text-[1.375rem] leading-snug font-medium break-words ${occ.status === 'CANCELLED' ? 'line-through' : ''}`}>{data.title || t('grid.noTitle')}</h2>
          <div className="mt-0.5 font-semibold">{when}</div>
          {data.hidden && (
            <div className="text-text-weak flex items-center gap-1.5 text-xs">
              <EyeOff size={13} aria-hidden />
              {t('event.hiddenNote')}
            </div>
          )}
          {milestone && data.since && (
            <div>
              <span className="text-primary font-semibold">{describeMilestone(milestone, t, fmt)}</span>
              <span className="text-text-weak"> · {describeSince(milestone.kind, data.since, t, fmt)}</span>
            </div>
          )}
          {!occ.allDay && data.timezone !== 'floating' && data.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
            <div className="text-text-weak text-xs">{data.timezone.replace(/_/g, ' ')}</div>
          )}
          {data.rrule && <div className="text-text-weak">{describeRule(data.rrule, t, fmt)}</div>}
          {!data.rrule && data.ruleAsWritten && (
            <div className="text-text-weak">{describeAsWritten(data.ruleAsWritten, data.start, t, fmt) ?? t('repeat.asWrittenUnknown')}</div>
          )}
          {occ.status === 'CANCELLED' && <span className="text-danger text-xs font-semibold uppercase">{t('event.cancelled')}</span>}
          {occ.status === 'TENTATIVE' && <span className="text-warning text-xs font-semibold uppercase">{t('event.tentative')}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 text-[0.875rem]">
        {meeting && <JoinMeeting meeting={meeting} />}
        {canReply && (
          <IconRow icon={<MailQuestion size={18} />} align="center">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-medium">{t('rsvp.question')}</span>
              <div className="flex gap-1.5">
                {REPLIES.map((r) => {
                  const active = (me.status ?? 'NEEDS-ACTION') === r.status;
                  return (
                    <button
                      key={r.status}
                      type="button"
                      aria-pressed={active}
                      onClick={() => !active && void respondToOccurrence(occ, r.status)}
                      className={`h-8 rounded-lg border px-3.5 text-[0.8125rem] font-semibold transition-colors ${active ? r.active : 'border-border hover:bg-bg-weak'}`}
                    >
                      {t(r.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          </IconRow>
        )}
        {data.location && (
          <IconRow icon={<MapPin size={18} />} align="text">
            {/* An address is a link only where `externalLink` allows it, and never a map search. */}
            {/^https?:\/\//i.test(data.location.trim()) ? (
              <LinkOrText url={data.location} className="text-primary break-all hover:underline" />
            ) : (
              <a
                href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(data.location)}`}
                target="_blank"
                rel="noreferrer"
                className="break-words hover:underline"
              >
                {data.location}
              </a>
            )}
          </IconRow>
        )}
        {(data.attendees.length > 0 || data.organizer) && (
          <IconRow icon={<Users size={18} />} align="text">
            <div className="text-text-weak mb-1.5 text-xs">
              {guests.length} {t('event.participants').toLowerCase()}
              {counts.length > 0 && ` · ${counts.map((c) => `${c.n} ${t(`rsvp.status.${c.s}`).toLowerCase()}`).join(', ')}`}
            </div>
            <ul className="flex flex-col gap-1.5">
              {data.organizer && (
                <li className="flex items-center gap-2">
                  <Avatar name={data.organizer.name ?? data.organizer.email} />
                  <span className="min-w-0 truncate">{data.organizer.name ?? data.organizer.email}</span>
                  <span className="text-text-hint shrink-0 text-xs">{t('event.organizer')}</span>
                </li>
              )}
              {guests.map((a) => (
                <li key={a.email} className="flex items-center gap-2" title={t(`rsvp.status.${a.status ?? 'NEEDS-ACTION'}`)}>
                  <Avatar name={a.name ?? a.email} status={a.status} />
                  <span className="min-w-0 truncate">{a.name ?? a.email}</span>
                  {isSelf(a.email) && <span className="text-text-hint shrink-0 text-xs">{t('event.you')}</span>}
                </li>
              ))}
            </ul>
          </IconRow>
        )}
        <IconRow icon={<CalendarIcon size={18} />} align="text">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: normalizeItemColor(calendar?.color) }} />
            <span className="font-medium">{calendar?.name}</span>
          </span>
          {readOnly && <span className="text-text-weak block text-xs">{t('event.readOnly')}</span>}
        </IconRow>
        {data.alarms.length > 0 && (
          <IconRow icon={<Bell size={18} />} align="text">
            {data.alarms.map((m) => (
              <div key={m}>{describeAlarm(m, data.allDay, t, fmt)}</div>
            ))}
            {data.persistent && <div className="text-text-weak text-xs">{t('editor.persistent')}</div>}
          </IconRow>
        )}
        {/* Only worth a line when it is not what such an event usually is. */}
        {data.busy === data.allDay && (
          <IconRow icon={data.busy ? <CircleSlash size={18} /> : <Eye size={18} />} align="text">
            {data.busy ? t('event.busy') : t('event.free')}
          </IconRow>
        )}
        {data.url && (
          <IconRow icon={<Link2 size={18} />} align="text">
            {/* The URL comes from calendar data: only web links elsewhere become clickable. */}
            <LinkOrText url={data.url} className="text-primary break-all hover:underline" />
          </IconRow>
        )}
        {data.description && (
          <IconRow icon={<AlignLeft size={18} />} align="text">
            <p className="max-h-60 overflow-y-auto break-words whitespace-pre-wrap">
              {splitLinks(data.description).map((part, i) =>
                part.href ? (
                  <a key={i} href={part.href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {part.text}
                  </a>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
          </IconRow>
        )}
      </div>
    </div>
  );
}

/**
 * An address from calendar data: a link when `externalLink` lets it through
 * (a web page elsewhere), otherwise the same text, not clickable.
 */
export function LinkOrText({ url, className }: { url: string; className: string }) {
  const href = externalLink(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {url}
    </a>
  ) : (
    <span className="break-all">{url}</span>
  );
}

/**
 * The way into a video call. A link that is not of a known service says
 * where it goes: the event's author picked that address, and the button
 * alone would vouch for it.
 */
export function JoinMeeting({ meeting }: { meeting: MeetingLink }) {
  const t = useT();
  // `findMeetingLink` only offers what passes; checked here again for any other caller.
  const href = externalLink(meeting.url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="bg-primary text-primary-contrast hover:bg-primary-hover flex min-h-10 flex-col items-center justify-center rounded-lg px-3 py-1.5 font-semibold transition-colors"
    >
      <span className="flex items-center gap-2">
        <Video size={18} />
        {meeting.provider ? t('event.join', { provider: meeting.provider }) : t('event.joinMeeting')}
      </span>
      {meeting.host && <span className="text-xs font-normal break-all">{meeting.host}</span>}
    </a>
  );
}

function Avatar({ name, status }: { name: string; status?: string }) {
  const initials = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const ring = status === 'ACCEPTED' ? 'ring-success' : status === 'DECLINED' ? 'ring-danger' : status === 'TENTATIVE' ? 'ring-warning' : 'ring-transparent';
  return (
    <span className={`bg-primary-weak text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold ring-2 ${ring}`}>
      {initials}
    </span>
  );
}
