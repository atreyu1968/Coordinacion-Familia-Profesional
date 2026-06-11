---
name: Tailwind v4 CSS variable utility syntax
description: In Tailwind v4, utilities that READ a CSS variable must use (--var), not [--var].
---

# Tailwind v4 CSS variable utilities

In Tailwind v4, a utility that **reads** a CSS custom property must use the
parenthesis shorthand: `h-(--cell-size)`, `w-(--cell-size)`, `size-(--cell-size)`,
`origin-(--radix-...)`. The v3 bracket form `h-[--cell-size]` is treated as a
literal arbitrary value (`height: --cell-size`) → invalid CSS → the element
collapses. The **definition** form with a colon, `[--cell-size:2rem]`, still
works (it sets the variable).

**Why:** shadcn/ui components copied from v3-era sources (e.g.
`components/ui/calendar.tsx`) ship the `[--var]` read syntax, which silently
breaks layout under Tailwind v4 (symptom: a cramped/squished calendar grid).

**How to apply:** when a shadcn component renders mis-sized under Tailwind v4,
grep the component for `-[--` references and convert them to `-(--`. Known
remaining offenders not yet fixed because they were not user-reported and render
acceptably: `components/ui/select.tsx` and `components/ui/context-menu.tsx`
(`origin-[--radix-*]`, `max-h-[--radix-*]`).
