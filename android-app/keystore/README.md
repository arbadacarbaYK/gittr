# gittr Android signing

Release APKs are signed so Zapstore / NIP-82 can treat them as a stable Android package (`space.gittr.app`).

## Default CI key (in this folder)

`gittr-ci.p12` is a **public CI signing key** for GitHub Actions. Password and alias are in the workflow / Gradle defaults (`gittr` / `gittr-android-ci`). Anyone with the repo can produce an APK with the same signature — this is **not** a Play Store upload key.

SHA-256 cert fingerprint (Digital Asset Links):

```
98:45:6F:B8:CF:F2:F0:71:24:86:2B:41:43:3D:B0:B6:A7:09:2D:8F:2C:3B:63:8A:A8:F2:0A:EA:98:E5:05:17
```

Served at `https://gittr.space/.well-known/assetlinks.json`.

## Stronger key (optional)

To use a private keystore, set GitHub Actions secrets (they override the committed key):

- `ANDROID_KEYSTORE_BASE64` — PKCS12/JKS file, base64
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Changing the cert later means Zapstore NIP-C1 cert-linking and `assetlinks.json` must be updated. Prefer doing that **before** the first public Zapstore listing.
