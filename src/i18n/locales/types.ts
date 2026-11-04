// What the dictionary of an extra language (languages.ts) holds.
import type { MessageKey } from '../en';

export interface LocaleModule {
  /** Every text of the interface (`src/i18n/en.ts`). */
  messages: Record<MessageKey, string>;
  /** Holiday names (`src/lib/holidays.ts`), by their English name. */
  holidays: Record<string, string>;
}
