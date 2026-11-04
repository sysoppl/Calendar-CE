import { useId, type ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { useT } from '@/i18n';

interface OptionCardProps {
  icon: ReactNode;
  title: ReactNode;
  /** One sentence under the title. */
  summary?: ReactNode;
  /** A word or two next to the title, e.g. "Recommended". */
  badge?: ReactNode;
  /** What speaks for this option. */
  good?: ReactNode[];
  /** What to know before choosing it. */
  caveats?: ReactNode[];
  /** Headings of the two lists; "Good" and "Keep in mind" unless given. */
  goodLabel?: string;
  caveatsLabel?: string;
  /** Bottom edge of the card, normally its one button. */
  footer?: ReactNode;
  /** Makes the card itself the control: a click anywhere outside the footer chooses it. */
  onSelect?: () => void;
  /** The control's name when the title alone does not tell the options apart (it should start with the title). */
  selectLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  /** Level of the title in the page outline. */
  headingLevel?: 2 | 3 | 4;
  /** Inside a dialog: a title below the dialog's own in size, and tighter padding. */
  compact?: boolean;
  className?: string;
}

// The title button reaches over the whole card (and draws its focus ring
// there), so the card is one control with the title as its name.
const STRETCHED =
  'text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary';

/**
 * A large card presenting one of a few options: what it is, what is good
 * about it, what to keep in mind. Either it carries its own action in the
 * footer, or (with `onSelect`) the whole card is the choice.
 */
export function OptionCard({
  icon,
  title,
  summary,
  badge,
  good = [],
  caveats = [],
  goodLabel,
  caveatsLabel,
  footer,
  onSelect,
  selectLabel,
  selected = false,
  disabled = false,
  headingLevel = 3,
  compact = false,
  className = '',
}: OptionCardProps) {
  const t = useT();
  const Heading = `h${headingLevel}` as const;
  const border = selected ? 'border-primary bg-primary-weak' : `border-border-weak ${onSelect && !disabled ? 'hover:border-border' : ''}`;

  return (
    <div className={`@container relative flex min-w-0 flex-col rounded-2xl border p-4 transition-colors ${compact ? '' : 'sm:p-5'} ${border} ${disabled ? 'opacity-60' : ''} ${className}`}>
      <div className="flex items-start gap-3">
        <span className="bg-primary-weak text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Heading className={`min-w-0 leading-snug font-semibold break-words ${compact ? 'text-base' : 'text-lg'}`}>
              {onSelect ? (
                <button type="button" aria-pressed={selected} aria-label={selectLabel} disabled={disabled} onClick={onSelect} className={STRETCHED}>
                  {title}
                </button>
              ) : (
                title
              )}
            </Heading>
            {badge && <span className="bg-primary-weak text-primary rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold">{badge}</span>}
          </div>
          {summary && <p className="text-text-weak mt-1">{summary}</p>}
        </div>
        {onSelect && (
          <span
            aria-hidden
            className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${selected ? 'bg-primary border-primary text-primary-contrast' : 'border-border'}`}
          >
            {selected && <Check size={13} strokeWidth={3} />}
          </span>
        )}
      </div>

      {(good.length > 0 || caveats.length > 0) && (
        <div className="mt-4 grid gap-4 @md:grid-cols-2">
          {good.length > 0 && <Points label={goodLabel ?? t('ui.option.good')} items={good} icon={<Check size={15} strokeWidth={2.5} className="text-success" />} />}
          {caveats.length > 0 && <Points label={caveatsLabel ?? t('ui.option.caveats')} items={caveats} icon={<AlertCircle size={15} className="text-warning" />} />}
        </div>
      )}

      {/* Positioned, so it stays clickable above the stretched button. */}
      {footer && <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-5">{footer}</div>}
    </div>
  );
}

function Points({ label, items, icon }: { label: string; items: ReactNode[]; icon: ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div id={id} className="text-text-weak mb-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase">
        {label}
      </div>
      <ul aria-labelledby={id} className="flex flex-col gap-1.5 text-[0.8125rem]">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {icon}
            </span>
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
