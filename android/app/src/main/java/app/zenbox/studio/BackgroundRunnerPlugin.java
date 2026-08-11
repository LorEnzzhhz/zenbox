package app.zenbox.studio;

import android.content.Intent;
import android.os.Build;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Keeps the app alive in the background: starts a foreground service (with a
 *  persistent notification) and disables WebView background throttling, so
 *  streaming replies and sandbox work continue even after the user "exits"
 *  the app. Invoked from the web app via Settings → App & background. */
@CapacitorPlugin(name = "BackgroundRunner")
public class BackgroundRunnerPlugin extends Plugin {

    /** Best-effort: disable WebView background throttling on API 26+ via
     *  reflection (some SDK stub jars omit the static method). */
    private static void setThrottling(boolean enabled) {
        try {
            WebView.class
                    .getMethod("setWebViewBackgroundThrottlingEnabled", boolean.class)
                    .invoke(null, enabled);
        } catch (Exception ignored) {
            // unavailable (API < 26 or stub jar) — the foreground service still keeps us alive
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                // Never freeze the WebView when the app loses focus.
                setThrottling(false);
                Intent intent = new Intent(getActivity(), KeepAliveService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getActivity().startForegroundService(intent);
                } else {
                    getActivity().startService(intent);
                }
                JSObject ret = new JSObject();
                ret.put("started", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to start background service: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().stopService(new Intent(getActivity(), KeepAliveService.class));
                setThrottling(true);
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to stop background service: " + e.getMessage(), e);
            }
        });
    }
}
