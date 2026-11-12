import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronUp } from 'lucide-react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import { changeSettings } from '@/lib/saveFeedback';
import { CUSTOM_DAY_COUNTS, useSettings, type ViewType } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Menu } from '@/components/ui/Menu';

/**
 * The phone's views, in the bar's order. "N days" (as long as the setting
 * `customDays` says) sits between Day and Week; a tap on its tab while it is
 * selected opens the choice of how many days.
 */
export const PHONE_VIEWS: ViewType[] = ['agenda', 'day', 'days', 'week', 'month', 'year'];

/**
 * The views whose tabs the bar shows, in its order: Agenda and "N days" only
 * while their settings (`viewBarAgenda`, `viewBarDays`) are on, so four, five
 * or six tabs. Only the bar changes; a hidden view can still be on screen.
 */
export function barViews(agenda: boolean, days: boolean): ViewType[] {
  return PHONE_VIEWS.filter((v) => (v === 'agenda' ? agenda : v === 'days' ? days : true));
}

/**
 * A tab's text, as wide as it is in bold whether it is bold or not (an unseen
 * bold copy drawn by CSS, so not part of its text), so that the tabs keep
 * their places when another one is selected.
 */
function Label({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span
      data-label={text}
      className={`${className} flex min-w-0 flex-col after:invisible after:h-0 after:overflow-hidden after:font-semibold after:whitespace-nowrap after:content-[attr(data-label)]`}
    >
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * The bar of views under the calendar on phones: one tap to another view,
 * within reach of the thumb, each named in full. It is part of the page's
 * column (the calendar above it gets shorter), not floating over it; the
 * new-event button sits above it (Fab). Tablets and computers pick the view
 * in the header instead.
 *
 * Its tabs (six, or fewer where Settings › General hides Agenda or
 * "N days") share the width by their names' lengths (each as wide as its
 * name plus an equal share of what is left), so that the longest names fit a
 * 320 px screen in every language; below 360 px the text is a little
 * smaller. When the view on screen has no tab here (a hidden one, as the
 * default view or from a shortcut), no tab is selected and the first one
 * takes the Tab key. The "N days" tab, once selected, shows a small caret:
 * another tap opens a menu above it with 2 to 7 days, which changes the same
 * setting as Settings › General › Custom view length.
 */
export function ViewBar() {
  const t = useT();
  const mobile = useIsMobile();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const customDays = useSettings((s) => s.customDays);
  const showAgenda = useSettings((s) => s.viewBarAgenda);
  const showDays = useSettings((s) => s.viewBarDays);
  const [choosing, setChoosing] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const views = barViews(showAgenda, showDays);
  // Another view (a swipe, the back button, a shortcut) closes the menu for good, not only while it lasts; so does hiding its tab.
  if (choosing && (view !== 'days' || !showDays)) setChoosing(false);
  if (!mobile) return null;

  // One stop for Tab; the arrows move between the tabs shown (the usual way of a tab list).
  const focusable = views.includes(view) ? view : views[0];
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? views.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const index = (next + views.length) % views.length;
    setChoosing(false);
    setView(views[index]);
    tabs.current[index]?.focus();
  };

  return (
    <nav className="bg-frame border-frame-border pb-safe shrink-0 border-t px-1.5">
      <div role="tablist" aria-label={t('nav.view')} className="flex h-14 items-center">
        {views.map((v, i) => {
          const selected = v === view;
          const days = v === 'days';
          const tab = (
            <button
              key={v}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={v === focusable ? 0 : -1}
              onClick={() => (days && selected ? setChoosing((open) => !open) : setView(v))}
              onKeyDown={(e) => onKeyDown(e, i)}
              data-view={v}
              className={`flex h-10 min-w-0 flex-[1_1_auto] items-center justify-center rounded-xl px-1 text-xs whitespace-nowrap transition-colors min-[360px]:text-[0.8125rem] ${
                selected ? 'bg-primary-weak text-frame-text font-semibold' : 'text-frame-weak hover:bg-frame-hover font-medium'
              }`}
            >
              {/* The caret always takes its place, so the tab keeps its width; unseen, half of it is made up on the left so the name stays centred. */}
              <Label text={t(`view.${v}`, { n: customDays })} className={days && !selected ? 'translate-x-1' : ''} />
              {days && <ChevronUp aria-hidden size={12} strokeWidth={2.5} className={`-mr-1 shrink-0 ${selected ? '' : 'invisible'}`} />}
            </button>
          );
          if (!days) return tab;
          return (
            <Menu
              key={v}
              trigger={tab}
              placement="top"
              minWidth={152}
              choice
              label={t('nav.dayCount')}
              disabled={!selected}
              open={choosing && selected}
              onOpenChange={setChoosing}
              items={CUSTOM_DAY_COUNTS.map((n) => ({
                label: t('view.days', { n }),
                checked: n === customDays,
                onSelect: () => changeSettings({ customDays: n }),
              }))}
            />
          );
        })}
      </div>
    </nav>
  );
}
