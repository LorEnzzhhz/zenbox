# Building Zenbox as a standalone Android APK

Zenbox is a web app (React + Vite + **Convex** backend).

> ✅ **Both APKs are already in this repo, under `apk/`:**
>
> | APK | Size | App |
> | --- | --- | --- |
> | `apk/zenbox-debug.apk` | ~18 MB | **Zenbox** studio (chat / code / image / deep research + sandbox) |
> | `apk/zenbox-control-debug.apk` | ~18 MB | **Zenbox Control** (developer updater: plan → revise → review → ship) |
>
> They are debug-signed with the full web app bundled inside, compiled with
> JDK 21 + Android SDK 36. Install with `adb install apk/zenbox-debug.apk` or
> copy the file to your phone and open it. See **Publishing on GitHub** below
> for the release workflow.

To rebuild it yourself, everything is set up: JDK 21, Android SDK at
`/opt/android` (platform 36), and the Gradle project at `android/`.

```bash
npm run build          # rebuild web app (tsc + vite)
npx cap sync android   # copy dist into the Android project
cd android && ANDROID_HOME=/opt/android ./gradlew assembleDebug
# output: android/app/build/outputs/apk/debug/app-debug.apk
```

> **Why deployment matters:** this bundled APK is a real standalone app — it
> serves the built web app from `https://localhost` inside the WebView and
> works fully offline for the UI. Login happens in-app (email one-time code,
> email + password, or guest code — no hosted origin or OAuth redirects), so
> accounts work without deploying anything. Features that need the network
> (chat, sandbox downloads, image generation, app updates) use the live Convex
> backend directly. To instead load a hosted deployment of the frontend, set
> `server.url` in `capacitor.config.ts` and rebuild.

---

## Path 1 — Install as a PWA (no APK file, 30 seconds)

On Android: open the deployed site in **Chrome → ⋮ menu → "Install app"** or
"Add to Home screen". Zenbox launches full-screen from its own icon with a
splash screen. This is the fastest way to get a native-feeling app.

The PWA is already install-ready:
- `public/manifest.webmanifest` — standalone display, PNG icons (192/512 + maskable)
- `public/icon-*.png` — generated from the brand mark (`npm run icons` to regen)
- Android launcher icons + black splash already baked into the `android/` project

## Path 2 — One-click APK with a cloud packager (no Android Studio)

1. Deploy the frontend (see Path 3, step 1) and note the HTTPS URL.
2. Open **PWABuilder** (pwabuilder.com), paste the URL, click **Start**.
3. Under *Android*, click **Package for stores** → **Download APK**.
   PWABuilder runs Google's Bubblewrap in the cloud and returns a signed APK —
   no Java or Android SDK needed on your machine.

## Path 3 — Local APK with the bundled Capacitor project (Android Studio)

This repo already contains a complete Android project (`android/`, app id
`app.zenbox.studio`, Zenbox launcher icon + black splash).

1. **Deploy the frontend.** The app's env is `VITE_CONVEX_URL` (already set in
   the project). Any static host works — e.g. Vercel: connect the repo, build
   command `npm run build`, output `dist/`. Note the deployment URL.
2. **Pick a mode in `capacitor.config.ts`:**
   - *Hosted mode (recommended):* uncomment `server.url` and set it to your
     deployment URL. The WebView loads the real origin, so auth cookies and
     token streaming work exactly like the browser.
   - *Bundled mode (default — fully standalone):* the built app is embedded in
     the APK and loaded from `https://localhost`. Works offline for the UI;
     login is in-app (email one-time code, email + password, guest code) so no
     hosted origin is needed. Network features use the live Convex backend.
3. Install Android Studio (or just the Android SDK + JDK 17+).
4. Build the APK:
   ```bash
   npm run apk:build        # builds web app, syncs android/, runs gradle assembleDebug
   # APK output: android/app/build/outputs/apk/debug/app-debug.apk
   ```
   Or open the project in Android Studio (`npm run apk:open`) → **Build → Build
   Bundle(s) / APK(s) → Build APK(s)**.

## Signing for release

Debug APKs install fine for personal use. For distribution, create a keystore
and add a `signingConfigs` block in `android/app/build.gradle`, then run
`./gradlew assembleRelease`.

## Files that matter

| File | Purpose |
| --- | --- |
| `capacitor.config.ts` | App id, name, web dir, optional `server.url` |
| `android/` | Generated Android project (Capacitor 8) |
| `scripts/make-icons.mjs` | Regenerates PWA + Android launcher icons and splash |
| `public/manifest.webmanifest` | PWA install manifest |

---

# Zenbox Control — the updater's own APK

Zenbox Control is a **separate app** from the studio. It is the developer's
updater: command improvements, watch the AI plan → revise → review, and ship
updates that notify every studio user. It shares the same Convex backend but
is built and packaged on its own.

## How the two apps differ

