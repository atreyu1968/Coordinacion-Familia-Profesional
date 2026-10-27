---
name: Validación después de integrar cambios simultáneos
description: Riesgo de duplicación fuera de las marcas de conflicto al integrar cambios de despliegue.
---

Al resolver una integración automática, comprobar también el código fuera de las marcas de conflicto y comparar los cambios de los scripts de despliegue con la versión principal.

**Why:** La integración semántica llegó a duplicar bucles del verificador de esquema fuera de las marcas. La comprobación de tipos de la aplicación no detectó el fallo, pero la ejecución aislada de las migraciones sí.

**How to apply:** Para conflictos de instalación o esquema, verificar el cambio completo, no solo eliminar marcas; ejecutar las migraciones en una base aislada antes de dar la integración por válida.
