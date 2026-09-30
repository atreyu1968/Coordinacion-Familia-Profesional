# Coordina ADG

Plataforma web y móvil para coordinar familias profesionales, centros, profesorado, FCT y comunicación educativa.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server`: API Express, rutas y servicios.
- `artifacts/web`: aplicación web React.
- `artifacts/movil`: aplicación Expo.
- `lib/db`: esquema Drizzle y acceso a PostgreSQL.
- `lib/api-spec`: contrato OpenAPI; las librerías `lib/api-zod` y `lib/api-client-react` contienen código compartido generado.
- `scripts`: tareas administrativas y de inicialización de datos.
- `deploy`: instalación, actualización y configuración de producción.

## Architecture decisions

- El monorepo usa pnpm; las dependencias internas se enlazan como workspaces.
- La web y la aplicación móvil son clientes separados que comparten el contrato y tipos de API.
- PostgreSQL es la base de datos de la aplicación y Drizzle mantiene su esquema.
- En producción, nginx sirve los archivos compilados y hace proxy al API y sus websockets.
- Los adjuntos de producción se guardan localmente en `LOCAL_STORAGE_DIR` salvo configuración distinta.

## Product

Coordina ADG ofrece gestión de centros, profesorado, FCT, encuestas, eventos, mensajería en tiempo real, foros, videollamadas, formularios documentales y una wiki de documentación nativa. La interfaz está disponible en web y móvil.

## User preferences

- The mobile app icon and the web favicon must always be the same image. Source of truth is the mobile app icon (`artifacts/movil/assets/images/icon.png`, 1024×1024); regenerate the favicon as a downscale of it (`artifacts/web/public/favicon.png`, 256×256).

## Gotchas

- Para cambios de esquema en desarrollo, usar `pnpm --filter @workspace/db run push` con `DATABASE_URL` configurada.
- En producción, Drizzle `push` solo corre si el chequeo no detecta objetos preexistentes en `public`; incluso una tabla o un enum ajenos bloquean la ruta vacía. En bases existentes, `deploy/db.sh` valida las columnas y defaults esperados, claves PK/UNIQUE/FK y etiquetas de enums antes de agregar transaccionalmente solo las columnas de sesión aprobadas. Incompatibilidades requieren migración manual; tablas personalizadas no se modifican.
- Al volver a ejecutar `deploy/install.sh`, se conserva la contraseña almacenada en `DATABASE_URL`. Si `DB_PASSWORD` se especifica con un valor distinto, la instalación se detiene sin rotar el rol; la rotación de contraseña es un procedimiento separado.
- `deploy/update.sh` instala dependencias y luego sigue backup → prepare → migración/verificación del esquema → seeds → verificación final antes de construir la API. Si falla la compilación o readiness, restaura la distribución API previa si existía; DB y dependencias no se revierten. Si la publicación falla después de readiness, restaura web/nginx, pero deja la API nueva.
- `bash deploy/test-db.sh` comprueba base vacía, bloqueo de tabla/enum público ajeno, rechazo de esquema sin `users.email UNIQUE`, conservación de datos y tabla personalizada, y rechazo de un `session_nonce` incompatible. Corre como usuario no-root contra un clúster temporal privado; no prueba el despliegue completo apt/nginx/systemd.
- Los paquetes de aplicaciones y librerías del workspace son privados y pueden mantener versiones técnicas independientes de la versión de producto.
- La versión del contrato OpenAPI es independiente de la versión de producto.
- No aplicar ni probar scripts de instalación/actualización contra producción o una base de datos compartida.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `README.md` y `docs/instalacion-actualizacion.md`: instrucciones de despliegue y operación
