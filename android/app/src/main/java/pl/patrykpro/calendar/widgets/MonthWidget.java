package pl.patrykpro.calendar.widgets;

/** The Month widget: the month with a dot per event, moved with its arrows ({@link MonthGrid}). */
public class MonthWidget extends BaseWidget {
    @Override
    WidgetKind kind() {
        return WidgetKind.MONTH;
    }
}
