import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useT } from '@/i18n';
import { TOUCH_MIN } from './touch';

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  /** Shown in place of the hint and read out; marks the field as invalid. */
  error?: ReactNode;
}

/**
 * A labelled password input with a button that shows what was typed.
 * `name` and `autoComplete` tell a password manager what the field is: they
 * default to "password" and to "current-password"; a repeat field needs a
 * `name` of its own.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { label, value, onChange, hint, error, id, name = 'password', autoComplete, className = '', disabled, onKeyDown, onKeyUp, onBlur, ...rest },
  ref,
) {
  const t = useT();
  const autoId = useId();
  const fieldId = id ?? autoId;
  const input = useRef<HTMLInputElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // A password manager offers to save what sits in a password field when the
  // form is sent, and the next attempt should not start in the clear.
  useEffect(() => {
    const form = input.current?.form;
    if (!visible || !form) return;
    const hide = () => setVisible(false);
    form.addEventListener('submit', hide);
    return () => form.removeEventListener('submit', hide);
  }, [visible]);

  // Not a controlled input: React would copy the value into the `value`
  // attribute, which puts the password into the page's markup, readable by a
  // style rule or in a saved copy of the page. What is typed stays in the
  // input; a value set from outside (cleared after a flow) is written here.
  useLayoutEffect(() => {
    const el = input.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);

  const watchCapsLock = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  const notes = [capsLock && `${fieldId}-caps`, (error || hint) && `${fieldId}-note`].filter(Boolean).join(' ');

  return (
    <div className={`mb-4 ${className}`}>
      <label htmlFor={fieldId} className="mb-1.5 block text-[0.8125rem] font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          ref={(el) => {
            input.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          id={fieldId}
          name={name}
          type={visible ? 'text' : 'password'}
          className="field pr-[max(2.5rem,var(--touch,0px))] disabled:opacity-60"
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete ?? 'current-password'}
          // Shown as text, the password must not end up in a dictionary or be "corrected".
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={notes || undefined}
          onKeyDown={(e) => {
            watchCapsLock(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            watchCapsLock(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCapsLock(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        <button
          type="button"
          aria-label={visible ? t('ui.password.hide') : t('ui.password.show')}
          title={visible ? t('ui.password.hide') : t('ui.password.show')}
          aria-controls={fieldId}
          disabled={disabled}
          onClick={() => setVisible(!visible)}
          // As tall as the field for a finger; the focus ring is drawn inside it, clear of the field's border.
          className={`text-text-weak hover:text-text absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-lg transition-colors focus-visible:-outline-offset-4 disabled:opacity-50 ${TOUCH_MIN}`}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {capsLock && (
        <p id={`${fieldId}-caps`} className="mt-1 text-xs font-medium">
          {t('ui.password.capsLock')}
        </p>
      )}
      {error ? (
        <p id={`${fieldId}-note`} role="alert" className="text-danger mt-1 text-xs">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${fieldId}-note`} className="text-text-weak mt-1 text-xs">
            {hint}
          </p>
        )
      )}
    </div>
  );
});
