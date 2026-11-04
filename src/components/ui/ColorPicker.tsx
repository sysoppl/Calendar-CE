import { Check, Pipette } from 'lucide-react';
import { CALENDAR_COLORS, isSwatch } from '@/theme/themes';
import { DEFAULT_CALENDAR_COLOR, isHexColor, mixHex, normalizeItemColor, readableText } from '@/lib/color';
import { useT } from '@/i18n';
import { TOUCH_HIT } from './touch';

/**
 * The swatch grid: eight to a row. With a mouse each swatch is 32 px; on a
 * touch screen the grid takes the width there is (up to 44 px a column) and
 * each column is one target the full height of a finger, with a 36 px swatch
 * drawn in it. Columns shrink with the room, so the grid fits a 328 px phone
 * column and a narrow popover alike.
 */
export const SWATCH_GRID = 'grid w-full max-w-76 grid-cols-8 pointer-coarse:max-w-88';
/** One cell of the grid: the target. */
export const SWATCH_CELL = 'group flex h-9 items-center justify-center rounded-full focus-visible:outline-none pointer-coarse:h-11';
/** The colour drawn in a cell: never wider than the cell, less a gap. */
export const SWATCH_DOT =
  'flex aspect-square w-[min(2rem,calc(100%-0.25rem))] items-center justify-center rounded-full transition-transform group-hover:scale-110 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary motion-reduce:transition-none pointer-coarse:w-[min(2.25rem,calc(100%-0.25rem))]';

/**
 * The calendar colours, one palette, plus a colour of one's own below them.
 * A colour that is not a swatch (a calendar's colour from before, or from a
 * server) shows as the custom one. With `inherit`, a first option clears the
 * colour (an event then uses its calendar's).
 */
export function ColorPicker({
  value,
  onChange,
  inherit,
}: {
  value?: string;
  onChange: (color: string) => void;
  inherit?: { label: string; color?: string; onSelect: () => void };
}) {
  const t = useT();
  const current = value?.toLowerCase();
  const custom = current && !isSwatch(current) && isHexColor(current) ? current : undefined;

  return (
    <div className="flex flex-col gap-2.5">
      {inherit && (
        <button
          type="button"
          aria-pressed={!value}
          onClick={inherit.onSelect}
          className={`${TOUCH_HIT} flex h-7 w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${!value ? 'border-primary text-primary' : 'border-border text-text-weak hover:border-text-hint'}`}
        >
          <span className="h-3 w-3 rounded-full" style={{ background: normalizeItemColor(inherit.color) }} />
          {inherit.label}
        </button>
      )}
      <div className={SWATCH_GRID}>
        {CALENDAR_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={t(`color.${c.id}`)}
            aria-label={t(`color.${c.id}`)}
            aria-pressed={current === c.value}
            onClick={() => onChange(c.value)}
            className={SWATCH_CELL}
          >
            <span className={SWATCH_DOT} style={{ background: c.value }}>
              {current === c.value && <Check size={15} strokeWidth={3} color={readableText(c.value)} />}
            </span>
          </button>
        ))}
      </div>
      <label className="group relative flex w-fit cursor-pointer items-center gap-2.5 rounded-full pr-2 text-[0.8125rem] pointer-coarse:min-h-11" title={t('color.custom')}>
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full pointer-coarse:size-9 ${custom ? '' : 'border-border text-text-weak group-hover:border-text-hint border border-dashed'} group-has-[:focus-visible]:outline-primary group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-offset-2`}
          style={custom ? { background: custom } : undefined}
        >
          {custom ? <Check size={15} strokeWidth={3} color={readableText(custom)} /> : <Pipette size={14} />}
        </span>
        <span className={custom ? 'font-medium' : 'text-text-weak'}>{t('color.custom')}</span>
        {custom && <span className="text-text-weak font-mono text-xs uppercase">{custom}</span>}
        <input
          type="color"
          aria-label={t('color.custom')}
          // The field takes #rrggbb only, not the short #rgb.
          value={custom ? mixHex(custom, custom, 0) : DEFAULT_CALENDAR_COLOR}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
