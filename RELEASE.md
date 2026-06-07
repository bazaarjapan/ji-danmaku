# Release Guide

This project supports free distribution outside the Mac App Store.

## Release Types

- Development build: unsigned, for local testing and limited distribution.
- macOS release build: Developer ID signed and notarized.
- Windows release build: NSIS installer and portable executable. Windows code signing can be added later without changing app logic.

## Unsigned macOS Build Policy

The current macOS distribution path uses the unsigned development build. This avoids Apple Developer Program costs, but users must manually approve the app on first launch.

Build artifacts:

```sh
npm run dist:mac
```

Expected files:

```text
dist/Ji-Reaction-<version>-arm64.dmg
dist/Ji-Reaction-<version>-arm64-mac.zip
```

User launch instructions:

1. Copy `Ji-Reaction.app` to `Applications`.
2. Right-click `Ji-Reaction.app` and choose `Open`.
3. Choose `Open` again in the Gatekeeper warning dialog.
4. Grant Screen Recording, Microphone, and Accessibility permissions as needed.

For development machines only, quarantine can be removed manually:

```sh
xattr -dr com.apple.quarantine /Applications/Ji-Reaction.app
```

Do not present unsigned macOS artifacts as notarized or Gatekeeper-approved builds.

## Required macOS Credentials

macOS release builds require a `Developer ID Application` certificate in the keychain.

Check the installed signing identities:

```sh
security find-identity -v -p codesigning
```

The output must include a valid identity like:

```text
Developer ID Application: Your Name (TEAMID)
```

For local notarization, store Apple notarization credentials in the macOS Keychain:

```sh
xcrun notarytool store-credentials "ji-reaction-notary" \
  --apple-id "apple-id@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
```

Then set:

```sh
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_NOTARY_KEYCHAIN_PROFILE="ji-reaction-notary"
```

For CI, set these environment variables before running a macOS release build:

```sh
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
```

`APPLE_APP_SPECIFIC_PASSWORD` must be an app-specific password, not the normal Apple ID password.

## Local Release Commands

Run checks first:

```sh
npm ci
npm test
rg --files -g '*.js' -g '!node_modules/**' | xargs -n 1 node --check
```

Build unsigned local artifacts:

```sh
npm run dist:win
npm run dist:mac
```

Build signed/notarized macOS release artifacts:

```sh
npm run dist:mac:release
```

Build all release artifacts:

```sh
npm run dist:release
```

## GitHub Secrets

For `.github/workflows/release.yml`, configure:

- `MACOS_CERTIFICATE`: base64-encoded `.p12` Developer ID Application certificate
- `MACOS_CERTIFICATE_PASSWORD`: password for the `.p12`
- `KEYCHAIN_PASSWORD`: temporary CI keychain password
- `APPLE_ID`: Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password
- `APPLE_TEAM_ID`: Apple Developer Team ID
- `CSC_NAME`: Developer ID identity name

## Manual QA Before Publishing

- macOS: install from DMG, launch, pass Gatekeeper, grant Screen Recording and Microphone permissions.
- macOS: verify Dock/menu bar controls, start/stop, emergency stop, Codex diagnostics, and mic threshold behavior.
- Windows: install Setup EXE on a real Windows 10/11 machine, verify tray icon, start/stop, emergency stop, microphone permission, and mic threshold behavior.
- Windows: verify Portable EXE starts without installer state conflicts.

## Publishing

1. Create a tag such as `v1.0.3`.
2. Run the release workflow manually or build locally.
3. Upload artifacts from `dist/` to GitHub Releases.
4. Mark the release as free distribution and include the macOS permission notes from README.
