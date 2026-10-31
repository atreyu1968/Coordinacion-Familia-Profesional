# Recursos de colaboración intercentros · segunda etapa

## Alcance

Administración y Gestión. Se amplía la **biblioteca existente**: cada recurso
conserva una identidad, autoría y referencia canónica. No se crean bibliotecas,
carpetas ni copias de archivos para cada RA o criterio.

La publicación curricular exige pertenecer al foro del módulo según las reglas
del curso activo y que su piloto esté activado y revisado. Los RA/CE se toman
del catálogo; no se generan textos curriculares.

## Añadir y asociar

1. Abre un hilo de **Materiales RA/CE** o selecciona el módulo en **Recursos**.
2. Usa **Añadir recurso curricular** para una referencia nueva. Para un recurso
   ya existente, abre su acción de asociación curricular: se conserva su ID,
   archivo, autor y ámbito de centro. No se comparte automáticamente fuera de
   los permisos que tenía.
3. Indica título, descripción metodológica, tipo, licencia, versión y uso
   previsto (docente o alumnado). Este último campo describe el destino del
   material; no crea cuentas de estudiantes ni da acceso público.
4. Selecciona uno o varios RA y/o CE del mismo módulo. Un criterio debe pertenecer
   a su RA real. No se crean combinaciones ni duplicados.
5. Usa una referencia HTTPS estable de Nextcloud u otra fuente, o selecciona un
   adjunto autorizado de **Documentación**. No pegues credenciales, enlaces
   firmados ni enlaces de compartición que otorgan acceso mediante un token.
6. Confirma que tienes derechos para compartir con esa licencia y que no incluyes
   datos del alumnado ni secretos. La publicación nueva se comparte entre quienes
   tienen acceso al módulo; se conserva el centro de origen como metadato.

Un duplicado de URI se rechaza y se pide asociar el recurso existente, no subir
o registrar otra copia. La huella de URI no es un checksum del contenido ni
certifica su integridad.

## Consultar, revisar y retirar

- El hilo de un RA muestra sus materiales generales y los de sus criterios.
  El de un CE muestra únicamente los asociados a ese criterio.
- Los enlaces de la ficha RA/CE y del foro abren los filtros de la biblioteca.
  La búsqueda incluye título, descripción, tipo, autor, módulo, RA/CE, licencia,
  versión y centro de origen.
- Se muestran autoría, centro de origen, licencia, versión y versión curricular.
- Solo el autor o la gestión autorizada puede editar asociaciones o retirar.
  Las ediciones concurrentes se rechazan mediante la revisión del registro.
- Cambiar el currículo no reasigna recursos silenciosamente. Se conserva la
  referencia a la versión revisada y se requiere nueva revisión antes de guardar
  una asociación actualizada.
- **Archivar** retira del catálogo normal, hilos ordinarios e indexación de ese
  recurso, sin borrar su archivo ni sus asociaciones. La persona autorizada
  puede consultarlo como archivado. Se puede archivar aunque cambie el currículo;
  restaurarlo exige revisar el currículo vigente.
- La app móvil permite consultar y abrir referencias. La gestión se abre
  expresamente en la biblioteca web.

## Solucionarios y permisos del origen

Un enlace público **no se convierte en privado al etiquetarlo**. En esta etapa,
un solucionario restringido debe referenciar un adjunto protegido de Documentación
del mismo módulo y estar destinado a docentes. No se admiten URLs públicas ni
enlaces de compartición como sustituto de ese control.

El catálogo restringe sus registros a quienes pueden acceder al módulo, incluso
en el listado general y en la selección de fuentes de la IA. Las descargas de
Documentación utilizan la sesión del usuario y comprueban los permisos del origen.
No se accede con una cuenta administrativa ni mediante un enlace público generado.

La etiqueta del catálogo **no revoca derechos previos sobre el original** ni borra
copias que ya existan. Antes de añadir un solucionario hay que revisar también
los permisos de su página/archivo de origen. Un documento que ya era visible por
otra sección conserva esos permisos; no debe usarse para simular confidencialidad.
Para Nextcloud se conservan sus permisos y sesión, sin publicar tokens.

## Disponibilidad y límites

El catálogo registra referencias y no consulta Nextcloud para copiar, mover o
validar archivos. Por eso una caída de Nextcloud no duplica archivos ni interrumpe
la consulta de metadatos. Abrir o editar el original sigue dependiendo del
proveedor: registrar una URL no certifica que el servicio esté disponible.

No se ha activado ningún piloto curricular real ni cargado currículo ficticio
como contenido oficial. Acuerdos, posturas, coedición de síntesis y publicación
institucional corresponden a la siguiente etapa.

## Actualización y reversión

Migración aditiva: `deploy/migrations/resource-curriculum.sql`, integrada en
`deploy/db.sh` y en el preflight. Añade `resource_curriculum` y
`resource_learning_targets`, sus claves e índices; no cambia filas anteriores.

No se ha migrado ni desplegado producción. Antes de hacerlo: aprobación de la
migración, copia PostgreSQL, respaldo independiente de archivos y ensayo sobre
una copia de producción. No reinstalar servicios ni invalidar sesiones por este
cambio.

**Reversión importante:** el código anterior no conoce la visibilidad curricular.
No debe iniciarse un servidor antiguo contra estos nuevos registros sin un plan:
se podrían volver a listar referencias archivadas/restringidas como recursos
ordinarios. Detener publicaciones, respaldar y preparar una versión de
compatibilidad que conserve estos filtros, o restaurar una copia coordinada de
código y datos con revisión de las escrituras posteriores. Archivar no protege
frente a un servidor antiguo que ignora la tabla.

Comprobaciones de desarrollo:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server exec vitest run test/curriculum-resources.test.ts
pnpm --filter @workspace/web exec vitest run src/lib/curriculum-resources.test.ts
bash deploy/test-db.sh --forum-collaboration-only
```

El ensayo aislado comprueba también la conservación de un recurso anterior y su
URI, instalación, repetición de migraciones y restauración de un dump. Los
archivos de Nextcloud no se modifican.
