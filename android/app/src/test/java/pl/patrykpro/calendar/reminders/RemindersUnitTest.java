package pl.patrykpro.calendar.reminders;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

public class RemindersUnitTest {

    @Test
    public void idMatchesTheWebImplementation() {
        // Reference values computed with reminderId() in src/lib/reminders.ts.
        assertEquals(573704761, Reminder.idFor("https://x.test/cal/a.ics#2026-10-12T09:00:00|15"));
        assertEquals(692962227, Reminder.idFor("zażółć|0"));
    }

    @Test
    public void remindersOfOneItemShareTheirNotification() {
        String occurrence = "https://x.test/cal/a.ics#2026-10-12T09:00:00";
        int id = Reminder.noticeIdFor(occurrence + "|60");
        // Other minutes of the app, and a snoozed copy (snoozed again too).
        assertEquals(id, Reminder.noticeIdFor(occurrence + "|15"));
        assertEquals(id, Reminder.noticeIdFor(occurrence + "|5|snooze1791000000000"));
        assertEquals(id, new Reminder(occurrence + "|0", 0, "", "").noticeId());
        assertNotEquals(id, Reminder.noticeIdFor("https://x.test/cal/a.ics#2026-10-13T09:00:00|60"));
        // The worker's keys: calendar, uid, start and the offset.
        String task = "acc|cal|uid-1|1791000000000";
        assertEquals(Reminder.noticeIdFor(task + "|-900000"), Reminder.noticeIdFor(task + "|-3600000|snooze1790999000000"));
        assertNotEquals(Reminder.noticeIdFor(task + "|-900000"), Reminder.noticeIdFor("acc|cal|uid-1|1791086400000|-900000"));
        // A key without a lead time keeps its own.
        assertEquals("plain", Reminder.itemOf("plain"));
        assertEquals("test", Reminder.itemOf("test|1791000000000"));
    }

    @Test
    public void parsesFoldedLinesParamsAndEscapes() {
        String ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Long ti\r\n tle\\, with comma\r\n"
            + "DTSTART;TZID=\"Europe/Warsaw\":20261012T090000\r\nLOCATION:Room\\n2\r\n"
            + "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        List<IcsMini.Component> roots = IcsMini.parse(ics);
        assertEquals(1, roots.size());
        IcsMini.Component ev = roots.get(0).all("VEVENT").get(0);
        assertEquals("Long title, with comma", ev.text("SUMMARY"));
        assertEquals("Room\n2", ev.text("LOCATION"));
        assertEquals("Europe/Warsaw", ev.prop("DTSTART").param("TZID"));
        assertEquals(1, ev.all("VALARM").size());
    }

    @Test
    public void parsesTimesInAllForms() {
        IcsMini.Component ev = IcsMini.parse("BEGIN:VEVENT\r\nA:20261012T070000Z\r\nB;TZID=Europe/Warsaw:20261012T090000\r\nC;VALUE=DATE:20261012\r\n"
            + "D;TZID=/freeassociation.sourceforge.net/Tzfile/Europe/Warsaw:20261012T090000\r\nEND:VEVENT\r\n").get(0);
        long utc = IcsMini.parseTime(ev.prop("A")).millis;
        assertEquals(utc, IcsMini.parseTime(ev.prop("B")).millis);
        assertEquals(utc, IcsMini.parseTime(ev.prop("D")).millis);
        IcsMini.Time day = IcsMini.parseTime(ev.prop("C"));
        assertTrue(day.allDay);
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(day.millis);
        assertEquals(0, c.get(Calendar.HOUR_OF_DAY));
        assertEquals(12, c.get(Calendar.DAY_OF_MONTH));
    }

    @Test
    public void parsesDurations() {
        assertEquals(Long.valueOf(-15 * 60000L), IcsMini.parseDuration("-PT15M"));
        assertEquals(Long.valueOf(86400000L + 2 * 3600000L), IcsMini.parseDuration("P1DT2H"));
        assertEquals(Long.valueOf(-7 * 86400000L), IcsMini.parseDuration("-P1W"));
        assertEquals(Long.valueOf(15 * 3600000L), IcsMini.parseDuration("PT15H"));
        assertNull(IcsMini.parseDuration("garbage"));
    }

