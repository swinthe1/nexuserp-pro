# DrisPRO Skaner (Android)

A small Android app for Zebra and other handhelds. On first start it asks where DrisPRO is:

- **Cloud**: https://erp.dris-ks.com
- **Local server**: the shop's own server by its address (e.g. http://192.168.1.20); it is checked through `/drispro-config.js` (`local: true`).

Then it opens `<server>/skaner` full screen in Android's WebView, portrait. Back on the start screen offers "Exit" and "Change server". When the server cannot be reached it opens what the device kept from the last visit, otherwise a screen to try again or change the server.

The device manager can set the server for all devices (Zebra StageNow / MDM managed configuration, key `server_url`); then the device does not ask and the server cannot be changed on it.

Build (Android SDK, JDK 17+, Gradle 8.9+):

1. Put `signing.properties` next to this file (storeFile, storePassword, keyAlias, keyPassword). The key is kept by the owner, not in git; every update must be signed with the same key.
2. Raise `versionCode` in `app/build.gradle`.
3. `gradle assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
