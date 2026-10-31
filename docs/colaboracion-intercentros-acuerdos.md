# Fichas de acuerdos intercentros

## Alcance y significado

Esta etapa se limita a Administración y Gestión y a módulos cuyo piloto curricular
esté revisado y habilitado. No inventa resultados de aprendizaje ni criterios.
Las fichas aparecen dentro de los hilos estructurados: apartados de programación,
materiales de RA y materiales de CE. Los debates generales se conservan.

**Documento intercentros de referencia. No sustituye la programación aprobada
por cada centro.**

Ni una votación, ni una mayoría, ni un texto generado automáticamente constituyen
aprobación institucional. El consenso debe explicarse, no se calcula mediante un
porcentaje. Las reservas y las concreciones locales siguen siendo visibles.

## Flujo de trabajo

1. En **Foros**, entrar en el módulo y en su hilo estructurado.
2. Abrir **Ficha de acuerdo**. Coordinación prepara la síntesis, el texto de
   referencia, fuentes, aportaciones citadas y observaciones.
3. Si corresponde, delegar la síntesis en moderadores ya designados del módulo.
   La delegación no concede capacidad de publicación.
4. Abrir el espacio colaborativo del módulo y coeditar allí el borrador mediante
   Nextcloud/Collabora. En la ficha, pegar el enlace interno estable del archivo:
   `https://servidor-nextcloud/index.php/f/123` o `/f/123`, conservando cualquier
   prefijo público configurado. No utilizar enlaces públicos `/s/…`, tokens,
   credenciales ni parámetros de sesión.
5. Para preparar el documento inicial, usar **Copiar plantilla** o **Plantilla
   Word**. El documento incorpora versión, fuentes, participación y reservas.
   Se descarga localmente: no se sube automáticamente ni crea otra copia remota.
6. Pasar a propuesta y abrir la consulta. Deben existir síntesis, texto y enlace
   al borrador. Desde ese momento no cambia el texto consultado en esa versión.
7. Cada participante registra **a favor**, **con reservas** o **en contra**,
   eligiendo uno de sus centros autorizados. Las reservas y la oposición necesitan
   motivación. Puede cambiar su postura mientras siga abierta: solo cuenta una
   vez por persona y versión; se conserva el historial de cambios reales.
8. Coordinación o el moderador delegado documenta el cierre como **consensuado**
   o **sin consenso**, explicando participación y discrepancias. No puede
   declararse consenso sin ninguna postura registrada.
9. La coordinación competente o superadministración valida la publicación.
   Se requieren dos confirmaciones separadas: el documento correcto y sus
   permisos han sido comprobados por la persona, y se publica solo una referencia,
   no una aprobación institucional.
10. La publicación crea una página fechada e inmutable en **Documentación**, con
    enlace persistente, responsable, validador, versión, fuentes y posturas.
    Las nuevas aportaciones requieren **Abrir nueva versión**; no sobrescriben
    una referencia publicada anteriormente.

## Estados

Abierto → Síntesis → Propuesta → Consulta → Consensuado / Sin consenso.

**Revisión normativa** señala que es necesaria otra revisión y no se puede
publicar. **Archivado** retira la ficha del trabajo activo, conservando su
contenido e historial. Archivar no elimina una referencia histórica publicada
ni la presenta como actualizada.

Una versión cerrada o publicada solo se archiva o da paso a una nueva versión.
La nueva versión comienza abierta, sin trasladar los votos de la anterior.
Si cambia el currículo o deja de estar revisado, se bloquean las nuevas posturas,
los cambios de contenido y la publicación. Sigue siendo posible archivar.

## Participación y permisos

- N docentes: personas distintas con una postura actual en esa versión.
- M centros: centros distintos representados por esas posturas; dos centros con
  el mismo nombre siguen siendo centros diferentes.
- P censo: personas elegibles al abrir la consulta, no el número actual de
  usuarios de la plataforma. Es una instantánea, no un listado público de IDs.
- Una persona con varios centros no obtiene varios votos. Puede corregir el
  centro de su postura y se conserva el cambio.
- Quien se incorpora después puede debatir, pero no votar en el censo ya abierto;
  para incluirle debe abrirse una nueva versión.
- Los docentes requieren acceso actual al módulo. Se mantienen las excepciones
  de coordinación, gestión y moderación ya existentes.
- La participación antigua no concede acceso permanente. Perder la asignación
  puede impedir leer tanto la ficha como su página publicada.
- En móvil se consulta la ficha y se registra la postura propia. La síntesis,
  delegación y publicación se gestionan desde el enlace a la web.
- La apertura de consulta y la primera publicación generan avisos. Si falla el
  envío, la aplicación distingue el contenido guardado del aviso no confirmado;
  no afirma que se haya deshecho el guardado.

## Nextcloud y seguridad

El servidor comprueba la disponibilidad pública de Nextcloud mediante
`status.php` y exige que el enlace pertenezca al servidor configurado. **No lee
el archivo privado, ni verifica su contenido o permisos usando una cuenta
administrativa**. Esa comprobación corresponde a la persona que publica y
queda explícita en la confirmación.

Si Nextcloud no está configurado, está en mantenimiento o falla su comprobación,
no se publica la referencia. El foro y la biblioteca siguen disponibles.
El borrador canónico continúa en Nextcloud; el texto publicado queda fechado
en Documentación. Los cambios posteriores del borrador no alteran la versión
publicada. La wiki, su listado y el índice de la IA respetan el acceso actual
al módulo para estas páginas.

## Instalación, actualización y reversión

La migración `deploy/migrations/forum-agreements.sql` es aditiva, transaccional e
idempotente y la ejecuta `deploy/db.sh`. Añade acuerdos, revisiones, posturas e
historial. No convierte automáticamente debates o recursos anteriores.
El verificador reconoce estas tablas durante la comprobación previa de una
actualización y exige después las columnas, claves e índices declarados.

Un disparador impide modificar o borrar el contenido de páginas publicadas,
también si una ruta antigua o una escritura directa intentan hacerlo.
La aplicación devuelve un mensaje de versión inmutable en lugar de ofrecer
edición ordinaria.

Antes de publicar en producción: copia verificada de base de datos, código y
almacenamiento externo; piloto real con currículo revisado; comprobación real
de Nextcloud/Collabora y de sus permisos; revisión humana del documento final.
Estas pruebas de desarrollo no equivalen a una validación del servidor externo
de producción.

No volver a código antiguo que desconozca el filtro de lectura de estas páginas:
podría mostrar referencias a usuarios sin acceso actual al módulo. Una reversión
debe conservar los controles o restaurar coordinadamente código y datos.
No borrar las tablas para intentar desinstalar el módulo.

## Comprobaciones reproducibles en desarrollo

- API: `pnpm --filter @workspace/api-server exec vitest run test/forum-agreements.test.ts`
- Reglas web/móvil: `pnpm --filter @workspace/web exec vitest run src/lib/forum-agreement.test.ts`
- Migración aislada, repetición, conservación y restauración:
  `bash deploy/test-db.sh --forum-collaboration-only`
- Fixture temporal de pantalla:
  `pnpm --filter @workspace/api-server exec tsx test/seed-forum-collaboration-ui.ts --agreements`
- Limpieza obligatoria tras la prueba:
  `pnpm --filter @workspace/api-server exec tsx test/seed-forum-collaboration-ui.ts --cleanup`

El fixture está bloqueado en producción, usa datos marcados como ficticios y
guarda sus accesos solo en un archivo temporal privado, no en el repositorio.
