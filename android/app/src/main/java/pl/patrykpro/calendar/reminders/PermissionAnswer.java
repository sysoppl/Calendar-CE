package pl.patrykpro.calendar.reminders;

/**
 * Whether the system showed its permission dialog for a request. Android says
 * nothing about it: a person who turned the permission down for good, and a
 * request the system dropped (one made while another was still open), both
 * get an answer within a few frames, while nobody answers a dialog that fast.
 */
final class PermissionAnswer {
    /** An answer sooner than this came without a dialog on screen. */
    static final long SHOWN_AFTER_MS = 400;

    private PermissionAnswer() {}

    /** True when the answer came late enough for a person to have answered a dialog. */
    static boolean wasShown(long askedAt, long answeredAt) {
        return askedAt > 0 && answeredAt - askedAt >= SHOWN_AFTER_MS;
    }
}
