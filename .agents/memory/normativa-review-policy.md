---
name: Revisión humana de novedades normativas
description: Separación entre detectar publicaciones oficiales, revisar su aplicabilidad y editar la documentación.
---

Las nuevas publicaciones BOE/BOC deben presentarse para revisión humana, nunca como una declaración automática de vigencia ni como una actualización automática de páginas editadas.

**Why:** El usuario exige distinguir cambios aplicables a Administración y Gestión de cambios exclusivos de otras familias, preservando la documentación y los permisos de la wiki.

**How to apply:** Mantener separados la fecha de comprobación técnica y el examen jurídico. Un título de otra familia no basta para descartar una modificación: comprobar los anexos para detectar ADG; si no se puede leer el texto, conservar la incertidumbre y pedir revisión.

El seguimiento debe retener solo publicaciones con relación directa o indirecta con Administración y Gestión en Canarias. Incluir normativa común de FP y cambios de materias profesionales (por ejemplo, fiscalidad, contabilidad, relaciones laborales, empresa, actividad comercial y gestión digital); excluir las claramente ajenas. La falta de texto legible conserva estado incierto en lugar de provocar un descarte automático.

**Why:** el usuario necesita que la bandeja BOE/BOC sea manejable y no incluya cambios sin impacto en su familia profesional.

**How to apply:** filtrar antes de guardar o mostrar las publicaciones ajenas, sin borrar el historial existente; revisar anexos y materias compartidas antes de clasificarlas como ajenas.

Solo el superadministrador puede consultar y gestionar publicaciones normativas pendientes de confirmar. Coordinadores no reciben avisos de esas pendientes; los avisos normativos antiguos se ocultan en su bandeja sin borrar registros.

**Why:** el usuario reservó expresamente la revisión pendiente al superadministrador.

**How to apply:** aplicar la restricción en API, notificaciones y UI; no confiar solo en ocultar controles en el cliente.
