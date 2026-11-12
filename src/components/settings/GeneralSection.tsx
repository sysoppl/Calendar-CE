import { useId, useMemo } from 'react';
import { CUSTOM_DAY_COUNTS, useSettings, VIEWS, type FabAction, type ViewType } from '@/store/settings';
import { LANGS, LANGUAGE_NAMES, languageChoice, useT, type Lang } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { describeAlarm } from '@/lib/describe';
import { localTimezone } from '@/lib/ical/timezone';
import { changeSettings, resetSettings } from '@/lib/saveFeedback';
import { Button } from '@/components/ui/Button';
import { SegmentedControl, SettingGroup, SettingRow, ToggleRow } from '@/components/ui/Controls';
import { SELECT, SELECT_INLINE } from './styles';

function allTimezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return [localTimezone(), 'UTC'];
  }
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

export function GeneralSection() {
  const t = useT();
  const fmt = useFormat();
  const s = useSettings();
  const weekStartId = useId();
  const timezones = useMemo(allTimezones, []);
  const mobile = useIsMobile();
  const alarmOptions = [0, 5, 10, 15, 30, 60, 1440];
  const allDayOptions = [-540, -480, 900, 1440];

  return (
    <>
      <SettingGroup title={t('settings.group.format')}>
        {/* Long values ("System default", "24-hour (13:00)"): a whole-width select under the label on a phone. */}
        <SettingRow label={t('settings.language')} htmlFor="set-lang">
          <select
            id="set-lang"
            className={SELECT}
            value={s.deviceLanguage || s.language}
            onChange={(e) => void languageChoice(e.target.value as 'auto' | Lang).then(changeSettings)}
          >
            <option value="auto">{t('settings.language.auto')}</option>
            {LANGS.map((l) => (
              <option key={l} value={l} lang={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('settings.weekStart')} labelId={weekStartId}>
          <SegmentedControl
            full
            labelledBy={weekStartId}
            value={s.weekStartsOn}
            onChange={(weekStartsOn) => changeSettings({ weekStartsOn })}
            options={([1, 0, 6] as const).map((d) => ({ value: d, label: cap(fmt.date(new Date(2023, 0, 1 + d), { weekday: 'long' })) }))}
          />
        </SettingRow>
        <SettingRow label={t('settings.timeFormat')} htmlFor="set-time">
          <select id="set-time" className={SELECT} value={s.timeFormat} onChange={(e) => changeSettings({ timeFormat: e.target.value as typeof s.timeFormat })}>
            <option value="auto">{t('settings.timeFormat.auto')}</option>
            <option value="24h">{t('settings.timeFormat.24h')}</option>
            <option value="12h">{t('settings.timeFormat.12h')}</option>
          </select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('settings.group.view')}>
        <SettingRow inline label={t('settings.defaultView')} htmlFor="set-view">
          <select id="set-view" className={SELECT_INLINE} value={s.defaultView} onChange={(e) => changeSettings({ defaultView: e.target.value as ViewType })}>
            {VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {t(`view.${v.id}`, { n: s.customDays })}
              </option>
            ))}
          </select>
        </SettingRow>
        {/* Where the bar of views is (phones and narrow windows) and has its "N days" tab, that tab changes the length too. */}
        <SettingRow
          inline
          label={t('settings.customDays')}
          hint={t(mobile && s.viewBarDays ? 'settings.customDaysHintPhone' : 'settings.customDaysHint')}
          htmlFor="set-days"
        >
          <select id="set-days" className={SELECT_INLINE} value={s.customDays} onChange={(e) => changeSettings({ customDays: Number(e.target.value) })}>
            {CUSTOM_DAY_COUNTS.map((n) => (
              <option key={n} value={n}>
                {t('view.days', { n })}
              </option>
            ))}
          </select>
        </SettingRow>
        {/* Only where the bar of views is: phones and narrow windows. A hidden view stays in Default view above. */}
        {mobile && (
          <>
            <ToggleRow
              label={t('settings.viewBarAgenda')}
              hint={t('settings.viewBarAgendaHint')}
              checked={s.viewBarAgenda}
              onChange={(viewBarAgenda) => changeSettings({ viewBarAgenda })}
            />
            <ToggleRow
              label={t('settings.viewBarDays')}
              hint={t('settings.viewBarDaysHint')}
              checked={s.viewBarDays}
              onChange={(viewBarDays) => changeSettings({ viewBarDays })}
            />
          </>
        )}
        <ToggleRow label={t('settings.weekNumbers')} checked={s.showWeekNumbers} onChange={(showWeekNumbers) => changeSettings({ showWeekNumbers })} />
        <ToggleRow label={t('settings.weekends')} checked={s.showWeekends} onChange={(showWeekends) => changeSettings({ showWeekends })} />
        <ToggleRow label={t('settings.dimPast')} checked={s.dimPastEvents} onChange={(dimPastEvents) => changeSettings({ dimPastEvents })} />
        <ToggleRow
          label={t('settings.showDeclined')}
          hint={t('settings.showDeclinedHint')}
          checked={s.showDeclinedEvents}
          onChange={(showDeclinedEvents) => changeSettings({ showDeclinedEvents })}
        />
        <ToggleRow label={t('settings.secondaryTz')} checked={s.showSecondaryTimezone} onChange={(showSecondaryTimezone) => changeSettings({ showSecondaryTimezone })} />
        {s.showSecondaryTimezone && (
          <SettingRow label={t('settings.secondaryTzZone')} htmlFor="set-tz">
            <select id="set-tz" className={SELECT} value={s.secondaryTimezone} onChange={(e) => changeSettings({ secondaryTimezone: e.target.value })}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </SettingRow>
        )}
        <SettingRow inline label={t('settings.dayStart')} htmlFor="set-daystart">
          <select id="set-daystart" className={SELECT_INLINE} value={s.dayStartHour} onChange={(e) => changeSettings({ dayStartHour: Number(e.target.value) })}>
            {Array.from({ length: 13 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>
                {fmt.hourLabel(h)}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('settings.group.newEvents')}>
        {/* Only where the round + button is: phones and narrow windows. */}
        {mobile && (
          <SettingRow label={t('settings.fab')} hint={t('settings.fab.hint')} htmlFor="set-fab">
            <select id="set-fab" className={SELECT} value={s.fabAction} onChange={(e) => changeSettings({ fabAction: e.target.value as FabAction })}>
              <option value="event">{t('sidebar.newEvent')}</option>
              <option value="task">{t('sidebar.newTask')}</option>
              <option value="choose">{t('settings.fab.choose')}</option>
            </select>
          </SettingRow>
        )}
        <SettingRow inline label={t('settings.defaultDuration')} htmlFor="set-dur">
          <select id="set-dur" className={SELECT_INLINE} value={s.defaultEventDuration} onChange={(e) => changeSettings({ defaultEventDuration: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {t('settings.minutes', { n: m })}
              </option>
            ))}
          </select>
        </SettingRow>
        {/* A pair, drawn alike: their long labels and values take the whole width. */}
        <SettingRow label={t('settings.defaultAlarms')} htmlFor="set-alarm">
          <select
            id="set-alarm"
            className={SELECT}
            value={s.defaultAlarms[0] ?? ''}
            onChange={(e) => changeSettings({ defaultAlarms: e.target.value === '' ? [] : [Number(e.target.value)] })}
          >
            <option value="">{t('settings.none')}</option>
            {alarmOptions.map((m) => (
              <option key={m} value={m}>
                {describeAlarm(m, false, t, fmt)}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('settings.defaultAllDayAlarms')} htmlFor="set-alarm-ad">
          <select
            id="set-alarm-ad"
            className={SELECT}
            value={s.defaultAllDayAlarms[0] ?? ''}
            onChange={(e) => changeSettings({ defaultAllDayAlarms: e.target.value === '' ? [] : [Number(e.target.value)] })}
          >
            <option value="">{t('settings.none')}</option>
            {allDayOptions.map((m) => (
              <option key={m} value={m}>
                {describeAlarm(m, true, t, fmt)}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingGroup>
      <div className="pt-6">
        <Button variant="outline" onClick={resetSettings}>
          {t('settings.resetSettings')}
        </Button>
      </div>
    </>
  );
}
