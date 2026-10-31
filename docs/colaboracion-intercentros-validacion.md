# Validación de la primera etapa · 30 de octubre de 2026

## Alcance

Solo colaboración de módulos de **Administración y Gestión**. Pruebas en
desarrollo y PostgreSQL aislado. No se ha verificado ni actualizado producción.
No se ha activado un piloto curricular real.

## Comprobaciones superadas

- `pnpm run typecheck`: bibliotecas, API, web, móvil y scripts.
- API: siete pruebas nuevas de colaboración; 31 de foros y acceso de jefatura.
  Se corrigió un fixture de moderación que usaba el rol antiguo en lugar del
  indicador `forumModerator`; no se cambiaron los permisos para acomodar la prueba.
- Web: cinco pruebas de clasificación, conservación de debates generales,
  metadatos históricos y enlaces RA/CE.
- Compilaciones API, web y exportación web/PWA de Expo.
- Ensayo aislado del esquema: instalación nueva, actualización de una base
  anterior, repetición, conservación de mensajes/lecturas/sesiones/tablas ajenas
  y restauración de un dump en otra base temporal. Se verificó con el mecanismo
  oficial `db.sh verify`, que configura el servicio libpq protegido.
- Inicialización diez veces y simultáneamente: exactamente 16 apartados,
  dos RA y tres CE en la prueba API, sin producto cartesiano ni duplicación.
- Bloqueos para otra familia, identidad ambigua, módulos de centro, ausencia
  de currículo, cambios después de revisión y generación sin autorización.

## Prueba real de navegador con cuenta temporal

Recorrido completado con un módulo marcado expresamente como ENSAYO y textos
curriculares ficticios:

1. El debate previo permaneció general y conservó su contenido.
2. Se configuró la fuente, versión y plantilla de 16 apartados con confirmación
   humana. Guardar no creó hilos.
3. La confirmación separada creó 18 hilos: 16 apartados + un RA + un CE.
4. Los tres apartados, apertura de hilos, ida/vuelta RA y CE y sus enlaces
   persistentes funcionaron.
5. Una respuesta permaneció después de recargar.
6. Repetir inicialización devolvió los mismos identificadores y cero pendientes.
7. Se capturaron pantallas reales del resumen, configuración, confirmación,
   hilos, ficha curricular y respuesta persistida.
8. A 390×844 el formulario permitió llegar mediante scroll a los últimos
   apartados, confirmación y botones. Se detectó desbordamiento horizontal del
   encabezado/secciones y se corrigieron sus clases de distribución y ajuste
   de texto. Esta corrección visual se comprobó en código y tipos, sin una
   segunda prueba de navegador.

La app móvil incluye navegación y enlaces integrados y supera tipos/exportación,
pero **no se ha probado su recorrido con una sesión en Expo/PWA ni en dispositivos
Android/iOS**. No presentar la comprobación responsive de la web como una prueba
del cliente móvil.

## Pendientes, no incluidos en la primera etapa

- Registrar y revisar fuentes y RA/CE reales para seleccionar dos o tres módulos
  piloto. No se inventaron textos para suplir su ausencia en desarrollo.
- Resolver expresamente las correspondencias de módulos duplicados o específicos
  de centro antes de incorporarlos a la comunidad compartida.
- La etapa 2 se ha incorporado posteriormente; ver sus comprobaciones al final
  y el manual `colaboracion-intercentros-recursos.md`.
- Etapa 3: fichas de acuerdos, posturas, borradores Nextcloud y publicación en wiki.
- Etapa 4: seguimiento y notificaciones agrupadas.
- Aprobar la migración de producción, respaldar datos y ensayar sobre una copia
  del servidor real antes de desplegar.

## Segunda etapa: biblioteca curricular

También se han completado en desarrollo:

- Ocho pruebas API de asociaciones múltiples, pertenencia real RA/CE,
  permisos de módulo, biblioteca antigua, selección de fuentes IA, revisión,
  archivo, referencias protegidas y duplicados concurrentes. Se bloqueó también
  crear un alias desde el endpoint antiguo para eludir la clasificación.
- Nueve pruebas frontend de selección, filtros RA/CE, revisión y referencias.
- Once pruebas de tarjetas, enlaces y datos del panel después de incluir los
  recursos curriculares compartidos, preservando el filtro de familia.
- Tipos de los paquetes afectados; compilaciones API/web y exportación Expo web.
- Ensayo aislado con 101 tablas: migraciones repetidas, recurso anterior y URI
  conservados, tablas ajenas, sesiones y restauración verificados.
- Recorrido real con cuenta temporal: creación de un recurso con RA y CE,
  selector de Documentación, duplicado rechazado sin perder el formulario,
  asociación de recurso anterior conservando ID/URI, versión persistida tras
  recarga, archivo oculto en biblioteca normal y restauración.
- Capturas reales del panel de recursos, biblioteca filtrada, selector y editor.
  A 390×844 los controles y confirmación resultaron accesibles mediante scroll.

Durante la prueba, una carga de módulo Vite falló transitoriamente mientras se
regeneraba el cliente; una recarga normal la recuperó y el recorrido pudo
completarse. Se reiniciaron los servicios de desarrollo al finalizar los cambios.

