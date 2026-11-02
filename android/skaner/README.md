# DrisPRO Skaner (Android)

A small Android app that opens https://erp.dris-ks.com/skaner full screen: a Trusted Web Activity in Chrome when the device has it, Android's WebView otherwise (Zebra devices without Google services). Offline work comes from the web app itself (its service worker and offline queue).

Build (needs the Android SDK, JDK 17+ and Gradle 8.9+):

1. Put `signing.properties` next to this file (storeFile, storePassword, keyAlias, keyPassword). The key is kept by the owner, not in git. Every update must be signed with the same key.
2. `gradle assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
3. Raise `versionCode` in `app/build.gradle` for each new APK.

`public/.well-known/assetlinks.json` in the web app must list the key's SHA-256, or Chrome shows an address bar.
