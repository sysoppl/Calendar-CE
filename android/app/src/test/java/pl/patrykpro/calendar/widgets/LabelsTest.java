package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Locale;

public class LabelsTest {
    private static final int NINTH = Days.parse("2026-11-09");

    private static Labels english(boolean hour12) {
        Labels.Words words = new Labels.Words("Today", "Tomorrow", "All day", "From %1$s", "Until %1$s", "%1$s – %2$s");
        Labels.Patterns patterns = new Labels.Patterns(hour12 ? "h:mm a" : "HH:mm", "EEE d MMM", "d MMM", "d MMM y", "LLLL y", "d MMMM");
        return new Labels(Locale.UK, Snap.WARSAW, words, patterns);
    }

    private static Labels polish() {
        Labels.Words words = new Labels.Words("Dziś", "Jutro", "Cały dzień", "Od %1$s", "Do %1$s", "%1$s – %2$s");
        Labels.Patterns patterns = new Labels.Patterns("HH:mm", "EEE, d MMM", "d MMM", "d MMM y", "LLLL y", "d MMMM");
        return new Labels(new Locale.Builder().setLanguage("pl").setRegion("PL").build(), Snap.WARSAW, words, patterns);
    }

    @Test
    public void namesTheDaysOfTheAgenda() {
        Labels l = english(false);
        assertEquals("Today", l.dayHeader(NINTH, NINTH));
        assertEquals("Tomorrow", l.dayHeader(NINTH + 1, NINTH));
        assertEquals("Wed 11 Nov", l.dayHeader(NINTH + 2, NINTH));
        assertEquals("Monday", l.weekday(NINTH));
        assertEquals("9 November", l.longDate(NINTH));
        assertEquals("November 2026", l.monthTitle(Days.parse("2026-11-01")));
        assertEquals("November", l.monthName(NINTH));
        assertEquals("12 Nov", l.date(NINTH + 3, NINTH));
        assertEquals("4 Jan 2027", l.date(Days.parse("2027-01-04"), NINTH));
    }

    @Test
    public void writesTheMonthAndWeekdayWithACapitalInEveryLanguage() {
        Labels l = polish();
        assertEquals("Listopad 2026", l.monthTitle(Days.parse("2026-11-01")));
        assertEquals("Poniedziałek", l.weekday(NINTH));
        assertEquals("Listopad", l.monthName(NINTH));
        assertEquals("9 listopada", l.longDate(NINTH));
        assertEquals("Dziś", l.dayHeader(NINTH, NINTH));
    }

    @Test
    public void wordsTheTimeOfEachPartOfAnEvent() {
        Snapshot s = Snap.november()
            .timed("c", "a", "Meeting", Snap.at(2026, 11, 9, 9, 0), Snap.at(2026, 11, 9, 10, 30))
            .timed("c", "night", "Night", Snap.at(2026, 11, 9, 22, 0), Snap.at(2026, 11, 11, 6, 0))
            .timed("c", "point", "Call", Snap.at(2026, 11, 9, 23, 15), Snap.at(2026, 11, 9, 23, 15))
            .allDay("c", "day", "Trip", "2026-11-09", "2026-11-12")
            .parse();
        WidgetOptions o = new WidgetOptions();
        long early = Snap.at(2026, 11, 9, 0, 1);
        Labels l = english(false);
        Agenda.Result r = Agenda.build(s, o, early, Snap.WARSAW);
        StringBuilder out = new StringBuilder();
        for (Agenda.Row row : r.rows) {
            if (row.type == Agenda.EVENT) out.append(row.item.key()).append('=').append(l.eventTime(row.item)).append(';');
        }
        assertEquals("day=All day;a=09:00 – 10:30;night=From 22:00;point=23:15;"
            + "night=All day;day=All day;"
            + "day=All day;night=Until 06:00;", out.toString());

        Labels twelve = english(true);
        Agenda.Item meeting = r.rows.get(2).item;
        assertEquals("9:00 am – 10:30 am", twelve.eventTime(meeting).toLowerCase(Locale.ROOT));
        assertEquals("9:00 am", twelve.shortTime(meeting).toLowerCase(Locale.ROOT));
    }

    @Test
    public void wordsWhenATaskIsDue() {
        long noon = Snap.at(2026, 11, 9, 12, 0);
        Snapshot s = Snap.november()
            .taskDue("c", "at15", "At 15", Snap.at(2026, 11, 9, 15, 0))
            .taskOn("c", "today", "Today", "2026-11-09")
            .taskOn("c", "tomorrow", "Tomorrow", "2026-11-10")
            .taskDue("c", "friday", "Friday", Snap.at(2026, 11, 13, 9, 0))
            .taskOn("c", "old", "Old", "2026-11-02")
            .taskUndated("c", "someday", "Someday")
            .parse();
        Labels l = english(false);
        StringBuilder out = new StringBuilder();
        for (TaskRows.Row row : TaskRows.build(s, new WidgetOptions(), noon, Snap.WARSAW).rows) {
            out.append(row.task.key).append('=').append(l.due(row, NINTH)).append(row.overdue ? "!" : "").append(';');
        }
        assertEquals("old=2 Nov!;today=Today;at15=15:00;tomorrow=Tomorrow;friday=13 Nov;someday=;", out.toString());

        // In the agenda a task is on its day: only an overdue one from before says when it was due.
        WidgetOptions o = new WidgetOptions();
        StringBuilder agenda = new StringBuilder();
        for (Agenda.Row row : Agenda.build(s, o, noon, Snap.WARSAW).rows) {
            if (row.type == Agenda.TASK) agenda.append(row.item.key()).append('=').append(l.agendaTask(row.item, NINTH)).append(';');
        }
        assertEquals("old=2 Nov;today=;at15=15:00;tomorrow=;friday=09:00;", agenda.toString());
    }

    @Test
    public void theTodayWidgetsNarrowColumn() {
        long noon = Snap.at(2026, 11, 9, 12, 0);
        Snapshot s = Snap.november()
            .timed("c", "since", "Since yesterday", Snap.at(2026, 11, 8, 20, 0), Snap.at(2026, 11, 9, 14, 0))
            .allDay("c", "day", "Day", "2026-11-09", "2026-11-10")
            .taskOn("c", "task", "Task", "2026-11-09")
            .parse();
        Labels l = english(false);
        TodayPick p = TodayPick.pick(s, new WidgetOptions(), noon, Snap.WARSAW, 3);
        assertEquals("All day", l.shortTime(p.today.get(0)));
        assertEquals("", l.shortTime(p.today.get(1)));
        assertEquals("Until 14:00", l.shortTime(p.today.get(2)));
    }
}
