// Polish strings of reminder notifications (see reminders.en.ts). Spread into `pl`.
import type { remindersEn } from './reminders.en';

export const remindersPl: Record<keyof typeof remindersEn, string> = {
  'reminders.when.today': 'Dzisiaj',
  'reminders.when.tomorrow': 'Jutro',
  'reminders.when.yesterday': 'Wczoraj',
  'reminders.when.at': '{day} o godzinie {time}',
  // The title of a notification whose item's own title is too long to show.
  'reminders.title.event': 'Przypomnienie o wydarzeniu',
  'reminders.title.task': 'Przypomnienie o zadaniu',
};
