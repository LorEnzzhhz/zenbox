package app.zenbox.control;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * ApkUpdater — downloads a real .apk from the update's apkUrl and hands it to
 * Android's package installer. The OS installs it and, when the user opens the
 * new version, the updated app runs from there on.
 *
 * Called from the web layer as:
 *   Capacitor.Plugins.ApkUpdater.downloadAndInstall({ url: "https://…/app.apk" })
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Missing APK url");
            return;
        }
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Invalid APK url — it must start with http(s)://");
            return;
        }

        // Downloads must not run on the UI thread.
        new Thread(() -> {
            try {
                final File apk = download(url.trim());
                if (apk == null || !apk.exists() || apk.length() == 0) {
                    call.reject("Downloaded file is empty or unreadable.");
                    return;
                }
                final Intent intent = buildInstallIntent(apk);
                bridge.getActivity().runOnUiThread(() -> {
                    try {
                        bridge.getActivity().startActivity(intent);
                        JSObject ret = new JSObject();
                        ret.put("installed", true);
                        call.resolve(ret);
                    } catch (ActivityNotFoundException e) {
                        call.reject(
                                "This device has no app installer for this file. Make sure “Install unknown apps” is allowed for Zenbox Control, then try again.",
                                e);
                    } catch (Exception e) {
                        call.reject("Could not start the installer: " + e.getMessage(), e);
                    }
                });
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        }).start();
    }

    /** Stream the APK from the network into the app's private external storage. */
    private File download(String urlStr) throws Exception {
        File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new Exception("Could not create the download folder.");
        }

        String name = "zenbox-update.apk";
        try {
            String path = new URL(urlStr).getPath();
            String file = path.substring(path.lastIndexOf('/') + 1);
            if (file.endsWith(".apk") && file.length() > 4) name = file;
        } catch (Exception ignored) {
            // fall back to the default name
        }

        File apk = new File(dir, name);
        if (apk.exists() && !apk.delete()) {
            apk = new File(dir, "zenbox-update-" + System.currentTimeMillis() + ".apk");
        }

        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(120_000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", "ZenboxControl/1.0");

        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new Exception("Download failed (HTTP " + code + ").");
            }
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                byte[] buf = new byte[8192];
                int n;
                long total = 0;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    total += n;
                }
                if (total == 0) throw new Exception("Downloaded file is empty.");
            }
        } finally {
            conn.disconnect();
        }
        return apk;
    }

    /** Build the ACTION_VIEW intent that launches the package installer. */
    private Intent buildInstallIntent(File apk) {
        Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }
}
