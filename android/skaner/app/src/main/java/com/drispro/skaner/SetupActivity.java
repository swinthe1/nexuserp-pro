package com.drispro.skaner;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

/** First start: where is DrisPRO, the cloud or the shop's local server? Asked once, like the Windows program. */
public class SetupActivity extends Activity {
    private RadioButton cloud, local;
    private EditText addr;
    private TextView msg;
    private Button go;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        boolean change = getIntent().getBooleanExtra("change", false);
        if (!change && Server.get(this) != null) { open(); return; }
        setContentView(build());
        String now = Server.get(this);
        if (now != null && !now.equals(Server.CLOUD)) { local.setChecked(true); addr.setText(now); }
        else cloud.setChecked(true);
        pick();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private View build() {
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.parseColor("#F5F8F7"));
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(24), dp(32), dp(24), dp(24));
        sv.addView(col);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        col.addView(logo, new LinearLayout.LayoutParams(dp(64), dp(64)));

        TextView h = new TextView(this);
        h.setText("DrisPRO Skaner");
        h.setTextSize(26); h.setTypeface(Typeface.DEFAULT_BOLD); h.setTextColor(Color.parseColor("#0E2A33"));
        h.setPadding(0, dp(16), 0, dp(4));
        col.addView(h);

        TextView p = new TextView(this);
        p.setText("Ku ruhen të dhënat e kompanisë?");
        p.setTextSize(16); p.setTextColor(Color.parseColor("#4A5B60"));
        p.setPadding(0, 0, 0, dp(16));
        col.addView(p);

        RadioGroup g = new RadioGroup(this);
        cloud = choice("Cloud (serveri i DrisPRO)\napp.drispro.com, me internet");
        local = choice("Server lokal\nServeri në lokalin tuaj, punon edhe pa internet");
        g.addView(cloud); g.addView(spacer(10)); g.addView(local);
        g.setOnCheckedChangeListener((gr, id) -> pick());
        col.addView(g);

        addr = new EditText(this);
        addr.setHint("http://192.168.1.20");
        addr.setSingleLine(true);
        addr.setTextSize(18);
        addr.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addr.setImeOptions(EditorInfo.IME_ACTION_GO);
        addr.setOnEditorActionListener((v, a, e) -> { connect(); return true; });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(16);
        col.addView(addr, lp);

        msg = new TextView(this);
        msg.setTextSize(14);
        msg.setPadding(0, dp(12), 0, dp(12));
        col.addView(msg);

        go = new Button(this);
        go.setText("Lidhu");
        go.setTextSize(18); go.setAllCaps(false); go.setTextColor(Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#0E8A5F")); bg.setCornerRadius(dp(12));
        go.setBackground(bg);
        go.setOnClickListener(v -> connect());
        col.addView(go, new LinearLayout.LayoutParams(-1, dp(56)));
        return sv;
    }

    private RadioButton choice(String text) {
        RadioButton r = new RadioButton(this);
        r.setId(View.generateViewId());
        r.setText(text);
        r.setTextSize(16);
        r.setTextColor(Color.parseColor("#0E2A33"));
        r.setPadding(dp(8), dp(14), dp(8), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE); bg.setCornerRadius(dp(12)); bg.setStroke(dp(1), Color.parseColor("#DCE6E2"));
        r.setBackground(bg);
        r.setLayoutParams(new RadioGroup.LayoutParams(-1, -2));
        return r;
    }

    private View spacer(int h) { View v = new View(this); v.setLayoutParams(new RadioGroup.LayoutParams(1, dp(h))); return v; }

    private void pick() {
        addr.setVisibility(local.isChecked() ? View.VISIBLE : View.GONE);
        msg.setText("");
        if (local.isChecked()) addr.requestFocus();
    }

    private void say(String t, boolean bad) {
        msg.setTextColor(Color.parseColor(bad ? "#B42318" : "#4A5B60"));
        msg.setText(t);
    }

    private void connect() {
        if (cloud.isChecked()) { Server.set(this, Server.CLOUD); open(); return; }
        String origin = Server.normalise(addr.getText().toString());
        if (origin == null) { say("Shkruani adresën e serverit, p.sh. http://192.168.1.20", true); return; }
        say("Po kërkohet serveri…", false);
        go.setEnabled(false);
        new Thread(() -> {
            boolean ok = Server.isLocalDrisPRO(origin);
            runOnUiThread(() -> {
                go.setEnabled(true);
                if (!ok) { say("Në " + origin + " nuk u gjet një server lokal i DrisPRO. Kontrolloni adresën, që serveri është ndezur dhe që pajisja është në Wi-Fi-n e lokalit.", true); return; }
                Server.set(this, origin);
                open();
            });
        }).start();
    }

    private void open() {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }
}
