package app.zenbox.control;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkUpdaterPlugin.class);
        registerPlugin(BackgroundRunnerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onBackPressed() {
        // "Exit" moves the app to the background instead of killing it, so
        // streams and background work keep running (see KeepAliveService).
        moveTaskToBack(true);
    }
}
