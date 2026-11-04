import { useRef, type KeyboardEvent } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import type { ViewType } from '@/store/settings';
import { useUi } from '@/store/ui';

/** The phone's views, in the bar's order. The "N days" view is chosen in Settings (default view). */
export const PHONE_VIEWS: ViewType[] = ['agenda', 'day', 'week', 'month', 'year'];

/**
 * The bar of views under the calendar on phones: one tap to another view,
 * within reach of the thumb, each named in full. It is part of the page's
 * column (the calendar above it gets shorter), not floating over it; the
 * new-event button sits above it (Fab). Tablets and computers pick the view
 * in the header instead.
 */
export function ViewBar() {
  const t = useT();
  const mobile = useIsMobile();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!mobile) return null;

  // One stop for Tab; the arrows move between the views (the usual way of a tab list).
  const focusable = PHONE_VIEWS.includes(view) ? view : PHONE_VIEWS[0];
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? PHONE_VIEWS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const index = (next + PHONE_VIEWS.length) % PHONE_VIEWS.length;
    setView(PHONE_VIEWS[index]);
    tabs.current[index]?.focus();
  };

  return (
    <nav className="bg-frame border-frame-border pb-safe shrink-0 border-t px-1.5">
      <div role="tablist" aria-label={t('nav.view')} className="grid h-14 grid-cols-5 items-center">
        {PHONE_VIEWS.map((v, i) => {
          const selected = v === view;
          return (
            <button
              key={v}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={v === focusable ? 0 : -1}
              onClick={() => setView(v)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`mx-0.5 h-10 min-w-0 truncate rounded-xl px-1 text-[0.8125rem] transition-colors ${
                selected ? 'bg-primary-weak text-frame-text font-semibold' : 'text-frame-weak hover:bg-frame-hover font-medium'
              }`}
            >
              {t(`view.${v}`)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
