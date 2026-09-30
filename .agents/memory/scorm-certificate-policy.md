---
name: SCORM completion and certificates
description: Trust boundary for learner-supplied SCORM runtime data and academic certificate eligibility
---

# SCORM certificate policy

**Rule:** SCORM runtime data from the learner's browser is self-reported telemetry, not verified academic completion. It must not by itself complete a lesson or grant an academic certificate. Courses containing SCORM are ineligible for automatic certificates until a trusted graded assessment or explicit manual-verification policy is built.

**Why:** an authenticated learner can submit completion and success fields directly without actually completing the browser-run package. Client-side CMI validation cannot establish independent proof of achievement.

**How to apply:** keep display of self-reported status separate from verified progress and make the certificate gate apply to every issuance/download path, including old progress records. If introducing teacher verification later, define who can attest it and how edits invalidate the attestation.