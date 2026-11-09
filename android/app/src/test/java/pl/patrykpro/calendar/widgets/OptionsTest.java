package pl.patrykpro.calendar.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import pl.patrykpro.calendar.vault.MemoryValues;

public class OptionsTest {
    @Test
    public void defaultsSuitEveryKind() {
        WidgetOptions o = WidgetOptions.fromJson(null);
        assertEquals(WidgetOptions.CALENDARS_APP, o.calendars);
        assertTrue(o.chosen.isEmpty());
        assertEquals(7, o.days);
        assertTrue(o.tasks);
        assertTrue(o.place);
        assertTrue(o.undated);
        assertEquals(WidgetOptions.THEME_SYSTEM, o.theme);
        assertEquals(100, o.opacity);
        assertEquals(255, o.alpha());
    }

    @Test
    public void keepsWhatWasSet() {
        WidgetOptions o = new WidgetOptions();
        o.calendars = WidgetOptions.CALENDARS_CHOSEN;
        o.chosen.add("local|work");
        o.chosen.add("dav|https://example.org/cal/home/");
        o.days = 31;
        o.tasks = false;
        o.place = false;
        o.undated = false;
        o.theme = WidgetOptions.THEME_DARK;
        o.opacity = 40;
        WidgetOptions back = WidgetOptions.fromJson(o.toJson());
        assertEquals(WidgetOptions.CALENDARS_CHOSEN, back.calendars);
        assertEquals(o.chosen, back.chosen);
        assertEquals(31, back.days);
        assertFalse(back.tasks);
        assertFalse(back.place);
        assertFalse(back.undated);
        assertEquals(WidgetOptions.THEME_DARK, back.theme);
        assertEquals(40, back.opacity);
        assertEquals(102, back.alpha());
    }

    @Test
    public void fallsBackOnWhatItCannotUse() {
        for (String json : new String[] {"", "not json", "[]", "{\"calendars\": 7, \"days\": 5, \"theme\": -1, \"opacity\": 400}"}) {
            WidgetOptions o = WidgetOptions.fromJson(json);
            assertEquals(json, WidgetOptions.CALENDARS_APP, o.calendars);
            assertEquals(json, 7, o.days);
            assertEquals(json, WidgetOptions.THEME_SYSTEM, o.theme);
        }
        assertEquals(100, WidgetOptions.fromJson("{\"opacity\": 400}").opacity);
        assertEquals(0, WidgetOptions.fromJson("{\"opacity\": -3}").opacity);
        assertTrue(WidgetOptions.fromJson("{\"chosen\": [1, \"\", null]}").chosen.isEmpty());
        for (int days : WidgetOptions.DAY_CHOICES) assertEquals(days, WidgetOptions.validDays(days));
        assertEquals(7, WidgetOptions.validDays(2));
    }

    @Test
    public void choosesCalendarsAsTheAppDoesOrAsSet() {
        Snapshot s = Snap.november()
            .calendar("shown", "Shown", "#1d6cd6", true, true, true)
            .calendar("hidden", "Hidden", "#1b8037", true, true, false)
            .parse();
        WidgetOptions app = new WidgetOptions();
        assertTrue(app.shows("shown", s));
        assertFalse(app.shows("hidden", s));
        // A calendar the snapshot does not name: the web app put its items in, so the app shows them.
        assertTrue(app.shows("unnamed", s));

        WidgetOptions all = new WidgetOptions();
        all.calendars = WidgetOptions.CALENDARS_ALL;
        assertTrue(all.shows("hidden", s));

        WidgetOptions chosen = new WidgetOptions();
        chosen.calendars = WidgetOptions.CALENDARS_CHOSEN;
        chosen.chosen.add("hidden");
        assertTrue(chosen.shows("hidden", s));
        assertFalse(chosen.shows("shown", s));
        assertFalse(chosen.shows("unnamed", s));

        // Nothing chosen is the app's choice.
        WidgetOptions none = new WidgetOptions();
        none.calendars = WidgetOptions.CALENDARS_CHOSEN;
        assertTrue(none.shows("shown", s));
        assertFalse(none.shows("hidden", s));
    }

    @Test
    public void theStoreKeepsEachWidgetApart() {
        MemoryValues values = new MemoryValues();
        OptionsStore store = new OptionsStore(values);
        assertFalse(store.hasOptions(3));
        assertEquals(7, store.options(3).days);
        WidgetOptions o = new WidgetOptions();
        o.days = 14;
        store.save(3, o);
        assertTrue(store.hasOptions(3));
        assertEquals(14, store.options(3).days);
        assertEquals(7, store.options(4).days);

        int today = Days.parse("2026-11-09");
        store.setMonthOffset(3, 2, today);
        assertEquals(2, store.monthOffset(3, today));
        // The next day starts on the current month again.
        assertEquals(0, store.monthOffset(3, today + 1));
        assertEquals(0, store.monthOffset(4, today));
        store.setMonthOffset(3, 0, today);
        assertEquals(0, store.monthOffset(3, today));

        store.setMonthOffset(3, -1, today);
        store.forget(3);
        assertFalse(store.hasOptions(3));
        assertEquals(0, store.monthOffset(3, today));
        assertTrue(values.map.isEmpty());
    }

    @Test
    public void theStoreKeepsThePlacedWidgetsAndTheLanguage() {
        OptionsStore store = new OptionsStore(new MemoryValues());
        assertEquals("", store.placed());
        store.setPlaced("AGENDA:3;MONTH:5");
        assertEquals("AGENDA:3;MONTH:5", store.placed());
        assertNull(store.lang());
        store.setLang("pl");
        assertEquals("pl", store.lang());
        store.setLang(null);
        assertNull(store.lang());
    }
}
