import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

type Tone = 'info' | 'success' | 'warning' | 'danger';

interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: Tone;
  title?: ReactNode;
  /** Replaces the icon of the tone; `null` leaves it out. */
  icon?: ReactNode;
  /** Buttons under the text. */
  actions?: ReactNode;
  /** For moving the focus onto a message that has just appeared (with `tabIndex={-1}`). */
  ref?: Ref<HTMLDivElement>;
}

const TONES: Record<Tone, { box: string; accent: string; Icon: typeof Info }> = {
  info: { box: 'bg-primary-weak', accent: 'text-primary', Icon: Info },
  success: { box: 'bg-success/10', accent: 'text-success', Icon: CheckCircle2 },
  warning: { box: 'bg-warning/10', accent: 'text-warning', Icon: AlertTriangle },
  danger: { box: 'bg-danger/10', accent: 'text-danger', Icon: AlertCircle },
};

/**
 * A message set apart from the text around it. Warnings and errors are read
 * out when they appear (`role="alert"`); the other two wait to be read.
 */
export function Alert({ tone = 'info', title, icon, actions, className = '', children, ...rest }: AlertProps) {
  const { box, accent, Icon } = TONES[tone];
  // Errors keep their colour in the text, as everywhere else in the app. The
  // other accents are too light to read as text on some themes.
  const text = tone === 'danger' ? accent : 'text-text';
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className={`flex items-start gap-2 rounded-xl p-3 text-[0.8125rem] ${box} ${text} ${className}`}
      {...rest}
    >
      {icon !== null && (
        <span className={`mt-0.5 shrink-0 ${accent}`} aria-hidden>
          {icon ?? <Icon size={16} />}
        </span>
      )}
      <div className="min-w-0 flex-1 break-words">
        {title !== undefined && <div className="font-semibold">{title}</div>}
        {children !== undefined && <div className={title !== undefined ? 'mt-0.5' : ''}>{children}</div>}
        {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
