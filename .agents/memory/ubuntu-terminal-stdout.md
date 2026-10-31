---
name: Ubuntu terminal stdout redirection
description: Diagnosing why commands in the self-hosted Ubuntu terminal appear to produce no output.
---

En la sesión SSH del VPS, la salida estándar puede estar redirigida a `/dev/tty1`, así que comandos que usan stdout parecen no hacer nada aunque se ejecuten.

**Why:** La comprobación de `readlink /proc/$$/fd/1` mostró `/dev/tty1`; los mensajes enviados a stderr sí aparecieron en la terminal.

**How to apply:** Para diagnósticos pegados en esa sesión, redirigir la salida visible con `>&2` en cada comando o imprimirla explícitamente en stderr. No interpretar la falta de stdout como fallo de ejecución.
