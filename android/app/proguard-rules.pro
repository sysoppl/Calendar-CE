# R8 rules of the app's own code (release builds only; see build.gradle).
# Capacitor, WorkManager and OkHttp bring rules of their own (consumer
# rules); these cover what the app adds.

# Names that leave the app or outlive an update stay as they are: the plugins
# the web layer calls by name, and the components the system (alarms,
# notifications, boot, WorkManager's database of scheduled work) starts by
# class name, which an update must still find.
-keep class pl.patrykpro.calendar.**Plugin { *; }
-keep class * extends androidx.work.ListenableWorker { public <init>(...); }
-keep class * extends android.content.BroadcastReceiver { public <init>(...); }

# Stack traces carry line numbers, but no source file names; the build's
# mapping file turns them back into names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# No logging below warnings in a release: debug and info lines are removed
# with everything they would have built.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
