import type { CSSProperties } from 'react';
import { swatchColor as color } from '@/theme/themes';

/** Day (0–4), start and length as parts of the visible hours, and the calendar's colour. */
const EVENTS: { day: number; start: number; length: number; color: string }[] = [
  { day: 0, start: 0.08, length: 0.16, color: color('red') },
  { day: 0, start: 0.46, length: 0.22, color: color('blue') },
  { day: 1, start: 0.2, length: 0.12, color: color('sky') },
  { day: 1, start: 0.58, length: 0.26, color: color('red') },
  { day: 2, start: 0.04, length: 0.3, color: color('gold') },
  { day: 2, start: 0.52, length: 0.14, color: color('green') },
  { day: 3, start: 0.28, length: 0.2, color: color('red') },
  { day: 3, start: 0.7, length: 0.16, color: color('blue') },
  { day: 4, start: 0.12, length: 0.18, color: color('sky') },
  { day: 4, start: 0.42, length: 0.34, color: color('magenta') },
];
const TODAY = 2;
const NOW = 0.4;

/** An event block drawn the way the default event style draws it: a tint of its colour with a bar on the left. */
function block(c: string): CSSProperties {
  return { background: `color-mix(in srgb, ${c} 20%, var(--bg))`, boxShadow: `inset 2px 0 0 ${c}` };
}

/**
 * A small drawing of the week view in the colours of the theme in use, next
 * to the welcome screen's title on wide screens. Made of the theme's tokens
 * rather than a picture, so it follows every theme and costs no download.
 */
export function WeekPreview({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`border-frame-border bg-frame shadow-elevated flex aspect-[16/10] flex-col overflow-hidden rounded-xl border ${className}`}>
      <div className="flex h-7 shrink-0 items-center gap-2 px-3">
        <span className="bg-primary h-3 w-3 rounded-[4px]" />
        <span className="bg-frame-text h-1.5 w-14 rounded-full opacity-60" />
        <span className="ml-auto flex gap-1.5">
          <span className="bg-frame-text h-1.5 w-8 rounded-full opacity-25" />
          <span className="bg-frame-text h-1.5 w-5 rounded-full opacity-25" />
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[18%] shrink-0 flex-col gap-2 px-3 pt-1.5">
          <span className="bg-primary h-4 w-full rounded-md opacity-90" />
          <span className="grid grid-cols-5 gap-[3px] pt-1">
            {Array.from({ length: 20 }, (_, i) => (
              <span key={i} className={`aspect-square rounded-full ${i === 7 ? 'bg-primary' : 'bg-frame-text opacity-20'}`} />
            ))}
          </span>
          {[color('red'), color('blue'), color('sky')].map((c) => (
            <span key={c} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: c }} />
              <span className="bg-frame-text h-1 flex-1 rounded-full opacity-30" />
            </span>
          ))}
        </div>
        <div className="bg-bg border-border-weak flex min-w-0 flex-1 flex-col rounded-tl-lg border-t border-l">
          <div className="border-border-weak grid h-6 shrink-0 grid-cols-5 border-b">
            {Array.from({ length: 5 }, (_, day) => (
              <span key={day} className="flex items-center justify-center">
                <span className={`h-1.5 w-6 rounded-full ${day === TODAY ? 'bg-primary' : 'bg-text opacity-25'}`} />
              </span>
            ))}
          </div>
          <div className="relative grid min-h-0 flex-1 grid-cols-5">
            {Array.from({ length: 5 }, (_, day) => (
              <div key={day} className="border-border-weak relative border-l first:border-l-0">
                {[0.25, 0.5, 0.75].map((y) => (
                  <span key={y} className="border-border-weak absolute inset-x-0 border-t" style={{ top: `${y * 100}%` }} />
                ))}
                {EVENTS.filter((e) => e.day === day).map((e) => (
                  <span
                    key={e.start}
                    className="absolute inset-x-[6%] flex flex-col gap-[3px] rounded-[4px] px-1.5 pt-1"
                    style={{ ...block(e.color), top: `${e.start * 100}%`, height: `${e.length * 100}%` }}
                  >
                    <span className="h-1 w-3/4 rounded-full opacity-60" style={{ background: e.color }} />
                    {e.length > 0.15 && <span className="h-1 w-1/2 rounded-full opacity-30" style={{ background: e.color }} />}
                  </span>
                ))}
                {day === TODAY && (
                  <span className="bg-now absolute inset-x-0 h-[2px]" style={{ top: `${NOW * 100}%` }}>
                    <span className="bg-now absolute -top-[3px] -left-[4px] h-2 w-2 rounded-full" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
