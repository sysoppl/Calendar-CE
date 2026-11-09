package pl.patrykpro.calendar;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Saves a text the web app made as a file wherever the user picks, in the
 * system's file picker: the one-file backup, an .ics export. The WebView
 * cannot download, so this is the app's stand-in for the web's download.
 *
 * {@code saveText({ name, text, mimeType })}: the picker offers {@code name}
 * (cleaned, {@link TextFile#safeName}) as a file of {@code mimeType}, one of
 * application/json, text/calendar and text/plain (anything else is taken for
 * plain text). Resolves {@code { result: "saved" | "cancelled" | "failed" }}.
 * One save at a time.
 *
 * The text may be megabytes. It stays in the waiting call only until the
 * picker closes, and never goes into the activity's saved state
 * ({@link #saveInstanceState()}), which would not take it. If Android ended
 * the app while the picker was open, the call and its text are gone when it
 * comes back: the empty document the picker made is removed again.
 */
@CapacitorPlugin(name = "Files")
public class FilesPlugin extends Plugin {
    /** Whether the file picker is open for a save; one at a time. */
    private volatile boolean saving;

    @PluginMethod
    public void saveText(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("Nothing to save");
            return;
        }
        if (saving) {
            call.reject("Already saving");
            return;
        }
        String mimeType = TextFile.mimeType(call.getString("mimeType"));
        Intent pick = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, TextFile.safeName(call.getString("name"), mimeType));
        saving = true;
        try {
            startActivityForResult(call, pick, "fileChosen");
        } catch (ActivityNotFoundException | SecurityException e) {
            // No file picker on this device (some stripped-down builds have none).
            saving = false;
            getBridge().releaseCall(call);
            call.resolve(outcome(TextFile.FAILED));
        }
    }

    /**
     * Capacitor keeps the options of the call that started an activity in the
     * state the system saves while the activity is stopped, which the picker
     * always makes it: here, the whole text, which can be far more than that
     * state may hold. Nothing is saved instead ({@link #fileChosen}).
     */
    @Override
    protected Bundle saveInstanceState() {
        return null;
    }

    @ActivityCallback
    private void fileChosen(PluginCall call, ActivityResult result) {
        saving = false;
        Uri uri = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        ContentResolver resolver = getContext().getContentResolver();
        if (call == null) {
            // The app was started again meanwhile, without the text: an empty
            // file named like a backup is worse than none.
            if (uri != null) getBridge().execute(() -> discard(resolver, uri));
            return;
        }
        getBridge().releaseCall(call);
        if (uri == null) {
            call.resolve(outcome(TextFile.CANCELLED));
            return;
        }
        String text = call.getString("text");
        // Off the main thread: the picked place may be a provider that writes over the network.
        getBridge().execute(() -> call.resolve(outcome(TextFile.write(new TextFile.Target() {
            @Override
            public OutputStream open() throws IOException {
                try {
                    return resolver.openOutputStream(uri, "wt");
                } catch (FileNotFoundException | IllegalArgumentException | UnsupportedOperationException e) {
                    // A provider without "truncate": the document is new and empty anyway.
                    return resolver.openOutputStream(uri, "w");
                }
            }

            @Override
            public void discard() {
                FilesPlugin.discard(resolver, uri);
            }
        }, text))));
    }

    /** Removes a document the picker made, as far as its provider allows. */
    private static void discard(ContentResolver resolver, Uri uri) {
        try {
            DocumentsContract.deleteDocument(resolver, uri);
        } catch (Exception e) {
            // The provider does not delete; the file stays empty or cut short.
        }
    }

    private static JSObject outcome(String result) {
        JSObject out = new JSObject();
        out.put("result", result);
        return out;
    }
}