| | Zenbox (studio) | Zenbox Control (updater) |
| --- | --- | --- |
| Entry | `index.html` → `src/main.tsx` | `control.html` → `src/control-main.tsx` |
| Build output | `dist/` | `dist-control/` |
| Android project | `android/` (`app.zenbox.studio`) | `android-control/` (`app.zenbox.control`) |
| Web view | chat studio + sandbox + settings | plan / revise / review pipeline + ship |
| Access | everyone (guests via access code) | developer only (admin)

## Building the Control APK

The Control app has its own Capacitor project: `android-control/` holds the
config (`capacitor.config.json` + a minimal `package.json`), and the Android
platform lives in `android-control/android/`.

```bash
npm run build:control       # tsc + vite build → dist-control/
npm run apk:sync:control    # cap sync into android-control/android/ (own config)
cd android-control/android && ANDROID_HOME=/opt/android ./gradlew assembleDebug
# output: android-control/android/app/build/outputs/apk/debug/app-debug.apk
```

Or in one shot: `npm run apk:build:control`.

Key files:

| File | Purpose |
| --- | --- |
| `control.html` + `src/control-main.tsx` | The Control app's own entry + routes |
| `vite.control.config.ts` | Standalone build (no Vly toolbar, lean bundle) |
| `android-control/capacitor.config.json` | `app.zenbox.control`, webDir `../dist-control` |
| `android-control/android/` | The Control app's Android project |

---

# Shipping an APK update via GitHub Releases

Every release ships **two APKs** — the Zenbox studio app and the Zenbox
Control updater — rebuilt in the cloud by the GitHub Actions workflow
(`.github/workflows/build-apks.yml`) and attached to a **GitHub Release**. No
local Android SDK needed.

## One-time setup

1. **Set the Convex URL secret.** In the repo go to **Settings → Secrets and
   variables → Actions** and add:

   | Secret | Value |
   | --- | --- |
   | `VITE_CONVEX_URL` | `https://<deployment>.convex.cloud` |

   Both apps embed this URL at build time. The workflow fails fast with a
   clear error if it's missing, so you can never publish a broken APK.

2. **Push the repo** (if it isn't on GitHub yet):

   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git add apk/ .github/ android/ android-control/
   git commit -m "Add Zenbox + Zenbox Control APKs and release workflow"
   git push -u origin main
   ```

## The exact ship-an-update checklist

1. **Make your changes** (app code, Control pipeline, anything) and commit
   them.

2. **Bump both Android versions.** Android refuses to install a new APK over
   an existing one unless `versionCode` increases, so **every release needs a
   bump in both projects**:

   - `android/app/build.gradle` → `versionCode` / `versionName` (studio)
   - `android-control/android/app/build.gradle` → `versionCode` / `versionName` (Control)

3. **Commit the bump and tag the release:**

   ```bash
   git add android/app/build.gradle android-control/android/app/build.gradle
   git commit -m "Bump to v2.0"
   git tag v2.0
   git push origin main --tags
   ```

4. **Let GitHub build and publish.** The **Build Zenbox APKs** workflow runs
   on the tag push: it builds both web apps, syncs both Capacitor projects,
   and produces `zenbox-debug.apk` + `zenbox-control-debug.apk`, uploads them
   as workflow artifacts, and creates a **Release** with both APKs attached
   and auto-generated release notes. Watch it under **Actions**.

5. **Wire the in-app APK updater** (recommended for Control users). Release
   asset URLs are predictable:

   ```
   https://github.com/<you>/<repo>/releases/download/v2.0/app-debug.apk
   ```

   Open **Zenbox Control** → run your update pipeline → in the **Ship**
   section paste that URL into the **APK download URL** field, pick **Studio**
   or **Control** in the "This APK is for" selector (so the two apps sharing
   one update feed never install each other's binary), and publish.
   Studio users get the short change notice; the matching APK users who tap
   **Update** now download and install the real new APK in-app (via the
   `ApkUpdaterPlugin`), then reopen on the new version. Failed downloads show
   an error toast instead of hanging on "Downloading…".

## Faster: build without a tag

Push a normal commit and trigger the workflow manually — **Actions → Build
Zenbox APKs → Run workflow**. Both APKs land in the `zenbox-apks` workflow
artifact, but no Release is created (that only happens on tag pushes).

## Manual release without the workflow

```bash
gh release create v2.0 "apk/zenbox-debug.apk" "apk/zenbox-control-debug.apk" \
  --title "Zenbox v2.0" --notes "Both apps"
# or: create the release in the web UI and drag the two APKs into the assets box
```

> The committed `apk/` folder always holds the latest locally-built APKs
> (`zenbox-debug.apk`, `zenbox-control-debug.apk`), downloadable straight from
> the repo. Android build outputs under `android/` / `android-control/` are
> gitignored; the workflow regenerates them on GitHub. Both APKs hit the same
> Convex deployment, so shipping an update from the Control app notifies
> studio users in real time — even across apps.
