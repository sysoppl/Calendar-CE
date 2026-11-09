package pl.patrykpro.calendar.widgets;

/** The Today widget: today's date and what is next today ({@link TodayPick}). */
public class TodayWidget extends BaseWidget {
    @Override
    WidgetKind kind() {
        return WidgetKind.TODAY;
    }
}
