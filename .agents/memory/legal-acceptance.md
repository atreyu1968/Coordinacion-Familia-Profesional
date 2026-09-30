---
name: Legal acceptance and cookie policy
description: Decisions and limitations when publishing registration terms, privacy information, and cookie notices.
---

- **Rule:** Distinguish agreement to terms, acknowledgment of a privacy notice, and consent to optional tracking. Never bundle the last into a required registration checkbox. Record the version presented at sign-up so a later revision is not silently attributed to an earlier acceptance.
  **Why:** The app currently needs essential session storage and interface preferences, not an invented analytics consent. Conflating these would misrepresent what users agreed to.
  **How to apply:** When adding optional analytics or other nonessential storage, implement a separately withdrawable choice before activating it; review third-party services independently.

- **Rule:** Do not treat a legal draft as a completed compliance statement or as acceptance of later finalized terms.
  **Why:** A name and general location alone do not establish a complete postal/privacy contact, actual processors, lawful bases, or retention rules, so a truthful final notice cannot yet be published.
  **How to apply:** Complete and professionally review the notices before a self-hosted rollout; publish a new version and make sure new registrations acknowledge that version. Determine separately how existing draft-version accounts will be informed or asked to reaccept.

- **Rule:** When extending preservation checks in an isolated migration test, reuse the exact validation pattern used by the schema verifier.
  **Why:** A shortened UUID pattern falsely failed a migration test even though the migration and independent verification had both passed.
  **How to apply:** Compare the preservation assertion against the verifier whenever its regex or structural constraints are copied into a test.