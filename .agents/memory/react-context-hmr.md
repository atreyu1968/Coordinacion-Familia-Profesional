---
name: React context + Vite HMR stability
description: Why React context must live in a component-free module to survive HMR
---

# React context modules must be HMR-stable

**Rule:** Define a React `Context` object (and its `useX` hook) in a module that exports **no React components** — e.g. `auth-context.ts` holds `AuthContext` + `useAuth`, while `auth.tsx` holds only `<AuthProvider>` and imports the context.

**Why:** When a context object is created in the same file as its Provider component, a Vite/React-Fast-Refresh hot update of that file creates a **new** context object, but the already-mounted Provider (rendered from a parent module that wasn't re-executed) still holds the **old** one. Consumers then read the new context, find no matching provider, and throw `useAuth must be used within an AuthProvider`. This surfaces as a runtime crash in the Replit preview (which runs the web app in dev mode), not just a dev annoyance.

**How to apply:** For any `createContext` + Provider + hook trio in the web app, keep the `createContext` call and hook in a components-free `*-context.ts` file. The Provider file can re-export the hook for import-path compatibility (`export { useAuth } from "./auth-context"`). Applies to any future contexts (theme, settings, etc.), not just auth.
