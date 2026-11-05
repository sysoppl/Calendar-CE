import { useId, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { describeAlarm } from '@/lib/describe';
import { MAX_ALARMS_PER_ITEM } from '@/lib/reminders';
import { Checkbox } from '@/components/ui/Controls';
import { TOUCH_MIN, TOUCH_MIN_H } from '@/components/ui/touch';

type Unit = 'minutes' | 'hours' | 'days' | 'weeks';
const FACTOR: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

function split(minutes: number): { n: number; unit: Unit } {
  for (const unit of ['weeks', 'days', 'hours'] as Unit[]) {
    if (minutes >= FACTOR[unit] && minutes % FACTOR[unit] === 0) return { n: minutes / FACTOR[unit], unit };
  }
  return { n: minutes, unit: 'minutes' };
}

const TIMED_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
const ALL_DAY_PRESETS = [-720, -540, -480, 900, 960, 1440, 10080];

/**
 * Whether the item's notifications stay until they are dealt with
 * (lib/persistent.ts). Offered below the notifications once there is one.
 */
export function PersistentField({ checked, task, onChange }: { checked: boolean; task: boolean; onChange: (persistent: boolean) => void }) {
  const t = useT();
  const hintId = useId();
  return (
    <div>
      <Checkbox checked={checked} onChange={onChange} describedBy={hintId}>
        {t('editor.persistent')}
      </Checkbox>
      <p id={hintId} className="text-text-hint text-xs">
        {t(task ? 'editor.persistentHint.task' : 'editor.persistentHint.event')}
      </p>
    </div>
  );
}

/**
 * Edits reminder offsets (minutes before start). Common values are offered
 * in a dropdown; other values are edited as number + unit.
 */
export function AlarmFields({
  alarms,
  allDay,
  onChange,
  label,
}: {
  alarms: number[];
  allDay: boolean;
  onChange: (a: number[]) => void;
  /** What names each notification's field; "Notifications" unless the list sits among others of its kind. */
  label?: string;
}) {
  const t = useT();
  const fieldLabel = label ?? t('editor.notifications');
  const fmt = useFormat();
  const presets = allDay ? ALL_DAY_PRESETS : TIMED_PRESETS;

  // Row being edited as number + unit. While it is, values are neither sorted
  // nor de-duplicated, so the row keeps its place (and focus) during typing.
  const [custom, setCustom] = useState<number | null>(null);
  const normalize = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);

  const update = (i: number, value: number, editing = false) => {
    const next = [...alarms];
    next[i] = value;
    onChange(editing ? next : normalize(next));
  };

  return (
    <div className="flex flex-col gap-2">
      {alarms.map((m, i) => {
        const isPreset = presets.includes(m) && custom !== i;
        const { n, unit } = split(Math.max(0, m));
        return (
          <div
            key={i}
            className="flex items-center gap-2"
            onBlur={(e) => {
              if (custom !== i || e.currentTarget.contains(e.relatedTarget)) return;
              setCustom(null);
              onChange(normalize(alarms));
            }}
          >
            {isPreset || allDay ? (
              <select className="field" value={m} onChange={(e) => {
                  const v = Number(e.target.value);
                  // "Custom" switches the row to number + unit editing.
                  if (v === -1) {
                    setCustom(i);
                    update(i, 45, true);
                  } else update(i, v);
                }} aria-label={fieldLabel}>
                {[...new Set([...presets, m])].sort((a, b) => a - b).map((p) => (
                  <option key={p} value={p}>
                    {describeAlarm(p, allDay, t, fmt)}
                  </option>
                ))}
                {!allDay && <option value={-1}>{t('repeat.custom')}</option>}
              </select>
            ) : (
              <div className="flex flex-1 items-center gap-2">
                <input type="number" min={0} value={n} className="field w-20" onFocus={() => setCustom(i)} onChange={(e) => update(i, Math.max(0, Number(e.target.value) || 0) * FACTOR[unit], true)} aria-label={fieldLabel} />
                <select className="field" value={unit} onFocus={() => setCustom(i)} onChange={(e) => update(i, n * FACTOR[e.target.value as Unit], true)}>
                  {(Object.keys(FACTOR) as Unit[]).map((u) => (
                    <option key={u} value={u}>
                      {t(`alarm.unit.${u}`)}
                    </option>
                  ))}
                </select>
                <span className="text-text-weak shrink-0">{t('alarm.before')}</span>
              </div>
            )}
            <button type="button" aria-label={t('alarm.remove')} title={t('alarm.remove')} className={`text-text-weak hover:bg-bg-weak flex shrink-0 items-center justify-center rounded-lg p-2 disabled:opacity-50 ${TOUCH_MIN}`} onClick={() => {
              setCustom(null);
              onChange(normalize(alarms.filter((_, j) => j !== i)));
            }}>
              <X size={16} />
            </button>
          </div>
        );
      })}
      {/* No more than the reminders go off for; one written by another app stays listed and kept. */}
      {alarms.length >= MAX_ALARMS_PER_ITEM ? (
        <p className="text-text-hint text-xs">{t('editor.notificationsMax', { n: MAX_ALARMS_PER_ITEM })}</p>
      ) : (
        <button
          type="button"
          className={`text-primary flex w-fit items-center gap-1.5 rounded-lg text-[0.8125rem] font-semibold hover:underline disabled:opacity-50 disabled:hover:no-underline ${TOUCH_MIN_H} ${alarms.length ? 'py-1' : 'h-[var(--field-h)]'}`}
          onClick={() => {
            const next = presets.find((p) => !alarms.includes(p)) ?? 15;
            onChange([...alarms, next].sort((a, b) => a - b));
          }}
        >
          <Plus size={16} />
          {t('editor.addNotification')}
        </button>
      )}
    </div>
  );
}
