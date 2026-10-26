# Isolated client regressions

Run through `scripts/test-profile-ui.sh`, never directly against a preview,
shared database or production. The runner removes workspace credentials,
builds both clients with a private Metro cache, creates socket-only temporary
PostgreSQL, verifies its identity before inserting fixtures, serves loopback
HTTPS, and removes the database/files/processes on exit.

```sh
# New navigation contracts and PWA browser journeys only:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/repl/tools/bin/chromium \
  bash scripts/test-profile-ui.sh notification-route.spec.ts notification-return.spec.ts --project=mobile

# Full client suite:
bash scripts/test-profile-ui.sh

# Static checks:
pnpm --filter @workspace/api-server run typecheck:profile-ui
```

The Chromium override is optional when Playwright's own browser is installed.
Reports, screenshots on failure and retained traces are written under the
ignored `generated-artifacts/profile-ui/` directory.

## Notification navigation

`notification-route.spec.ts` loads the real shared mobile router, checks legacy
event/calendar/minutes/certificate destinations, dynamic detail identifiers,
unknown notices and unsafe payloads. The runtime import avoids leaking Expo's
native global types into the server test project.

`notification-return.spec.ts` opens the destinations resolved by that router
and an explicit acta detail route, against the real Expo web/PWA build and API.
It covers no session, a saved locked session, and a genuinely expired signed
JWT. Login uses the actual form/API, including a rejected password. Successful
returns assert both URL and fixture content, then reload; a device lock must
ask for login again after reload. Mandatory-profile tests repeat all three
session states. Switching from the saved account to a complete-profile user
in another province checks real API denials (events, minutes and someone
else's certificate), and checks that protected content is absent from the UI.

### Known regression: expired-session destination loss

The four expired-session return cases currently use **expected failure**,
not a skip. They first require a real 401 from the profile API, the blocking
recovery UI, sign-out, a rejected password, and a successful login. Only the
final return-URL assertion is marked as an expected failure. Failure during
setup or authentication remains an ordinary failure.

The profile guard currently treats the expired token's profile-query error as
an incomplete profile and navigates to `/perfil`. Closing the session captures
that intermediate route rather than the original notice; login then ends on
Tablón instead of the notice. This is a discovered application defect, **not a
passing return journey**. Fixing it will produce an unexpected pass so the
expected-failure marker must be removed as part of that fix. The tests do not
change application behavior to work around the defect.

These tests exercise the destination and authentication guards, **not delivery**
of notices, email, native push, WebAuthn hardware, or service-worker activation.
Service workers are blocked for deterministic isolation; external browser
requests are aborted. No external integration is configured or contacted.
