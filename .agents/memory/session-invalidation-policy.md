---
name: Session invalidation policy
description: When deployments and administrators should force users to authenticate again.
---

Las actualizaciones rutinarias deben conservar las sesiones. La reautenticación masiva se activa solo cuando sea necesaria, de forma explícita desde el actualizador o desde la acción superadministradora.

**Why:** el usuario pidió mostrar el aviso y exigir un nuevo inicio de sesión solo cuando sea necesario.

**How to apply:** mantén desactivada la invalidación en actualizaciones ordinarias; cuando se active, invalida las sesiones antiguas y explica en la web y la PWA que deben volver a iniciar sesión.
