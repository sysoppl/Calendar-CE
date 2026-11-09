package pl.patrykpro.calendar.widgets;

/** The Tasks widget: the open tasks, each with a circle that marks it done ({@link TaskRows}). */
public class TasksWidget extends BaseWidget {
    @Override
    WidgetKind kind() {
        return WidgetKind.TASKS;
    }
}
