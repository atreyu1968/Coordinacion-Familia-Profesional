---
name: Rama única de producción
description: Motivo y alcance de la decisión de utilizar exclusivamente main para actualizar producción.
---

Producción se actualiza exclusivamente desde `main`. No cambiar automáticamente
la rama del servidor ni descartar cambios para conseguir que una actualización
continúe.

**Why:** el usuario indicó que había tantas ramas que ya no sabía cuál debía
actualizar en producción y aprobó proteger el actualizador para aceptar solo
`main`.

**How to apply:** integrar las mejoras en `main` y confirmar su envío al
repositorio de GitHub antes de dar por disponibles los cambios para el servidor
Ubuntu. Las ramas de tareas o de funciones no son fuentes de producción. No
borrarlas como parte de una actualización.

El seguimiento local de `main` puede apuntar a un remoto interno de tareas, no
al repositorio de GitHub del usuario. No asumir que un commit local ya se ha
enviado. Confirmar explícitamente la referencia de GitHub; si no hay remoto
`origin` en desarrollo, usar la conexión autorizada de GitHub sin manejar tokens.
Las actualizaciones remotas deben ser fast-forward, nunca forzadas.