    @Test
    public void computesTriggerTimes() {
        long start = 1_000_000_000_000L;
        long end = start + 3600000L;
        IcsMini.Component rel = IcsMini.parse("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\n").get(0);
        assertEquals(Long.valueOf(start - 600000L), ReminderSyncWorker.triggerTime(rel, start, end));

        IcsMini.Component relEnd = IcsMini.parse("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;RELATED=END:-PT5M\r\nEND:VALARM\r\n").get(0);
        assertEquals(Long.valueOf(end - 300000L), ReminderSyncWorker.triggerTime(relEnd, start, end));

        IcsMini.Component abs = IcsMini.parse("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20261012T070000Z\r\nEND:VALARM\r\n").get(0);
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(2026, Calendar.OCTOBER, 12, 7, 0, 0);
        assertEquals(Long.valueOf(c.getTimeInMillis()), ReminderSyncWorker.triggerTime(abs, start, end));

        IcsMini.Component noTrigger = IcsMini.parse("BEGIN:VALARM\r\nACTION:DISPLAY\r\nEND:VALARM\r\n").get(0);
        assertNull(ReminderSyncWorker.triggerTime(noTrigger, start, end));
        assertNotNull(ReminderSyncWorker.triggerTime(rel, start, end));
        assertFalse(ReminderSyncWorker.absoluteTrigger(rel));
        assertFalse(ReminderSyncWorker.absoluteTrigger(relEnd));
        assertTrue(ReminderSyncWorker.absoluteTrigger(abs));
        assertFalse(ReminderSyncWorker.absoluteTrigger(noTrigger));
    }

