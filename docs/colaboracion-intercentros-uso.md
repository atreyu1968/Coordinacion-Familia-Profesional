# Foro intercentros · primera etapa

Para las fichas, consultas y referencias versionadas de la tercera etapa,
consulta [la guía de acuerdos intercentros](colaboracion-intercentros-acuerdos.md).

El panel agregado se explica en [Seguimiento por módulo](colaboracion-intercentros-seguimiento.md).

La entrega de novedades se explica en [Avisos agrupados](colaboracion-intercentros-avisos.md).

## Ámbito y situación de la entrega

Solo **Administración y Gestión**. La primera etapa amplía el foro existente;
no publica programaciones oficiales ni sustituye los documentos de cada centro.
Los acuerdos, consultas de conformidad y catálogo de recursos con múltiples RA/CE
corresponden a etapas posteriores.

No se ha activado ningún piloto curricular real: en desarrollo no había RA/CE.
Las pruebas usan textos ficticios que no deben trasladarse a producción.

## Coordinación y gestión autorizada

1. Abre **Foros**, elige uno de tus módulos y pulsa **Configurar colaboración**.
2. Comprueba los diagnósticos. En este piloto se requiere un módulo global con
   código no ambiguo y RA/CE ya registrados. Un registro específico de centro o
   una coincidencia de código no se fusiona automáticamente con otros registros.
3. Revisa los textos oficiales en la ficha de RA/CE y su procedencia. Indica
   código oficial, fuente HTTPS, disposición, versión curricular y territorio.
   Confirma expresamente que has revisado los datos mostrados.
4. Revisa los 16 apartados `PD-01` a `PD-16`. Puedes renombrar, ordenar, activar o
   desactivar apartados y editar sus instrucciones. Se conservan sus claves.
   Cada guardado deja una versión de la configuración. No reescribe las respuestas
   ni el texto inicial de los hilos ya creados.
5. Activa el piloto y guarda. **Guardar no crea hilos**.
6. Consulta la lista de temas pendientes y confirma **Crear temas pendientes**.
   Se crea un hilo por apartado activo, un hilo por RA y otro por cada CE de ese
   RA, nunca todas las combinaciones RA×CE. Repetir no genera duplicados.
7. Para suspender el piloto, desmarca su activación y guarda: no se borran debates
   ni historial. No se otorga acceso a docentes no autorizados por desactivarlo.

Si otro gestor cambia la plantilla o cambia el currículo entre la vista previa
y tu confirmación, el servidor rechaza la operación y pide actualizar la vista.
Si faltan RA/CE, no se inventan. La URL es una referencia aportada por la persona
que revisa, no una comprobación automática de autenticidad o vigencia.

## Docentes y jefaturas

- Accede al foro de los módulos que impartes en el curso activo, con las
  excepciones de gestión y moderación ya existentes. La jefatura no recibe acceso
  a módulos nuevos por dirigir un departamento.
- **Programación didáctica:** aporta propuestas, referencias, concreciones
  locales y reservas a los apartados normalizados.
- **Materiales RA/CE:** participa en el hilo del resultado o del criterio. Los
  enlaces de la ficha RA/CE llevan al debate correspondiente; el debate ofrece
  el regreso a esa ficha. Los archivos se siguen gestionando en la biblioteca
  y documentación existentes, sin copias automáticas.
- **Debates generales:** conserva los hilos anteriores y los temas ordinarios
  nuevos, con sus enlaces, autoría, lectura y moderación.
- En la app móvil puedes navegar las secciones y participar. La configuración y
  la ficha curricular se abren en la web, identificadas como tales.
- La etiqueta curricular de un hilo histórico conserva su versión, aunque se
  revise posteriormente la fuente. No confundir una propuesta con texto oficial.

## Despliegue seguro

Esta entrega incorpora **tres tablas aditivas**, sin modificar mensajes antiguos:
`forum_collaborations`, `forum_collaboration_revisions`, `forum_thread_contexts`.
La migración revisada es `deploy/migrations/forum-collaboration.sql`, integrada
en `deploy/db.sh` y en la lista de preflight del verificador.

Antes de actualizar producción se requiere aprobación específica de la migración,
backup PostgreSQL y ensayo sobre una copia. Respaldar por separado el almacenamiento
local y Nextcloud. No reinstalar Nextcloud/Collabora, ejecutar `push-force` ni
invalidar sesiones por este cambio.

Comprobaciones de desarrollo:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server exec vitest run test/forum-collaboration.test.ts test/forums.test.ts test/department-head-modules.test.ts
pnpm --filter @workspace/web exec vitest run src/lib/forum-collaboration-classify.test.ts
bash deploy/test-db.sh --forum-collaboration-only
```

El ensayo aislado comprueba instalación, migración repetida, conservación de
debates/lecturas/sesiones/tablas ajenas y restauración de un dump.
No ejecuta el actualizador contra producción.

Reversión: desactivar pilotos y volver al código anterior sin eliminar las tablas
aditivas. Si fuese necesario restaurar datos, utilizar la copia y código
correspondientes con parada controlada; no perder escrituras posteriores
restaurando indiscriminadamente un dump antiguo.

Si se ha instalado también la etapa de recursos, esta reversión simple ya no es
adecuada: consultar las precauciones de visibilidad en
`colaboracion-intercentros-recursos.md` antes de volver a código antiguo.
