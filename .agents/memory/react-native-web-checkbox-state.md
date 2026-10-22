---
name: React Native Web checkbox state
description: Native accessibilityState does not expose checkbox selection in React Native Web 0.21.
---

Do not assume `accessibilityState={{ checked }}` on a React Native `Pressable`
produces `aria-checked` in the PWA. React Native Web 0.21 supports the individual
ARIA props but discards the native aggregate state.

**Why:** Real browser regressions observed correctly saved and visually selected
checkboxes without any checked state in the accessibility tree. Weakening the
assertion to inspect an icon would hide the accessibility defect.

**How to apply:** Retain native accessibility state where needed and expose
`aria-checked` from the same boolean. Test the actual checkbox state after saving
and reloading, not just the success message or the icon.
