import { useEffect, useId } from 'react';
import { Check } from 'lucide-react';
import { useSettings } from '@/store/settings';
import { useT } from '@/i18n';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTextScale } from '@/hooks/useTextScale';
import { THEMES, swatchColor, themeById, type ThemeDef } from '@/theme/themes';
import { FONTS, loadAllFonts, type FontDef } from '@/theme/fonts';
import { DEFAULT_CALENDAR_COLOR, DEFAULT_TASK_COLOR } from '@/lib/color';
import { SYSTEM_TEXT_SCALE_MAX } from '@/lib/display';
import { isNative } from '@/lib/platform';
import { changeSettings } from '@/lib/saveFeedback';
import { TOUCH_MIN_H } from '@/components/ui/touch';
import { SegmentedControl, SettingRow, ToggleRow } from '@/components/ui/Controls';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { chipColors } from '@/components/views/chipColors';

function ThemeCard({ theme, selected, onSelect }: { theme: ThemeDef; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const k = theme.tokens;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex flex-col gap-2 rounded-xl p-1.5 text-left transition-shadow ${selected ? 'ring-primary ring-2' : 'hover:ring-border ring-1 ring-transparent'}`}
    >
      <div className="flex aspect-[16/10] w-full overflow-hidden rounded-lg border" style={{ background: k.frameBg, borderColor: k.frameBorder }}>
        <div className="flex w-[30%] flex-col gap-1.5 p-1.5">
          <div className="h-2.5 rounded" style={{ background: k.primary }} />
          {[0.9, 0.7, 0.8].map((w, i) => (
            <div key={i} className="h-1.5 rounded-full" style={{ width: `${w * 100}%`, background: k.frameTextWeak, opacity: 0.5 }} />
          ))}
        </div>
        <div className="mt-2 flex-1 rounded-tl-md p-1.5" style={{ background: k.bg }}>
          <div className="grid h-full grid-cols-3 gap-1">
            <div className="flex flex-col gap-1">
              <div className="h-4 rounded-sm" style={{ background: DEFAULT_CALENDAR_COLOR }} />
            </div>
            <div className="flex flex-col gap-1 pt-2">
              <div className="h-6 rounded-sm" style={{ background: DEFAULT_TASK_COLOR }} />
            </div>
            <div className="flex flex-col gap-1 pt-1">
              <div className="h-3 rounded-sm" style={{ background: swatchColor('green') }} />
              <div className="h-px" style={{ background: k.nowLine }} />
            </div>
          </div>
        </div>
      </div>
      <span className="flex items-center gap-1.5 px-1 text-[0.8125rem] font-medium">
        {selected && <Check size={14} className="text-primary" />}
        {t(`theme.${theme.id}`)}
      </span>
    </button>
  );
}

function FontCard({ font, selected, onSelect }: { font: FontDef; selected: boolean; onSelect: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ fontFamily: font.stack }}
      className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${TOUCH_MIN_H} ${selected ? 'border-primary bg-primary-weak' : 'border-border-weak hover:border-border'}`}
    >
      <span className="text-xl leading-none font-semibold">Ag</span>
      {/* Two lines rather than a name cut short ("Atkinson Hyperl…"). */}
      <span className="line-clamp-2 min-w-0 flex-1 text-[0.8125rem] leading-snug break-words">{font.id === 'system' ? t('settings.font.system') : font.name}</span>
      {selected && <Check size={14} className="text-primary shrink-0" />}
    </button>
  );
}

/** Sizes chosen by hand, smallest first, each drawn as an "A" of its size. */
const TEXT_SIZES = [
  { value: 0.85, key: 'settings.fontScale.smallest' },
  { value: 0.9, key: 'settings.fontScale.small' },
  { value: 1, key: 'settings.fontScale.normal' },
  { value: 1.1, key: 'settings.fontScale.large' },
  { value: 1.2, key: 'settings.fontScale.largest' },
] as const;

/** The size offered here that is closest to `scale`: what stays on screen when the system's size is no longer followed. */
export function nearestTextSize(scale: number): number {
  return TEXT_SIZES.reduce<number>((best, o) => (Math.abs(o.value - scale) < Math.abs(best - scale) ? o.value : best), 1);
}

/**
 * Text size. On Android the app follows the system's font size by itself
 * (within what its layout takes), or a size chosen here. A browser applies
 * its own default size either way, so there "Normal" is following it.
 */
function TextSizeSetting() {
  const t = useT();
  const id = useId();
  const textSize = useSettings((s) => s.textSize);
  const scale = useTextScale();
  const following = textSize === 'system';
  const value = following ? (isNative ? null : 1) : textSize;
  const options = TEXT_SIZES.map((o, i) => ({
    value: o.value,
    name: t(o.key),
    label: (
      <span aria-hidden className="leading-none font-semibold" style={{ fontSize: `${0.75 + i * 0.0625}rem` }}>
        A
      </span>
    ),
  }));
  return (
    <>
      {isNative && (
        <ToggleRow
          label={t('settings.textSize.system')}
          hint={following ? t('settings.textSize.systemHint', { pct: Math.round(scale * 100), max: Math.round(SYSTEM_TEXT_SCALE_MAX * 100) }) : undefined}
          checked={following}
          onChange={(on) => changeSettings({ textSize: on ? 'system' : nearestTextSize(scale) })}
        />
      )}
      <SettingRow label={t('settings.fontScale')} labelId={id}>
        <SegmentedControl
          full
          labelledBy={id}
          value={value}
          onChange={(size) => changeSettings({ textSize: !isNative && size === 1 ? 'system' : size })}
          options={options}
        />
      </SettingRow>
    </>
  );
}

