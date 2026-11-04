import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { resolveLang, translate, type Lang, type MessageKey } from '@/i18n';
import { useSettings } from '@/store/settings';
import { Button } from './Button';
import { TOUCH_AREA } from './touch';

/** What stopped the app: drawing a screen, or opening what the device keeps at the start. */
export type FailureKind = 'render' | 'start';

/**
 * A short code for a failure: where it happened and the kind of error
 * ("render/TypeError"). Never the message, which can quote calendar data
 * (a parser naming the value it could not read).
 */
export function errorCode(kind: FailureKind, error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  return `${kind}/${/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : 'Error'}`;
}

// A place in the code: a script's address or file path, line and column.
const PLACE = String.raw`(?:[a-z][\w+.-]*:\/\/|(?:[a-z]:)?[\\/])[^\s()@]{1,500}:\d+:\d+`;
// Stack frames, as engines print them: "at fn (place)", "at place" and "fn@place".
const FRAME = new RegExp(String.raw`^at (?:(?:async |new )?[\w$.<>[\]]{1,200}(?: \[as [\w$]{1,100}\])? \()?${PLACE}\)?$`, 'i');
const FRAME_AT = new RegExp(String.raw`^[\w$.<>[\]/]{0,200}@${PLACE}$`, 'i');
// A component stack line has a component name and maybe its place.
const COMPONENT = new RegExp(String.raw`^at [\w$.]{1,200}(?: \(${PLACE}\))?$`, 'i');

/** The lines of a stack that say where, and none that could carry the message. */
function where(stack: unknown, line: RegExp[], header = ''): string {
  if (typeof stack !== 'string') return '';
  // Some engines start the stack with the message, which may run over several lines.
  return (header && stack.startsWith(header) ? stack.slice(header.length) : stack)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => line.some((re) => re.test(l)))
    .slice(0, 30)
    .join('\n');
}

/**
 * Logs a failure for whoever debugs it: the code, the code locations and the
 * components involved. The message and the error object are left out; on
 * Android the console ends up in the system log. `recovered`: React drew the
 * screen again and the app went on.
 */
export function logFailure(code: string, error: unknown, componentStack?: string | null, recovered = false) {
  const header = error instanceof Error ? (error.message ? `${error.name}: ${error.message}` : error.name) : '';
  const trace = error instanceof Error ? where(error.stack, [FRAME, FRAME_AT], header) : '';
  const components = where(componentStack, [COMPONENT]);
  const details = [trace, components].filter(Boolean).join('\n\n');
  if (recovered) console.warn(`Calendar recovered from an error (${code})`, details);
  else console.error(`Calendar stopped (${code})`, details);
}

/** The interface language, read without a hook: the store itself may be what failed. */
function language(): Lang {
  try {
    return resolveLang(useSettings.getState());
  } catch {
    return 'en';
  }
}

function texts(kind: FailureKind) {
  const lang = language();
  const tr = (key: MessageKey) => translate(lang, key);
  return {
    title: tr('app.failure.title'),
    body: tr(kind === 'start' ? 'app.failure.start' : 'app.failure.render'),
    code: tr('app.failure.code'),
    reload: tr('app.failure.reload'),
  };
}

const reload = () => window.location.reload();

/**
 * The page shown instead of the app when it cannot go on: what happened in
 * one calm sentence, a code to quote when reporting it, and a way to start
 * again. It depends on nothing that could have failed with the app.
 */
export function ErrorScreen({ kind, code, onReload = reload }: { kind: FailureKind; code: string; onReload?: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const text = texts(kind);
  // The page replaced whatever had the focus; a screen reader starts here.
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className={`bg-frame text-frame-text pt-safe flex h-full overflow-y-auto text-pretty ${TOUCH_AREA}`}>
      <main className="m-auto w-full max-w-[28rem] px-4 py-10">
        <section aria-labelledby="app-failure-title" className="bg-bg text-text border-border-weak rounded-2xl border p-5 sm:p-8">
          <span aria-hidden className="bg-primary-weak text-primary flex h-11 w-11 items-center justify-center rounded-full">
            <AlertCircle size={22} />
          </span>
          <h1 ref={heading} id="app-failure-title" tabIndex={-1} className="mt-4 text-xl leading-snug font-semibold tracking-tight outline-none">
            {text.title}
          </h1>
          <p className="text-text-weak mt-1.5">{text.body}</p>
          <p className="text-text-weak mt-4 text-xs">
            {text.code} <code className="text-text font-mono select-all">{code}</code>
          </p>
          <Button variant="primary" className="mt-6 w-full" icon={<RotateCw size={16} />} onClick={onReload}>
            {text.reload}
          </Button>
        </section>
      </main>
    </div>
  );
}

/**
 * Catches an error thrown while drawing anything inside it and shows the
 * failure page, so a broken screen never leaves a blank one behind.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { code: string | null }> {
  state = { code: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { code: errorCode('render', error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logFailure(errorCode('render', error), error, info.componentStack);
  }

  render() {
    return this.state.code ? <ErrorScreen kind="render" code={this.state.code} /> : this.props.children;
  }
}

/**
 * The same page without React, for an error that got past the boundary (the
 * failure page itself failed): React has taken the app off the page by then.
 */
export function showStaticFailure(code: string, container: HTMLElement | null = document.getElementById('root')) {
  if (!container) return;
  const text = texts('render');
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:28rem;margin:15vh auto 0;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.5';
  const title = document.createElement('h1');
  title.textContent = text.title;
  title.style.cssText = 'font-size:1.25rem;font-weight:600';
  const body = document.createElement('p');
  body.textContent = `${text.body} ${text.code} ${code}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text.reload;
  button.style.cssText = 'margin-top:1rem;min-height:2.75rem;padding:0 1.25rem;font:inherit;font-weight:600;cursor:pointer';
  button.addEventListener('click', reload);
  box.append(title, body, button);
  container.replaceChildren(box);
}

/**
 * Options for `createRoot`. React's own reports print the error with its
 * message; these log what `logFailure` logs. An error the boundary caught is
 * logged by the boundary.
 */
export const ROOT_ERROR_OPTIONS = {
  onCaughtError(error: unknown, info: { componentStack?: string | null; errorBoundary?: unknown }) {
    if (!(info.errorBoundary instanceof ErrorBoundary)) logFailure(errorCode('render', error), error, info.componentStack);
  },
  onUncaughtError(error: unknown, info: { componentStack?: string | null }) {
    const code = errorCode('render', error);
    logFailure(code, error, info.componentStack);
    showStaticFailure(code);
  },
  // A screen that failed once and was then drawn: React's own report carries
  // the first error, message included, as the `cause` of one of its own.
  onRecoverableError(error: unknown, info: { componentStack?: string | null }) {
    const first = error instanceof Error && error.cause !== undefined ? error.cause : error;
    logFailure(errorCode('render', first), first, info.componentStack, true);
  },
};
