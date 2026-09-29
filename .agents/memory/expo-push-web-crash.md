---
name: Expo push notifications & web preview
description: expo-notifications native APIs crash the Replit web preview; deep-link routing + EAS projectId requirement
---

# Expo push notifications in this project

The Replit preview for the `movil` artifact runs on **web**. Several
`expo-notifications` APIs are native-only and **throw `UnavailabilityError` on
web**, which crashes the whole app (ErrorBoundary "Something went wrong"):
- `Notifications.useLastNotificationResponse()` (calls `getLastNotificationResponse` internally)
- `Notifications.getLastNotificationResponse()` / `getLastNotificationResponseAsync()` on web

**Rule:** any notification-response/deep-link logic must early-return when
`Platform.OS === "web"`. Use `addNotificationResponseReceivedListener` +
`getLastNotificationResponseAsync` inside a web-guarded `useEffect` rather than
the `useLastNotificationResponse()` hook (a hook can't be conditionally called,
so it can't be guarded).

**Why:** the dev preview is web; an unguarded native call there breaks the
entire app, not just push.

# Deep-link payload contract
Backend tags every push `data` with a `type` so a tapped notification can route:
- `message` + `groupId` → chat thread; `announcement` → Tablón; `company_alert`
  → FCT alerts; anything else → notifications tab.
Chat messages are pushed directly (not persisted as in-app notifications) so the
real-time socket owns the foreground case and push owns the closed-app case.

# Standalone delivery requires EAS credentials (manual)
Expo Go uses Expo's shared push creds (no config). Replit's mobile docs confirm
Android push can be tested immediately in Expo Go; iOS push requires an app
build uploaded to TestFlight or the App Store first. For installed/standalone
builds, `getExpoPushTokenAsync` needs `extra.eas.projectId` (populated by
`eas init`) and real APNs/FCM credentials provisioned via `eas credentials` /
`eas build`. These steps require interactive Expo-account login and cannot be
done from the agent environment — leave to the user. `app.json` already has the
`expo-notifications` plugin + iOS `bundleIdentifier` / Android `package`, and
`eas.json` has the build profiles.

**Why:** Expo token registration in source is not sufficient for production
native delivery; iOS requires the app registration and Apple push credentials,
and standalone builds need the EAS project identity.

**How to apply:** test Android push with Expo Go; test iOS push only from a
registered TestFlight/App Store build. Do not claim native production push is
ready until the project ID and platform credentials are configured.
