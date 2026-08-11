# Zenbox APKs

Signed Android builds for **Zenbox** (AI studio) and **Zenbox Control** (developer updater).

- `zenbox.apk` — Zenbox Studio (app.zenbox.studio)
- `zenbox-control.apk` — Zenbox Control (app.zenbox.control)

## Wire in-app updates

1. Build both APKs: `npm run apk:build` and `npm run apk:build:control`
2. Publish a release (GitHub Actions on a tag, or `npm run apk:release -- you/zenbox vX.Y`)
3. Paste the asset URL into the Control app APK download field