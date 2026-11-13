package com.drispro.skaner;

import android.content.Context;
import android.content.RestrictionsManager;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/** Where DrisPRO lives for this device: the cloud or the shop's own local server. */
final class Server {
    static final String CLOUD = "https://app.drispro.com";
    private static final String PREFS = "drispro";
    private static final String KEY = "server";

    private Server() {}

    /** set by the device manager (StageNow / MDM); when present it wins and cannot be changed on the device */
    static String managed(Context c) {
        try {
            RestrictionsManager rm = (RestrictionsManager) c.getSystemService(Context.RESTRICTIONS_SERVICE);
            Bundle b = rm == null ? null : rm.getApplicationRestrictions();
            String v = b == null ? null : b.getString("server_url");
            return v == null || v.trim().isEmpty() ? null : normalise(v);
        } catch (Exception e) { return null; }
    }

    static String get(Context c) {
        String m = managed(c);
        if (m != null) return m;
        String v = prefs(c).getString(KEY, null);
        // DrisPRO moved from erp.dris-ks.com to app.drispro.com: a device set to the old address follows by itself
        if ("https://erp.dris-ks.com".equals(v)) { set(c, CLOUD); return CLOUD; }
        return v;
    }

    static void set(Context c, String origin) { prefs(c).edit().putString(KEY, origin).apply(); }
    static void clear(Context c) { prefs(c).edit().remove(KEY).apply(); }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** "192.168.1.20", "http://192.168.1.20:8080/skaner" → "http://192.168.1.20" / "http://192.168.1.20:8080" */
    static String normalise(String raw) {
        String s = raw.trim();
        if (s.isEmpty()) return null;
        if (!s.matches("(?i)^https?://.*")) s = "http://" + s;
        Uri u = Uri.parse(s);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        String origin = u.getScheme().toLowerCase(java.util.Locale.ROOT) + "://" + u.getHost();
        if (u.getPort() > 0) origin += ":" + u.getPort();
        return origin;
    }

    /** a DrisPRO local server answers /drispro-config.js with "local: true" (an older one under its former name) */
    static boolean isLocalDrisPRO(String origin) {
        return configSaysLocal(origin + "/drispro-config.js") || configSaysLocal(origin + "/nexus-config.js");
    }

    private static boolean configSaysLocal(String url) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(5000);
            con.setReadTimeout(5000);
            con.setUseCaches(false);
            if (con.getResponseCode() != 200) return false;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(con.getInputStream()))) {
                String line; while ((line = r.readLine()) != null && sb.length() < 4096) sb.append(line);
            }
            return sb.toString().matches("(?s).*local:\\s*true.*");
        } catch (Exception e) {
            return false;
        } finally { if (con != null) con.disconnect(); }
    }
}
