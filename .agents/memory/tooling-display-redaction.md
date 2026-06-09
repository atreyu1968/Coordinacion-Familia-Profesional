---
name: Tool-output display redaction can rewrite tokens
description: Some words show as "ln" in read/rg/bash output but the real file bytes are unchanged
---

# Display redaction in tool output

Certain tokens are rewritten in tool OUTPUT (read, rg line content, bash stdout)
but the underlying file bytes are unchanged. Observed: words rendering as `ln`
in generated code and even inside `node_modules/@orval/core` dist JSDoc
(orval's sanitize helper showed as `ln(...)`). Codegen output for the `feedback`
resource displayed every `Feedback`/`feedback` as `ln` (e.g. `/api/ln`,
`useListln`, `interface ln`) — but the bytes were correct.

**Why:** a redaction layer transforms displayed text; `rg` still MATCHES the
real bytes (it will list a file like `createFeedbackInput.ts` as a match even
while showing `ln` in the line preview).

**How to apply:** never conclude codegen/files are broken from suspicious
displayed tokens alone. Get ground truth that bypasses display:
- `rg -c "RealToken" file` (counts are numbers, not redacted)
- run the compiler: `tsc --noEmit` — if imports of the "real" names resolve,
  the bytes are correct.
Trust the compiler and counts over the rendered text.
