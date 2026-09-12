# gittr Android wrapper

Thin Android app (`space.gittr.app`) that opens **https://gittr.space** in a WebView. It is not an offline copy of the forge and does not bundle Next.js.

Why this exists: Zapstore and other Nostr app stores index **GitHub Release assets**, especially an **APK**. gittr itself is a hosted site + PWA, so this package is the announceable installer those stores expect.

## What it is / is not

- Same live gittr.space UI as the browser PWA (`?source=apk`).
- Sign in with **Amber / NIP-46** (no browser extension inside the WebView).
- External sites open in the system browser; `*.gittr.space` stays in the app.
- Self-hosters still install from the **git repo** ([SETUP_INSTRUCTIONS.md](../docs/SETUP_INSTRUCTIONS.md)). This APK always points at production gittr.space.

## Build

CI (tag `v*` or workflow_dispatch) is the supported path: [`.github/workflows/build-apk.yml`](../.github/workflows/build-apk.yml).

Locally (JDK 17+, Android SDK):

```bash
cd android-app
gradle assembleRelease -PversionName=0.3.0 -PversionCode=300
```

APK: `app/build/outputs/apk/release/app-release.apk`.

Signing uses `keystore/gittr-ci.p12` unless you set `ANDROID_KEYSTORE_FILE` and related env vars (see [keystore/README.md](keystore/README.md)).

## Announce on Nostr

After a GitHub Release has the APK:

1. Open the gittr repo on gittr.space → **Releases** → **Announce on Nostr**, or Code sidebar **Nostr Apps**.
2. Or run `zsp publish -y zapstore.yaml` locally with `SIGN_WITH` (nsec or bunker). Do not put an nsec in GitHub Actions.
