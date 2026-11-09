package pl.patrykpro.calendar.widgets;

/** The Agenda widget: the coming days, day by day, as a list ({@link Agenda}). */
public class AgendaWidget extends BaseWidget {
    @Override
    WidgetKind kind() {
        return WidgetKind.AGENDA;
    }
}
