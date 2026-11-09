package pl.patrykpro.calendar.widgets;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.Configuration;
import android.text.format.DateFormat;

import java.util.Locale;
import java.util.TimeZone;

import pl.patrykpro.calendar.R;

/**
 * The language of the widgets: the app's, which the snapshot names, rather
 * than the phone's. Someone who reads the app in Polish on an English phone
 * gets "Dziś" on the home screen too.
 *
 * Two locales come out of a language, as in the web app (src/i18n/index.ts):
 * the resources' (Brazilian Portuguese is the app's Portuguese, so "pt" reads
 * values-pt-rBR), and the one dates are formatted in, which is the phone's own
 * variant of the language when it has one (en-GB, de-AT, pt-PT) and the
 * usual one otherwise (en-US, de-DE, pt-BR).
 *
 * Without a language (no snapshot yet) everything follows the phone.
 */
final class Texts {
    private Texts() {}

    private static Locale system() {
        return Locale.getDefault();
    }

    private static Locale locale(String language, String region) {
        return new Locale.Builder().setLanguage(language).setRegion(region).build();
    }

    /** The locale whose string resources the widgets use. */
    static Locale resourceLocale(String lang) {
        if (lang == null) return system();
        if ("pt".equals(lang)) return locale("pt", "BR");
        return new Locale.Builder().setLanguage(lang).build();
    }

    /** The locale dates and times are formatted in. */
    static Locale formatLocale(String lang) {
        Locale device = system();
        if (lang == null) return device;
        if (!"pl".equals(lang) && lang.equals(device.getLanguage())) return device;
        switch (lang) {
            case "en": return locale("en", "US");
            case "pt": return locale("pt", "BR");
            case "uk": return locale("uk", "UA");
            case "cs": return locale("cs", "CZ");
            default: return locale(lang, lang.toUpperCase(Locale.ROOT));
        }
    }

    /**
     * A context whose resources speak {@code lang}. Every language's strings
     * are in the app: the store's bundle does not split them (build.gradle).
     */
    @SuppressLint("AppBundleLocaleChanges")
    static Context localized(Context context, String lang) {
        if (lang == null) return context;
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.setLocale(resourceLocale(lang));
        return context.createConfigurationContext(config);
    }

    /** The labels for a snapshot: its language and its clock, in the device's time zone. */
    static Labels labels(Context localized, String lang, boolean hour12) {
        Locale locale = formatLocale(lang);
        Labels.Words words = new Labels.Words(
            localized.getString(R.string.widget_today),
            localized.getString(R.string.widget_tomorrow),
            localized.getString(R.string.widget_all_day),
            localized.getString(R.string.widget_from_time),
            localized.getString(R.string.widget_until_time),
            localized.getString(R.string.widget_time_range));
        Labels.Patterns patterns = new Labels.Patterns(
            DateFormat.getBestDateTimePattern(locale, hour12 ? "hm" : "Hm"),
            DateFormat.getBestDateTimePattern(locale, "EEEdMMM"),
            DateFormat.getBestDateTimePattern(locale, "dMMM"),
            DateFormat.getBestDateTimePattern(locale, "dMMMy"),
            DateFormat.getBestDateTimePattern(locale, "LLLLy"),
            DateFormat.getBestDateTimePattern(locale, "dMMMM"));
        return new Labels(locale, TimeZone.getDefault(), words, patterns);
    }

    /**
     * The weekdays' initials, Sunday first, as the language writes them over a
     * month ("M T W T F S S", "P W Ś C P S N").
     */
    static String[] weekInitials(Locale locale) {
        String[] narrow = android.icu.text.DateFormatSymbols.getInstance(locale)
            .getWeekdays(android.icu.text.DateFormatSymbols.STANDALONE, android.icu.text.DateFormatSymbols.NARROW);
        String[] out = new String[7];
        for (int i = 0; i < 7; i++) {
            // ICU counts from 1 (Sunday); index 0 is empty.
            String name = i + 1 < narrow.length ? narrow[i + 1] : "";
            out[i] = name == null ? "" : name.toUpperCase(locale);
        }
        return out;
    }
}
