package com.tiltmaze.game;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends Activity implements SensorEventListener {

    private static final String BASE_URL = "https://tiltmaze.local/";
    private WebView web;
    private SensorManager sm;

    /* 传感器状态（volatile：传感器线程写，JS 桥线程读） */
    /* Teeter 只用重力感应：加速度计给出重力在屏幕平面的分量，
       不需要陀螺仪、不需要角度积分、不需要校准零点漂移。 */
    private volatile float gx = 0f, gy = 0f, gz = 1f;
    private volatile boolean hasReading = false;
    private volatile boolean hasSensor = false;

    /* ---------------- 生命周期 ---------------- */

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.setBackgroundDrawableResource(android.R.color.black);

        web = new WebView(this);
        /* 只在 debuggable 构建里开远程调试，正式包自动关闭 */
        boolean dbg = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(dbg);
        web.setBackgroundColor(Color.parseColor("#0B0E10"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return true;   /* 单机：禁止任何跳转 */
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                /* 健康检查：确认 JS 引擎与游戏内核真的起来了（正式版也保留，便于排障） */
                web.evaluateJavascript(
                        "(window.UI&&UI.inited?'ui-ok':'ui-fail')+':'+"
                                + "(typeof TOTAL_LEVELS==='number'?TOTAL_LEVELS:'?')+':'+"
                                + "(window.NativeTilt&&NativeTilt.hasSensor()?'gyro':'nog')",
                        new android.webkit.ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) {
                                android.util.Log.i("TiltMaze", "health " + value);
                            }
                        });
            }

            @Override
            public void onReceivedError(WebView v, android.webkit.WebResourceRequest req,
                                        android.webkit.WebResourceError err) {
                android.util.Log.e("TiltMaze", "resourceError " + err.getErrorCode() + " " + err.getDescription()
                        + " " + (req == null ? "" : req.getUrl()));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                android.util.Log.i("TiltMaze", "console[" + m.messageLevel() + "] " + m.message()
                        + " @" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "NativeTilt");
        web.addJavascriptInterface(new AppBridge(), "NativeApp");

        setContentView(web);
        goFullscreen();

        sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) {
            Sensor acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (acc != null) {
                hasSensor = true;
                sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_FASTEST);
            }
        }

        loadGame();
    }

    private void loadGame() {
        try {
            InputStream is = getAssets().open("index.html");
            ByteArrayOutputStream bos = new ByteArrayOutputStream(262144);
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            String html = new String(bos.toByteArray(), "UTF-8");
            /* 用虚拟 https origin 加载，避免 file:// 下 localStorage 被限制 */
            web.loadDataWithBaseURL(BASE_URL, html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            web.loadData("<html><body style='background:#0B0E10;color:#EDF1F3;font-family:sans-serif;padding:40px'>"
                    + "资源加载失败：" + e.getMessage() + "</body></html>", "text/html", "UTF-8");
        }
    }

    private static boolean isEmulator() {
        String f = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT;
        String h = Build.HARDWARE == null ? "" : Build.HARDWARE;
        String p = Build.PRODUCT == null ? "" : Build.PRODUCT;
        String m = Build.MODEL == null ? "" : Build.MODEL;
        return f.contains("generic") || f.contains("emulator")
                || h.contains("goldfish") || h.contains("ranchu")
                || p.contains("sdk") || p.contains("emulator")
                || m.contains("Emulator") || m.contains("Android SDK");
    }

    private void goFullscreen() {
        Window w = getWindow();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                w.setDecorFitsSystemWindows(false);
                WindowInsetsController c = w.getInsetsController();
                if (c != null) {
                    c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            }
            /* 低版本也要走一遍旧 flag，保证兼容 */
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } catch (Throwable ignored) { }
    }

    @Override
    public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (has) goFullscreen();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (sm != null && hasSensor) {
            Sensor acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (acc != null) sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_FASTEST);
        }
        if (web != null) web.onResume();
        /* 回到前台：让游戏自动暂停，避免后台掉球 */
        if (web != null) {
            web.post(new Runnable() {
                public void run() {
                    web.evaluateJavascript("window.__nativeResume&&window.__nativeResume()", null);
                }
            });
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (sm != null) sm.unregisterListener(this);
        if (web != null) {
            web.evaluateJavascript("window.__nativePause&&window.__nativePause()", null);
            web.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("NativeTilt");
            web.removeJavascriptInterface("NativeApp");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ---------------- 返回键 ---------------- */

    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript(
                "(function(){return (window.onAndroidBack && window.onAndroidBack()) ? 1 : 0;})()",
                new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"1".equals(value)) finish();
                    }
                });
    }

    /* ---------------- 传感器 ---------------- */

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() != Sensor.TYPE_ACCELEROMETER) return;
        float x = e.values[0], y = e.values[1], z = e.values[2];
        double n = Math.sqrt(x * x + y * y + z * z);
        if (n < 1.0) return;              /* 失重/异常读数丢弃 */
        /* 归一化到 1g：右倾 x>0，顶部抬起 y>0，平放时 x=y=0 */
        gx = (float) (x / n);
        gy = (float) (y / n);
        gz = (float) (z / n);
        hasReading = true;
    }

    @Override
    public void onAccuracyChanged(Sensor s, int accuracy) { }

    /* ---------------- JS 桥 ---------------- */

    private class Bridge {
        @JavascriptInterface
        public String tilt() {
            if (!hasReading) return "";
            return gx + "," + gy + "," + gz;
        }

        @JavascriptInterface
        public boolean hasSensor() {
            return hasSensor;
        }
    }

    private class AppBridge {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                public void run() { finish(); }
            });
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(ms, 120));
                } else {
                    v.vibrate(ms);
                }
            } catch (Throwable ignored) { }
        }
    }
}
