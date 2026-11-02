package com.drispro.skaner;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** DrisPRO Skaner: the web app's /skaner screens, full screen, from the cloud or the shop's local server. */
public class MainActivity extends Activity {
    private static final int CAMERA = 7;
    private WebView web;
    private View offline;
    private TextView offlineText;
    private String server;
    private boolean triedCache;
    private PermissionRequest pendingCamera;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        server = Server.get(this);
        if (server == null) { startActivity(new Intent(this, SetupActivity.class)); finish(); return; }

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        offline = buildOffline();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " DrisPROSkaner/" + BuildConfig.VERSION_NAME);
        s.setCacheMode(online() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (sameServer(u)) return false;
                // links to other sites open in the browser
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (online()) v.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (!r.isForMainFrame()) return;
                // no connection to the server: open what the device kept from the last visit
                if (!triedCache) {
                    triedCache = true;
                    v.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                    v.loadUrl(server + "/skaner");
                    return;
                }
                showOffline();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                boolean wantsCamera = false;
                for (String res : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) wantsCamera = true;
                if (!wantsCamera) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                } else {
                    pendingCamera = request;
                    requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA);
                }
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(server + "/skaner");
    }

    private boolean sameServer(Uri u) {
        Uri s = Uri.parse(server);
        return s.getScheme().equalsIgnoreCase(u.getScheme()) && s.getHost().equalsIgnoreCase(u.getHost()) && s.getPort() == u.getPort();
    }

    @SuppressWarnings("deprecation")
    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private View buildOffline() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setPadding(dp(28), dp(28), dp(28), dp(28));
        col.setBackgroundColor(Color.parseColor("#F5F8F7"));
        col.setClickable(true);

        TextView h = new TextView(this);
        h.setText("Serveri nuk u gjet");
        h.setTextSize(22); h.setTypeface(Typeface.DEFAULT_BOLD); h.setTextColor(Color.parseColor("#0E2A33"));
        h.setGravity(Gravity.CENTER);
        col.addView(h);

        offlineText = new TextView(this);
        offlineText.setTextSize(15); offlineText.setTextColor(Color.parseColor("#4A5B60"));
        offlineText.setGravity(Gravity.CENTER);
        offlineText.setPadding(0, dp(10), 0, dp(24));
        col.addView(offlineText);

        col.addView(button("Provo përsëri", true, v -> retry()), new LinearLayout.LayoutParams(-1, dp(56)));
        if (Server.managed(this) == null) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(56));
            lp.topMargin = dp(12);
            col.addView(button("Ndrysho serverin", false, v -> changeServer()), lp);
        }
        return col;
    }

    private Button button(String text, boolean primary, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text); b.setAllCaps(false); b.setTextSize(17);
        b.setTextColor(primary ? Color.WHITE : Color.parseColor("#0E2A33"));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(primary ? Color.parseColor("#0E8A5F") : Color.WHITE);
        bg.setCornerRadius(dp(12));
        if (!primary) bg.setStroke(dp(1), Color.parseColor("#DCE6E2"));
        b.setBackground(bg);
        b.setOnClickListener(l);
        return b;
    }

    private void showOffline() {
        offlineText.setText(server.equals(Server.CLOUD)
            ? "Pajisja nuk ka internet. Lidheni me Wi-Fi dhe provoni përsëri."
            : "Pajisja nuk po lidhet me serverin lokal " + server + ". Kontrolloni që është në Wi-Fi-n e lokalit dhe që serveri është ndezur.");
        offline.setVisibility(View.VISIBLE);
    }

    private void retry() {
        offline.setVisibility(View.GONE);
        triedCache = false;
        web.getSettings().setCacheMode(online() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        web.loadUrl(server + "/skaner");
    }

    private void changeServer() {
        startActivity(new Intent(this, SetupActivity.class).putExtra("change", true));
        finish();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != CAMERA || pendingCamera == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
            pendingCamera.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        else pendingCamera.deny();
        pendingCamera = null;
    }

    @Override
    public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) { super.onBackPressed(); return; }
        String path = Uri.parse(String.valueOf(web.getUrl())).getPath();
        boolean home = path == null || path.equals("/skaner") || path.equals("/skaner/");
        if (!home && web.canGoBack()) { web.goBack(); return; }
        AlertDialog.Builder d = new AlertDialog.Builder(this)
            .setTitle("DrisPRO Skaner")
            .setMessage("Lidhur me: " + server)
            .setPositiveButton("Dil", (x, y) -> finish())
            .setNeutralButton("Anulo", null);
        if (Server.managed(this) == null) d.setNegativeButton("Ndrysho serverin", (x, y) -> changeServer());
        d.show();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); if (web != null) web.saveState(out); }

    @Override
    protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}
