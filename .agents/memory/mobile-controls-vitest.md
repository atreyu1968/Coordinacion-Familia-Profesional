---
name: Testing mobile controls in web Vitest
description: A test setup for rendering production React Native controls in the web artifact's Vitest/jsdom suite.
---

When mobile UI components need interaction tests but the mobile artifact has no renderer-based test runner, the web artifact can import the production component and render it through a Vitest-only alias from `react-native` to a tiny DOM shim. The shim should implement the specific primitives used by the component (`View`, `Text`, `Pressable`, and any mocked platform dialog), preserving accessibility labels and press callbacks.

**Why:** The web package may not install `react-native-web`, and Vite can fail while parsing React Native's Flow-annotated package entry even when `react-native` is mocked in the test file.

**How to apply:** Keep the alias scoped to `vitest.config.ts`; do not change runtime app resolution. Use the real production controls and invoke platform confirmation callbacks captured by the dialog mock.
