// English strings of reminder notifications: how they name the time of the event or the task, worded
// when the notification is shown (lib/reminders.ts whenText; on Android res/values/strings_when.xml).
// Spread into `en`.
export const remindersEn = {
  'reminders.when.today': 'Today',
  'reminders.when.tomorrow': 'Tomorrow',
  'reminders.when.yesterday': 'Yesterday',
  // {day} is one of the three above, a weekday ("Thursday") or a short date ("23 Oct").
  'reminders.when.at': '{day} at {time}',
  // The title of a notification whose item's own title is too long to show.
  'reminders.title.event': 'Event reminder',
  'reminders.title.task': 'Task reminder',
};
