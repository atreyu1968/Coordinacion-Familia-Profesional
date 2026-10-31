# Colaboración intercentros — diagnóstico y alcance inicial

## Etapa 0 · 30 de octubre de 2026

Rama: `feature/colaboracion-intercentros`. Inspección del código y base de
**desarrollo**, no auditoría del servidor de producción. No se ha conectado ni
modificado la base de producción, ni actualizado Nextcloud/Collabora.

### Inventario observado

- Monorepo pnpm: Express/Drizzle, React/Vite, Expo y PostgreSQL.
- Solo Administración y Gestión: 143 módulos activos; 87 globales; 118 sin
  código informado; siete grupos con código repetido. Se aplica el filtro
  familiar existente, no coincidencias libres de nombre.
- Cero RA y cero CE en esta base. No hay fuente curricular verificada en el modelo.
- Un hilo de foro activo. Las asignaciones contienen cursos con formatos distintos
  (`2025-2026` y `2025/2026`); se conserva la selección del curso activo existente.
- No se infiere de estos recuentos el estado del servidor instalado.

### Reutilización y archivos afectados

| Área | Fuente actual | Decisión |
|---|---|---|
| Foro | `routes/forums.ts`, tablas `forum_threads/posts/reads/moderation_events` | Conservar IDs, mensajes, lecturas, URLs y moderación; añadir contexto relacional |
| Currículo | `schema/learningOutcomes.ts`, `components/module-outcomes.tsx` | Usar los RA/CE existentes, nunca inventar ni importar textos por nombre |
| Acceso | permisos de `forums.ts`, asignaciones y `teachingModuleAccess.ts` | Aplicar exactamente los mismos controles a estructura y generación |
| Identidad | `schema/modules.ts`, `familyCatalog.ts` | Piloto solo sobre un módulo global validado; duplicados requieren resolución explícita |
| API | `lib/api-spec/openapi.yaml` | Contrato y código generado antes de integrar clientes |
| Web/móvil | `pages/foros.tsx`, `app/foros/modulo/[id].tsx` | Ampliar el foro actual y enlazar RA/CE, sin otra aplicación |
| Recursos | biblioteca `resources` | Reutilizar en etapa 2; no crear almacén ni catálogo alternativos |
| Documentos | wiki nativa y `moduleNextcloudSync.ts` | Mantener servicios; acuerdos y coedición corresponden a etapa 3 |
| Actualización | `deploy/db.sh`, `verify-schema.ts`, `deploy/test-db.sh` | Migración aditiva revisada y verificación estricta, nunca `push-force` |

### Entidades mínimas de etapa 1

1. Configuración por módulo: identidad y fuente declaradas, verificación humana,
   huella de los RA/CE, activación reversible y plantilla versionada.
2. Historial de configuraciones: conserva cada versión de plantilla y su responsable.
3. Contexto de hilo: FK al hilo existente y clave natural única módulo/clave;
   referencia al RA o CE existente, versión de plantilla y de currículo.

No se crea una comunidad paralela: el piloto reutiliza el módulo global como
identidad. No se fusionan módulos ni se conceden accesos cruzados entre sus IDs.
Las nuevas operaciones se bloquean fuera de Administración y Gestión, incluso
para superadministración. La revisión de duplicados se limita a esta familia.
Los módulos específicos de centro o con códigos duplicados muestran diagnóstico;
un mapeo explícito entre variantes se resolverá antes de incorporarlos al piloto.

### Riesgos y límites

- La verificación es una declaración humana sobre los datos presentes; una URL no
  demuestra por sí sola que un currículo sea correcto ni que esté vigente.
- Una huella de contenido evita generar nuevos hilos tras cambios de RA/CE sin
  nueva revisión; los hilos históricos conservan identidad y versión.
- La clave única y una transacción serializada por módulo evitan duplicados,
  incluso ante inicializaciones simultáneas.
- Desactivar la estructura no elimina hilos, mensajes ni historial.
- No es posible activar dos o tres módulos reales con RA/CE verificados en esta
  base: faltan los datos. Las pruebas usan fixtures temporales, no currículo falso
  presentado como oficial.
- Los acuerdos, asociaciones múltiples de recursos, solucionarios, publicaciones
  en wiki y resúmenes de seguimiento son etapas posteriores, no están implícitos
  en la primera entrega.

## Seguridad de despliegue y reversión

La ampliación exige esquema nuevo. Antes de migrar producción se requiere
aprobación específica y respaldo de PostgreSQL. Los archivos locales y Nextcloud
se respaldan por separado: un dump SQL no conserva esos bytes.

No reinstalar Nextcloud/Collabora ni invalidar sesiones como parte de esta mejora.
Ensayar el actualizador en una base aislada. Tras una reversión de código conservar
las tablas aditivas; no ejecutar DROP ni restaurar solo PostgreSQL si entretanto
hubo escrituras legítimas. Una restauración completa requiere la copia y el código
correspondientes, una ventana controlada y el procedimiento de recuperación del
proyecto. Desactivar primero los pilotos permite retirar la interfaz sin perder
debates.
