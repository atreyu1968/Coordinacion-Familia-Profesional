---
name: Mobile test type isolation
description: Avoid native ambient types and DOM/Node stream conflicts in isolated PWA regression harnesses.
---

Keep Expo/React Native ambient types out of Node/browser test projects when
testing a pure mobile utility.

**Why:** A type-only Expo Router dependency transitively loaded React Native
globals into the server UI-test project. Unrelated server code then failed
on AbortSignal, URL and fetch body types. Adding DOM libraries to the whole
project instead exposed incompatible Node/DOM ReadableStream declarations.
Neither failure was caused by the application logic under test.

**How to apply:** Keep native, browser and server type environments separate.
The native project owns native compatibility; a Node/browser test should
depend only on the types it actually needs. Do not broaden global libraries
or change server production code to compensate for test-only type pollution.

The same isolation applies to mobile components using private `@/` import
aliases: a web test's static import can make TypeScript resolve those aliases
against the wrong app, even when Vitest mocks the dependency successfully.
**Why:** runtime mocking does not stop TypeScript from traversing the imported
mobile source under the web project's alias configuration.
**How to apply:** load the real route/component through `vi.importActual` with
a narrow test-side component signature; let the mobile project typecheck the
implementation. Prefer Vitest's resolver over a variable dynamic import, which
can instead resolve relative to the Vite served root.
