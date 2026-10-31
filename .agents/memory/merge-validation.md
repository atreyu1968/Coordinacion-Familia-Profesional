---
name: Validación después de integrar cambios simultáneos
description: Riesgo de duplicación fuera de las marcas de conflicto al integrar cambios de despliegue.
---

Al resolver una integración automática, comprobar también el código fuera de las marcas de conflicto y comparar los cambios de los scripts de despliegue con la versión principal.

**Why:** La integración semántica llegó a duplicar bucles del verificador de esquema fuera de las marcas. La comprobación de tipos de la aplicación no detectó el fallo, pero la ejecución aislada de las migraciones sí.

**How to apply:** Para conflictos de instalación o esquema, verificar el cambio completo, no solo eliminar marcas; ejecutar las migraciones en una base aislada antes de dar la integración por válida.

No usar solo la ascendencia de commits para decidir si una mejora de una rama
de tareas está incorporada: comparar también su contenido con `main`.

**Why:** las integraciones de tareas pueden reescribir el historial. Una mejora
puede estar íntegra en `main` aunque el commit de su rama original no sea
antepasado de `main`; confundir ambas cosas llevó a dar información contradictoria.

**How to apply:** revisar los archivos y comportamientos concretos, distinguir
ramas antiguas sustituidas de funciones realmente pendientes y confirmar el
`main` remoto de GitHub por separado del local antes de recomendar actualizar.