    private static String event(String uid, String lines) {
        return "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:" + uid + "\r\n" + lines + "END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private static final String ALARM_15_MIN = "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n";

    @Test
    public void marksRemindersThatFollowTheWallClock() {
        List<Reminder> out = new ArrayList<>();
        long from = 0;
        long to = Long.MAX_VALUE;
        String ics = event("zoned", "SUMMARY:Call\r\nLOCATION:Room 2\r\nDTSTART:20261012T070000Z\r\nDTEND:20261012T080000Z\r\n" + ALARM_15_MIN)
            + event("allday", "DTSTART;VALUE=DATE:20261012\r\n" + ALARM_15_MIN)
            + event("floating", "SUMMARY:Wake up\r\nDTSTART:20261012T070000\r\n" + ALARM_15_MIN)
            + event("fixed", "SUMMARY:Fixed\r\nDTSTART;VALUE=DATE:20261012\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20261011T170000Z\r\nEND:VALARM\r\n");
        assertTrue(ReminderSyncWorker.collectEvents("cal", ics, from, to, "(untitled)", out));
        assertEquals(4, out.size());

        // A time with a zone is an instant.
        assertEquals("Call", out.get(0).title);
        // The notification words the start when it is shown; the place is the line below.
        assertTrue(out.get(0).hasStart());
        assertFalse(out.get(0).allDay);
        assertEquals("Room 2", out.get(0).body);
        assertFalse(out.get(0).floating);
        // A date, and a time without a zone, mean "on this device's clock".
        assertEquals("(untitled)", out.get(1).title);
        assertTrue(out.get(1).allDay);
        assertEquals("", out.get(1).body);
        assertTrue(out.get(1).floating);
        assertTrue(out.get(2).floating);
        // But an alarm set for a point in time stays there.
        assertFalse(out.get(3).floating);

        // Keys are unchanged from earlier versions: calendar, UID, start, offset.
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        utc.clear();
        utc.set(2026, Calendar.OCTOBER, 12, 7, 0, 0);
        assertEquals("cal|zoned|" + utc.getTimeInMillis() + "|-900000", out.get(0).key);
        assertEquals(utc.getTimeInMillis() - 900000, out.get(0).at);
        assertEquals(utc.getTimeInMillis(), out.get(0).start);
    }

    @Test
    public void reportsUnexpandedRecurrencesAndSkipsCancelledEvents() {
        List<Reminder> out = new ArrayList<>();
        String recurring = event("r", "DTSTART:20261012T070000Z\r\nRRULE:FREQ=DAILY\r\n" + ALARM_15_MIN);
        assertFalse(ReminderSyncWorker.collectEvents("cal", recurring, 0, Long.MAX_VALUE, "", out));
        out.clear();
        String cancelled = event("c", "STATUS:CANCELLED\r\nDTSTART:20261012T070000Z\r\n" + ALARM_15_MIN);
        assertTrue(ReminderSyncWorker.collectEvents("cal", cancelled, 0, Long.MAX_VALUE, "", out));
        assertTrue(out.isEmpty());
        // Outside the window.
        String ics = event("e", "DTSTART:20261012T070000Z\r\n" + ALARM_15_MIN);
        assertTrue(ReminderSyncWorker.collectEvents("cal", ics, 0, 1000, "", out));
        assertTrue(out.isEmpty());
    }

    @Test
    public void collectsTaskReminders() {
        List<Reminder> out = new ArrayList<>();
        String ics = "BEGIN:VCALENDAR\r\n"
            + "BEGIN:VTODO\r\nUID:t1\r\nSUMMARY:Pay bills\r\nDUE;VALUE=DATE:20261012\r\n" + ALARM_15_MIN + "END:VTODO\r\n"
            + "BEGIN:VTODO\r\nUID:t2\r\nDUE:20261012T070000Z\r\n" + ALARM_15_MIN + "END:VTODO\r\n"
            + "BEGIN:VTODO\r\nUID:t3\r\nSTATUS:COMPLETED\r\nDUE:20261012T070000Z\r\n" + ALARM_15_MIN + "END:VTODO\r\n"
            + "BEGIN:VTODO\r\nUID:t4\r\nSUMMARY:No date\r\n" + ALARM_15_MIN + "END:VTODO\r\n"
            + "END:VCALENDAR\r\n";
        ReminderSyncWorker.collectTasks("cal", ics, 0, Long.MAX_VALUE, "(untitled)", out);
        assertEquals(2, out.size());
        assertEquals("Pay bills", out.get(0).title);
        assertTrue(out.get(0).floating);
        // A task is named by its due time: a day, or a time of day.
        assertTrue(out.get(0).allDay);
        assertEquals("", out.get(0).body);
        assertEquals("(untitled)", out.get(1).title);
        assertFalse(out.get(1).floating);
        assertFalse(out.get(1).allDay);
        assertEquals(out.get(1).at + 15 * 60000, out.get(1).start);
    }

    @Test
    public void splitsParametersOnlyOutsideQuotes() {
        IcsMini.Component ev = IcsMini.parse("BEGIN:VEVENT\r\nX;A=\"x;y:z\";b=c;NOVALUE:v;w\r\nEND:VEVENT\r\n").get(0);
        IcsMini.Prop p = ev.prop("X");
        assertEquals("x;y:z", p.param("A"));
        assertEquals("c", p.param("B"));
        assertEquals("v;w", p.value);
        assertEquals(2, p.params.size());
    }

    /** One event of {@code lines} in a calendar, with a 15-minute reminder after them. */
    private static String eventWith(String lines) {
        return event("hostile", "SUMMARY:Call\r\nDTSTART:20261012T070000Z\r\n" + lines + ALARM_15_MIN);
    }

    @Test(timeout = 5000)
    public void aPropertyWithVeryManyParametersTakesNoTime() {
        // The split used to cost time growing with the square of the line: hours for this one.
        StringBuilder line = new StringBuilder("X-A");
        for (int i = 0; i < 200_000; i++) line.append(";a");
        List<Reminder> out = new ArrayList<>();
        assertTrue(ReminderSyncWorker.collectEvents("cal", eventWith(line + ":v\r\n"), 0, Long.MAX_VALUE, "", out));
        assertEquals(1, out.size());
        assertEquals("Call", out.get(0).title);
    }

    @Test(timeout = 5000)
    public void manyQuotedParametersDoNotExhaustTheStack() {
        // 10 000 quoted values made the old split recurse once per value, deep enough to throw StackOverflowError.
        StringBuilder line = new StringBuilder("X-A");
        for (int i = 0; i < 10_000; i++) line.append(";P=\"q\"");
        List<Reminder> out = new ArrayList<>();
        assertTrue(ReminderSyncWorker.collectEvents("cal", eventWith(line + ":v\r\n"), 0, Long.MAX_VALUE, "", out));
        assertEquals(1, out.size());
    }

    @Test
    public void skipsLinesTooLongToBeUseful() {
        // A title of 100 000 characters, folded the way servers fold: dropped, the rest of the event stays.
        StringBuilder summary = new StringBuilder("SUMMARY:");
        for (int i = 0; i < 2000; i++) summary.append("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\r\n ");
        String ics = event("long", summary + "end\r\nDTSTART:20261012T070000Z\r\n" + ALARM_15_MIN);
        List<Reminder> out = new ArrayList<>();
        assertTrue(ReminderSyncWorker.collectEvents("cal", ics, 0, Long.MAX_VALUE, "(untitled)", out));
        assertEquals(1, out.size());
        assertEquals("(untitled)", out.get(0).title);
    }

    @Test(timeout = 10000)
    public void aHugeEventIsReadOnlyInPart() {
        // 300 000 alarms in one event: the parse tree and the reminder list both stop growing.
        StringBuilder alarms = new StringBuilder();
        for (int i = 0; i < 300_000; i++) alarms.append("BEGIN:VALARM\r\nTRIGGER:-PT").append(i % 50_000).append("M\r\nEND:VALARM\r\n");
        IcsMini.Component ev = IcsMini.parse(event("many", "DTSTART:20261012T070000Z\r\n" + alarms)).get(0).all("VEVENT").get(0);
        assertTrue(ev.children.size() < 100_000);

        List<Reminder> out = new ArrayList<>();
        ReminderSyncWorker.collectEvents("cal", event("many", "DTSTART:20261012T070000Z\r\n" + alarms), 0, Long.MAX_VALUE, "", out);
        assertTrue(out.size() <= 5000);
        assertFalse(out.isEmpty());
    }

    @Test
    public void anItemSetsOffAtMostFiveNotifications() {
        StringBuilder alarms = new StringBuilder();
        for (int i = 1; i <= 300; i++) alarms.append("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT").append(i).append("M\r\nEND:VALARM\r\n");
        List<Reminder> out = new ArrayList<>();
        ReminderSyncWorker.collectEvents("cal", event("many", "DTSTART:20261012T070000Z\r\n" + alarms), 0, Long.MAX_VALUE, "", out);
        // As in the app: the five distinct offsets nearest the event, of the first 50 read.
        assertEquals(ReminderSyncWorker.MAX_NOTIFICATIONS_PER_ITEM, out.size());
        for (int i = 0; i < out.size(); i++) assertTrue(out.get(i).key.endsWith("|" + (-(i + 1) * 60_000L)));

        out.clear();
        String tasks = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:t\r\nDUE:20261012T070000Z\r\n" + alarms + "END:VTODO\r\nEND:VCALENDAR\r\n";
        ReminderSyncWorker.collectTasks("cal", tasks, 0, Long.MAX_VALUE, "", out);
        assertEquals(ReminderSyncWorker.MAX_NOTIFICATIONS_PER_ITEM, out.size());
    }

    @Test
    public void ofTwoAlarmsAsFarFromTheItemTheOneBeforeItIsKept() {
        // Six distinct offsets, five kept: the fifth place is a tie between an hour before and an
        // hour after. The app (src/lib/reminders.ts cappedAlarms, the same case in its tests) keeps
        // the one before, and so must the background refresh.
        String alarms = "";
        for (String trigger : new String[] {"PT1H", "-PT10M", "-PT15M", "-PT30M", "-PT45M", "-PT1H"}) {
            alarms += "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:" + trigger + "\r\nEND:VALARM\r\n";
        }
        List<Reminder> out = new ArrayList<>();
        ReminderSyncWorker.collectEvents("cal", event("tie", "DTSTART:20261012T070000Z\r\n" + alarms), 0, Long.MAX_VALUE, "", out);
        List<Long> offsets = new ArrayList<>();
        for (Reminder reminder : out) offsets.add(Long.parseLong(reminder.key.substring(reminder.key.lastIndexOf('|') + 1)));
        offsets.sort(null);
        assertEquals(java.util.Arrays.asList(-3_600_000L, -2_700_000L, -1_800_000L, -900_000L, -600_000L), offsets);

        // The same in the other order of the file, and for a task.
        IcsMini.Component ev = IcsMini.parse(event("tie", "DTSTART:20261012T070000Z\r\n" + alarms)).get(0).all("VEVENT").get(0);
        long start = 1_760_252_400_000L;
        java.util.List<IcsMini.Component> reversed = new ArrayList<>(ev.all("VALARM"));
        java.util.Collections.reverse(reversed);
        assertTrue(ReminderSyncWorker.keptOffsets(reversed, start, start, start).contains(-3_600_000L));
        assertFalse(ReminderSyncWorker.keptOffsets(reversed, start, start, start).contains(3_600_000L));
        out.clear();
        String tasks = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:t\r\nDUE:20261012T070000Z\r\n" + alarms + "END:VTODO\r\nEND:VCALENDAR\r\n";
        ReminderSyncWorker.collectTasks("cal", tasks, 0, Long.MAX_VALUE, "", out);
        assertEquals(ReminderSyncWorker.MAX_NOTIFICATIONS_PER_ITEM, out.size());
        for (Reminder reminder : out) assertFalse(reminder.key.endsWith("|3600000"));
    }

    @Test
    public void repeatedAlarmsCountOnceAndOverlongTextIsNotShown() {
        StringBuilder alarms = new StringBuilder();
        for (int i = 0; i < 8; i++) alarms.append(ALARM_15_MIN);
        StringBuilder longTitle = new StringBuilder();
        for (int i = 0; i < 201; i++) longTitle.append('x');
        List<Reminder> out = new ArrayList<>();
        String ics = event("same", "DTSTART:20261012T070000Z\r\nSUMMARY:" + longTitle + "\r\nLOCATION:" + longTitle + "\r\n" + alarms);
        assertTrue(ReminderSyncWorker.collectEvents("cal", ics, 0, Long.MAX_VALUE, "(untitled)", out));
        assertEquals(1, out.size());
        assertEquals("(untitled)", out.get(0).title);
        assertEquals("", out.get(0).body);
    }

    @Test
    public void anEventWithAHugeUidGetsNoReminders() {
        // A 60 000-character UID would make keys that fromJson drops on the next load anyway.
        StringBuilder uid = new StringBuilder();
        for (int i = 0; i < 60_000; i++) uid.append('u');
        List<Reminder> out = new ArrayList<>();
        String ics = event(uid.toString(), "DTSTART:20261012T070000Z\r\n" + ALARM_15_MIN) + event("fine", "DTSTART:20261012T080000Z\r\n" + ALARM_15_MIN);
        assertTrue(ReminderSyncWorker.collectEvents("cal", ics, 0, Long.MAX_VALUE, "", out));
        assertEquals(1, out.size());
        assertTrue(out.get(0).key.startsWith("cal|fine|"));

        out.clear();
        String tasks = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:" + uid + "\r\nDUE:20261012T070000Z\r\n" + ALARM_15_MIN + "END:VTODO\r\nEND:VCALENDAR\r\n";
        ReminderSyncWorker.collectTasks("cal", tasks, 0, Long.MAX_VALUE, "", out);
        assertTrue(out.isEmpty());
    }

    @Test
    public void everyKeyTheWorkerMakesIsReadBackWithItsSnoozedCopy() throws Exception {
        // A UID just under the cap and a long calendar key: the key would pass MAX_KEY, but not with a snooze.
        StringBuilder uid = new StringBuilder();
        for (int i = 0; i < ReminderSyncWorker.MAX_UID; i++) uid.append('u');
        StringBuilder calendar = new StringBuilder("acc|");
        while (calendar.length() < Reminder.MAX_KEY - ReminderSyncWorker.MAX_UID - 30) calendar.append('c');
        List<Reminder> out = new ArrayList<>();
        ReminderSyncWorker.collectEvents(calendar.toString(), event(uid.toString(), "DTSTART:20261012T070000Z\r\n" + ALARM_15_MIN), 0, Long.MAX_VALUE, "", out);
        assertTrue(out.isEmpty());

        out.clear();
        ReminderSyncWorker.collectEvents("acc|cal", event(uid.toString(), "DTSTART:20261012T070000Z\r\n" + ALARM_15_MIN), 0, Long.MAX_VALUE, "", out);
        assertEquals(1, out.size());
        Reminder r = out.get(0);
        assertNotNull(Reminder.fromJson(r.toJson()));
        assertNotNull(Reminder.fromJson(r.snoozed(r.key + "|snooze" + Long.MAX_VALUE, 0).toJson()));
        // Normal keys are as before.
        assertFalse(Reminder.keyFits(""));
        assertTrue(Reminder.keyFits("acc|cal|uid-1|1791000000000|-900000"));
    }

    @Test
    public void refusesDurationsThatDoNotFitALong() {
        assertNull(IcsMini.parseDuration("-PT99999999999999999999M"));
        assertNull(IcsMini.parseDuration("P9999999999999W"));
        assertNull(IcsMini.parseDuration("-P15250284452471D"));
        // The largest a group may be still works.
        assertEquals(Long.valueOf(999_999_999L * 1000L), IcsMini.parseDuration("PT999999999S"));
    }

    @Test
    public void anEventWithAnAbsurdDurationDoesNotCostTheOthers() {
        List<Reminder> out = new ArrayList<>();
        String ics = event("absurd", "DTSTART:20261012T070000Z\r\nDURATION:PT99999999999999999999M\r\n" + ALARM_15_MIN)
            + event("fine", "DTSTART:20261012T080000Z\r\n" + ALARM_15_MIN);
        assertTrue(ReminderSyncWorker.collectEvents("cal", ics, 0, Long.MAX_VALUE, "", out));
        assertEquals(2, out.size());

        out.clear();
        String alarm = "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT99999999999999999999M\r\nEND:VALARM\r\n";
        String tasks = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:a\r\nDUE:20261012T070000Z\r\n" + alarm + "END:VTODO\r\n"
            + "BEGIN:VTODO\r\nUID:b\r\nDUE:20261012T070000Z\r\n" + ALARM_15_MIN + "END:VTODO\r\nEND:VCALENDAR\r\n";
        ReminderSyncWorker.collectTasks("cal", tasks, 0, Long.MAX_VALUE, "", out);
        assertEquals(1, out.size());
        assertTrue(out.get(0).key.startsWith("cal|b|"));
    }

    @Test
    public void parsedTimesSayWhetherTheyFloat() {
        IcsMini.Component ev = IcsMini.parse("BEGIN:VEVENT\r\nA:20261012T070000Z\r\nB;TZID=Europe/Warsaw:20261012T090000\r\nC;VALUE=DATE:20261012\r\nD:20261012T090000\r\nEND:VEVENT\r\n").get(0);
        assertFalse(IcsMini.parseTime(ev.prop("A")).floating);
        assertFalse(IcsMini.parseTime(ev.prop("B")).floating);
        assertTrue(IcsMini.parseTime(ev.prop("C")).floating);
        assertTrue(IcsMini.parseTime(ev.prop("D")).floating);
        assertFalse(IcsMini.parseTime(ev.prop("D")).allDay);
    }

    @Test
    public void readsAZoneItCannotResolveAsLocalTimeThatKeepsItsInstant() {
        TimeZone saved = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"));
            // A Windows zone name, as Exchange writes it: the app resolves it (and an object's own
            // VTIMEZONE), this reader does not. Read here on the device's clock, it is still a
            // zoned time: marking it floating would move a meeting's reminder after a flight.
            String exchange = "DTSTART;TZID=Central European Standard Time:20261012T090000\r\n";
            IcsMini.Component ev = IcsMini.parse("BEGIN:VEVENT\r\nA;TZID=Central European Standard Time:20261012T090000\r\n"
                + "B:20261012T090000\r\nEND:VEVENT\r\n").get(0);
            IcsMini.Time unresolved = IcsMini.parseTime(ev.prop("A"));
            assertFalse(unresolved.floating);
            assertFalse(unresolved.allDay);
            assertEquals(IcsMini.parseTime(ev.prop("B")).millis, unresolved.millis);

            List<Reminder> out = new ArrayList<>();
            assertTrue(ReminderSyncWorker.collectEvents("cal", event("meeting", exchange + ALARM_15_MIN), 0, Long.MAX_VALUE, "", out));
            assertEquals(1, out.size());
            assertFalse(out.get(0).floating);
            assertEquals(unresolved.millis - 15 * 60000, out.get(0).at);
        } finally {
            TimeZone.setDefault(saved);
        }
    }
}
