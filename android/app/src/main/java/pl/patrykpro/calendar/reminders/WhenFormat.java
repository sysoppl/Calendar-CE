package pl.patrykpro.calendar.reminders;

/**
 * Words the time of an event or a task for a notification, relative to the
 * moment the notification is shown: "Today at 18:00", "Tomorrow at 9:00",
 * "Thursday at 18:00", "23 Oct at 18:00"; for an item of whole days "Today",
 * "Tomorrow", "Thursday" or "23 Oct". An interface so that the code which
 * builds and shows reminders can be tested without Android's resources.
 */
public interface WhenFormat {
    /**
     * @param now    the moment the notification is shown
     * @param start  the event's start or the task's due time
     * @param allDay the item takes whole days: {@code start} names a day, not a time of day
     */
    String format(long now, long start, boolean allDay);
}