Las cuentas, módulos y recursos ficticios de pantalla se eliminaron al terminar.
El selector utilizó solo metadatos ficticios de un adjunto y no solicitó sus
bytes inexistentes. **No se ha comprobado abrir un PDF real de ese origen, ni
Nextcloud en producción, ni el recorrido del cliente Expo/PWA en dispositivos.**
No presentar las compilaciones como sustituto de esas verificaciones.

La migración nueva añade únicamente `resource_curriculum` y
`resource_learning_targets`. No se migró ni publicó producción. La reversión de
esta etapa requiere preservar los filtros de visibilidad, como explica el manual.

## Tercera etapa — acuerdos y documentos (30/10/2026)

- 8 pruebas de API superadas: lectura por módulo, síntesis delegada,
  conflictos de edición, fuentes seguras, posturas únicas con historial,
  centros distintos con nombres iguales, cierre motivado, indisponibilidad del
  proveedor, publicación concurrente idempotente, inmutabilidad de la wiki,
  acceso histórico revocado, nueva versión y retirada tras cambio curricular.
- 12 pruebas de reglas de interfaz web/móvil superadas.
- Typecheck correcto en API, web y móvil. Compilaciones de API y web correctas.
  Persisten advertencias no bloqueantes de tamaño de paquetes.
- Instalación aislada de 105 tablas: actualización desde esquema anterior,
  repetición, preservación de mensajes/recursos/sesiones/tablas ajenas,
  dump y restauración completa. La protección de páginas inmutables se conserva
  y rechaza modificaciones y borrados también después de restaurar.
- Recorrido real de navegador con accesos temporales: síntesis guardada y
  recuperada, plantilla Word válida comprobada como ZIP/OpenXML, controles de
  gestión ausentes para el docente, postura y motivación persistentes,
  cambios sin duplicar personas ni centros, y sincronización móvil → web.
- Vista Expo web comprobada a 390 × 844: sin desbordamiento horizontal y con
  controles alcanzables. Esto no sustituye pruebas en binarios nativos.
- Capturas y muestra ficticia de Word en
  `generated-artifacts/colaboracion-intercentros/`, excluido de Git y despliegue.
- Cuentas, fichas y demás datos temporales eliminados al terminar. El archivo
  temporal privado de acceso también se eliminó.

**Límite de esta validación:** no hay Nextcloud configurado en este entorno.
La publicación y su atomicidad se prueban en integración con disponibilidad
simulada; no se ha validado un archivo, sus permisos ni una publicación contra
el proveedor real. La consulta de pantalla usa metadatos ficticios identificados
como ENSAYO; no se abrió su enlace de ejemplo.

La migración añade cuatro tablas de acuerdos y un disparador de protección sobre
las referencias publicadas. No se ha migrado ni publicado producción.

## Seguimiento por módulo — panel (31/10/2026)

- API de lectura, limitada a pilotos configurados de Administración y Gestión
  y a permisos actuales del módulo. Respuesta privada sin caché compartida.
- 10 pruebas de API superadas en el recorrido de acuerdos, con comprobaciones
  nuevas de seguimiento: acceso anónimo y ajeno, exclusión del mensaje generado,
  materiales visibles frente a archivados/borrados, cobertura RA, revisión de
  versión curricular, centros distintos, ausencia de duplicados, publicaciones
  históricas, revocación de asignación y pilotos desactivados.
- 17 pruebas de reglas web superadas: 12 existentes de acuerdos y 5 nuevas de
  seguimiento, filtros, agrupación y exportación CSV protegida frente a fórmulas.
- Typecheck de API, web y móvil correcto; compilaciones de API y web correctas.
  Persisten las advertencias no bloqueantes de tamaño de paquetes.
- Los tres servicios arrancan correctamente. La captura pública de la ruta
  nueva muestra el acceso protegido por inicio de sesión, sin errores de
  ejecución. No se ha realizado otro recorrido de navegador autenticado ni
  una prueba física de Android/iOS en esta entrega.
- No añade tablas, no necesita migración y no cambia producción.
- Esta entrega cubre el panel y el informe agregado; no implementa todavía
  resumen semanal ni difusión agrupada. No diagnostica Nextcloud.

Manual: [Seguimiento por módulo](colaboracion-intercentros-seguimiento.md).

## Avisos agrupados (31/10/2026)

- 56 pruebas de regresión de foros superadas, incluyendo 6 pruebas nuevas de
  cola: rollback, deduplicación, ventanas, concurrencia, lectura/borrado,
  fallo y reintento, pérdida de acceso y fallo de push.
- 28 pruebas de navegación de avisos superadas para web y móvil.
- Instalación aislada y actualización repetida correctas: 107 tablas,
  996 columnas; conserva datos anteriores y restaura una copia completa.
- Comprobación de tipos en API, web y móvil y compilaciones de API/web correctas.
- Los ensayos no envían push real; se simula ese canal. No se ha probado un
  dispositivo físico ni un proveedor push real en esta entrega.
- La migración aditiva está integrada en el actualizador. Solo se ha aplicado
  en desarrollo y en las bases aisladas de pruebas, no en producción.

Manual: [Avisos intercentros agrupados](colaboracion-intercentros-avisos.md).
