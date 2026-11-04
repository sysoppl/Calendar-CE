import { useMemo, useState } from 'react';
import { useUi } from '@/store/ui';
import { useData } from '@/store/data';
import { countryName, localName, useLang, useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { HOLIDAY_COUNTRIES, holidaysIn } from '@/lib/holidays';
import { DEFAULT_HOLIDAY_COLOR } from '@/lib/color';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Controls';
import { ColorPicker } from '@/components/ui/ColorPicker';

export function HolidaysDialog() {
  const open = useUi((s) => s.holidaysDialog);
  if (!open) return null;
  return <HolidaysForm />;
}

/** Country suggested from the browser's region ("pl-PL" -> PL). */
function guessCountry(): string {
  const regions = (typeof navigator !== 'undefined' ? navigator.languages : []).map((l) => l.split('-')[1]?.toUpperCase());
  return HOLIDAY_COUNTRIES.find((c) => regions.includes(c.code))?.code ?? HOLIDAY_COUNTRIES[0].code;
}

function HolidaysForm() {
  const t = useT();
  const lang = useLang();
  const fmt = useFormat();
  const close = () => useUi.getState().openHolidaysDialog(false);
  const added = useData((s) => s.calendars);
  const countries = useMemo(() => [...HOLIDAY_COUNTRIES].sort((a, b) => countryName(a, lang).localeCompare(countryName(b, lang), lang)), [lang]);
  const [country, setCountry] = useState(guessCountry);
  const [color, setColor] = useState(DEFAULT_HOLIDAY_COLOR);
  const exists = added.some((c) => c.holidayCountry === country);

  // What is coming up, so the choice can be checked before adding.
  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = today.getFullYear();
    return [...holidaysIn(country, year), ...holidaysIn(country, year + 1)].filter((h) => h.date >= today).slice(0, 4);
  }, [country]);

  const submit = () => {
    if (exists) return;
    const name = countryName(HOLIDAY_COUNTRIES.find((c) => c.code === country)!, lang);
    useData.getState().addHolidayCalendar({ country, name: t('holidays.calendarName', { country: name }), color });
    useUi.getState().toast(t('holidays.added'), 'success');
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      size="md"
      title={t('holidays.title')}
      initialFocus="#holiday-country"
      footer={
        <>
          <Button onClick={close}>{t('settings.cancel')}</Button>
          <Button variant="primary" disabled={exists} onClick={submit}>
            {t('holidays.add')}
          </Button>
        </>
      }
    >
      <form
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('holidays.country')} hint={exists ? t('holidays.exists') : t('holidays.hint')} htmlFor="holiday-country">
          <select id="holiday-country" className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {countryName(c, lang)}
              </option>
            ))}
          </select>
        </Field>
        <ul className="bg-bg-weak mb-4 flex flex-col gap-1.5 rounded-xl px-4 py-3 text-[0.8125rem]">
          {upcoming.map((h) => (
            <li key={h.date.getTime() + h.name.en} className="flex justify-between gap-4">
              <span className="min-w-0 truncate">{localName(h.name, lang)}</span>
              <span className="text-text-weak shrink-0 tabular-nums">{fmt.date(h.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            </li>
          ))}
        </ul>
        <Field label={t('settings.calendarColor')}>
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
