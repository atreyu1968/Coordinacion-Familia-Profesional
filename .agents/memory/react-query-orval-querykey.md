---
name: react-query orval queryKey requirement
description: When passing custom query options to generated useGetX hooks, queryKey is required.
---

When the orval-generated react-query hooks (e.g. `useGetCenter(id, { query: {...} })`)
receive a custom `query` options object, TypeScript requires `queryKey` to be present —
omitting it (e.g. passing only `{ enabled }`) fails typecheck with TS2741.

**Why:** the generated `UseQueryOptions` type makes `queryKey` required once you supply
the options object; the hook only auto-fills it when no options are passed.

**How to apply:** pass the matching generated key getter, e.g.
`query: { queryKey: getGetCenterQueryKey(id), enabled: Number.isFinite(id) }`.
Same pattern for every `useGetX`/`useListX` hook (use its `getGetXQueryKey`).
