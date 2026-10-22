---
name: Borrado de docentes de prueba
description: Alcance autorizado y prevención de la recreación de profesores de prueba tras limpiar producción.
---

El usuario eligió borrar definitivamente las cuentas de los profesores de prueba, sus asignaciones y su historial, también en producción. Desactivarlas no satisface esa petición.

**Why:** el usuario escogió expresamente «Borrar definitivamente sus cuentas, asignaciones e historial».

**How to apply:** mantener separada esta limpieza de la desactivación ordinaria. Exigir superadministración, vista previa y confirmación irreversible; nunca ejecutar la limpieza de producción por iniciativa del agente.

La autorización se refiere a las identidades artificiales conocidas del instalador, no a cualquier usuario con «prueba» en el nombre o un determinado sufijo de correo. El contenido compartido con aportaciones reales debe bloquear el borrado hasta revisarlo, no arrastrar esos datos.

**Why:** una limpieza de datos de demostración no autoriza a eliminar actividad de docentes reales.

**How to apply:** no ampliar los criterios de selección de forma heurística; conservar centros, módulos y espacios compartidos. Revocar el acceso externo cuando corresponda, sin borrar sus archivos compartidos.

La eliminación administrativa debe sobrevivir a futuras ejecuciones del instalador y del actualizador. Se conserva un registro administrativo de esa decisión aunque se borre el historial propio de los profesores artificiales.

**Why:** borrar las cuentas sin recordar la decisión permitiría que una actualización las volviera a crear.

**How to apply:** cualquier modificación de las semillas o limpieza del registro administrativo debe respetar esta supresión persistente; no confundir el registro del administrador con el historial de las cuentas eliminadas.
