# Regresión de interfaz del perfil obligatorio

Ejecutar desde la raíz:

```sh
pnpm test:profile-ui
```

Requisitos: usuario no-root, Node y pnpm del proyecto, herramientas PostgreSQL
(`initdb`, `pg_ctl`, `createdb`, `psql`, `pg_restore`) y OpenSSL.
Instalar el navegador una vez si no está disponible:

```sh
pnpm --filter @workspace/api-server exec playwright install chromium
```

Para usar Chromium del sistema:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(command -v chromium)" pnpm test:profile-ui
```

## Qué comprueba

La misma matriz se ejecuta en el cliente de escritorio real (1440 × 1000) y en la
compilación web de Expo/PWA (400 × 820), contra la API real, sin respuestas
simuladas ni sesiones inyectadas. Es una prueba del cliente móvil web, no de
gestos ni botones físicos de Android/iOS.

Para cada rol —docente, jefatura, coordinador y superadministrador—:

- Inicio de sesión por formulario con cuenta sin centro: el perfil se impone.
- Inicio de sesión con centro pero sin módulos: también se impone.
- Escape, clic fuera del diálogo, ausencia de cerrar/cancelar/volver, acceso
  directo a otra ruta y botón Atrás del navegador no permiten omitirlo.
- La recarga conserva el bloqueo de un perfil incompleto.
- Guardar sin centro o sin módulos/declaración muestra un error y no desbloquea.
- Elegir centro y módulo permite continuar; se conservan tras recargar.
- Declarar «No imparto clase» también permite continuar y queda marcado tras
  recargar, sin módulos seleccionados.
- La respuesta de guardado conserva el rol y asigna centro/provincia correctos.

Excepción intencionada: una jefatura sin centro asignado no puede otorgarse un
ámbito administrativo mediante su perfil personal. Se comprueba que el intento
de guardado es rechazado y que sigue bloqueada tras recargar, pendiente de
asignación administrativa. La jefatura con centro sí completa la docencia.
Esta suite no cambia los permisos ni permite elegir un centro docente distinto
del ámbito de gestión.

Son 16 casos independientes, con contexto de navegador y cuenta nuevos por caso.
Los filtros habituales de Playwright se pueden pasar al comando, por ejemplo:

```sh
pnpm test:profile-ui --project=mobile --grep=department_head
```

## Aislamiento y limpieza

El ejecutor **no usa `DATABASE_URL` del proyecto** ni levanta/modifica sus
workflows. Elimina las variables heredadas, incluidas credenciales de servicios,
y crea un clúster PostgreSQL privado en un directorio temporal con permisos
restringidos. PostgreSQL no escucha en TCP. La API comprueba el nombre de base,
el directorio del servidor y su configuración antes de crear ninguna cuenta.
Las URL de los clientes son exclusivamente HTTPS de loopback y usan un
certificado efímero. Las compilaciones también son temporales; no sobrescriben
los archivos de distribución de los clientes.
La caché de Metro se crea dentro del directorio temporal y se limpia al exportar
para que no reutilice una URL de API compilada de otra ejecución. El navegador
además bloquea cualquier petición fuera del origen privado del caso.

Al terminar, fallar o recibir SIGINT/SIGTERM, se detienen la API y PostgreSQL y se
elimina el directorio completo, incluidas cuentas, contraseñas sintéticas y
archivos. No ejecutar como root ni apuntar esta prueba a una base compartida.

El informe HTML, capturas y trazas de los casos fallidos quedan en
`generated-artifacts/profile-ui/` (excluido de Git y publicación).
Para abrirlo:

```sh
pnpm --filter @workspace/api-server exec playwright show-report ../../generated-artifacts/profile-ui/report
```

Las pruebas están en `artifacts/api-server/test-ui/mandatory-profile.spec.ts`;
`playwright.profile.config.ts` restringe la selección a esta suite.
Su comprobación estática independiente es
`pnpm --filter @workspace/api-server run typecheck:profile-ui`.