export function AppearanceSection() {
  const t = useT();
  const s = useSettings();
  const ids = { mode: useId(), style: useId(), shape: useId(), surface: useId(), density: useId() };
  const lightThemes = THEMES.filter((x) => !x.dark);
  const darkThemes = THEMES.filter((x) => x.dark);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const activeTheme = themeById(s.themeMode === 'system' ? (prefersDark ? s.darkTheme : s.lightTheme) : s.theme);
  // The picker shows each family in its own face.
  useEffect(loadAllFonts, []);

  return (
    <>
      <SettingRow label={t('settings.themeMode')} labelId={ids.mode}>
        <SegmentedControl
          full
          labelledBy={ids.mode}
          value={s.themeMode}
          onChange={(themeMode) => changeSettings({ themeMode })}
          options={[
            { value: 'system', label: t('settings.themeMode.system') },
            { value: 'fixed', label: t('settings.themeMode.fixed') },
          ]}
        />
      </SettingRow>
      {s.themeMode === 'fixed' ? (
        <div className="border-border-weak border-b py-3 sm:py-4">
          <div className="mb-3 font-semibold">{t('settings.theme')}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {THEMES.map((th) => (
              <ThemeCard key={th.id} theme={th} selected={themeById(s.theme).id === th.id} onSelect={() => changeSettings({ theme: th.id })} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="border-border-weak border-b py-3 sm:py-4">
            <div className="mb-3 font-semibold">{t('settings.lightTheme')}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {lightThemes.map((th) => (
                <ThemeCard key={th.id} theme={th} selected={themeById(s.lightTheme).id === th.id} onSelect={() => changeSettings({ lightTheme: th.id })} />
              ))}
            </div>
          </div>
          <div className="border-border-weak border-b py-3 sm:py-4">
            <div className="mb-3 font-semibold">{t('settings.darkTheme')}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {darkThemes.map((th) => (
                <ThemeCard key={th.id} theme={th} selected={themeById(s.darkTheme).id === th.id} onSelect={() => changeSettings({ darkTheme: th.id })} />
              ))}
            </div>
          </div>
        </>
      )}
      <div className="border-border-weak border-b py-3 sm:py-4">
        <div className="font-semibold">{t('settings.accent')}</div>
        <p className="text-text-weak mt-0.5 mb-3 text-[0.8125rem] leading-snug">{t('settings.accentHint')}</p>
        <ColorPicker
          value={s.accentColor || undefined}
          onChange={(accentColor) => changeSettings({ accentColor })}
          inherit={{ label: t('settings.accent.theme'), color: activeTheme.tokens.primary, onSelect: () => changeSettings({ accentColor: '' }) }}
        />
      </div>
      <SettingRow label={t('settings.eventStyle')} labelId={ids.style}>
        <div className="flex w-full min-w-0 flex-col items-start gap-3">
          <SegmentedControl
            full
            phoneColumns={2}
            labelledBy={ids.style}
            value={s.eventStyle}
            onChange={(eventStyle) => changeSettings({ eventStyle })}
            options={(['filled', 'tonal', 'soft', 'outline'] as const).map((v) => ({ value: v, label: t(`settings.eventStyle.${v}`) }))}
          />
          <div className="flex flex-wrap gap-2" aria-hidden>
            {[DEFAULT_CALENDAR_COLOR, DEFAULT_TASK_COLOR, swatchColor('gold')].map((c, i) => {
              const { style, subClass } = chipColors(c, s.eventStyle);
              return (
                <div key={c} className="w-24 rounded-md px-2 py-1 text-[0.75rem] leading-tight sm:w-28" style={style}>
                  <div className="font-semibold">{['Standup', 'Lunch', 'Gym'][i]}</div>
                  <div className={subClass}>{['09:00', '12:30', '18:00'][i]}</div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingRow>
      <SettingRow label={t('settings.shape')} hint={t('settings.shapeHint')} labelId={ids.shape}>
        <SegmentedControl
          full
          labelledBy={ids.shape}
          value={s.shape}
          onChange={(shape) => changeSettings({ shape })}
          options={(['sharp', 'rounded', 'round'] as const).map((v) => ({ value: v, label: t(`settings.shape.${v}`) }))}
        />
      </SettingRow>
      <SettingRow label={t('settings.surface')} hint={t('settings.surfaceHint')} labelId={ids.surface}>
        <SegmentedControl
          full
          labelledBy={ids.surface}
          value={s.surface}
          onChange={(surface) => changeSettings({ surface })}
          options={(['panel', 'card'] as const).map((v) => ({ value: v, label: t(`settings.surface.${v}`) }))}
        />
      </SettingRow>
      <SettingRow label={t('settings.density')} labelId={ids.density}>
        <SegmentedControl
          full
          labelledBy={ids.density}
          value={s.density}
          onChange={(density) => changeSettings({ density })}
          options={[
            { value: 'comfortable', label: t('settings.density.comfortable') },
            { value: 'compact', label: t('settings.density.compact') },
          ]}
        />
      </SettingRow>
      <div className="border-border-weak border-b py-3 sm:py-4">
        <div className="font-semibold">{t('settings.font')}</div>
        <p className="text-text-weak mt-0.5 mb-3 text-[0.8125rem] leading-snug">{t('settings.fontHint')}</p>
        {(['bundled', 'device'] as const).map((group) => (
          <div key={group} className="mb-3 last:mb-0">
            <div className="text-text-hint mb-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase">{t(`settings.font.${group}`)}</div>
            {/* Two columns on a phone too: a name that does not fit takes a second line. */}
            <div data-font-grid className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {FONTS.filter((f) => f.group === group).map((f) => (
                <FontCard key={f.id} font={f} selected={s.fontFamily === f.id} onSelect={() => changeSettings({ fontFamily: f.id })} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <TextSizeSetting />
    </>
  );
}
