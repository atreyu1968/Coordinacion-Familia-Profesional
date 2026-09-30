# Instalación, actualización y recuperación

Guía para la versión de producto **4.1.0** de Coordina ADG. Describe lo que hacen
los scripts actuales; no sustituye la comprobación de requisitos y conectividad
del servidor de destino.

## Instalación nueva

En un servidor Ubuntu compatible, clona el repositorio y ejecuta el instalador
como `root` (normalmente mediante `sudo`):

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/atreyu1968/Coordinacion-Familia-Profesional.git
cd Coordinacion-Familia-Profesional
sudo bash deploy/install.sh
```

El instalador configura PostgreSQL, Node.js/pnpm, dependencias, compilaciones,
`.env`, servicio systemd y nginx. Pregunta el dominio/IP, credenciales del primer
administrador, URL pública móvil y opciones de integraciones. Para un dominio
real puede solicitar HTTPS si se proporciona `LETSENCRYPT_EMAIL`. Para una
instalación sin preguntas se pueden proporcionar, entre otras, `DOMAIN`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD` y `LETSENCRYPT_EMAIL` como variables de entorno;
el ejemplo completo está en el README.

Al volver a ejecutar el instalador, conserva la contraseña PostgreSQL guardada en
`DATABASE_URL`. Si se proporciona un `DB_PASSWORD` explícito distinto, se detiene
sin cambiar la contraseña del rol; la rotación debe hacerse mediante un
procedimiento separado y respaldado.

Si la base contiene tablas públicas, antes de cambiar el esquema el instalador crea
y valida una copia. Drizzle `push` sin `--force` se usa únicamente cuando el
chequeo de catálogo no detecta objetos preexistentes en `public`; una tabla u otro
objeto público no relacionado (por ejemplo, un enum) impide tratar la base como
vacía y bloquea el `push`. En una base existente, primero se valida el catálogo
esperado completo:
columnas, tipos, nulabilidad y defaults, claves primarias, únicas y foráneas, y
etiquetas de enums. Luego habilita/verifica `pgcrypto` (necesario para UUID en
PostgreSQL 12) y, en una transacción, añade `users.token_version` y
`users.session_nonce` si faltan. También añade `invitations.max_uses` y
`invitations.used_count` mediante una migración aditiva: las invitaciones antiguas
siguen siendo de un uso y las ya utilizadas permanecen agotadas. Revisa definiciones
y filas existentes, y vuelve a verificar el esquema tras la migración. No intenta reconciliar
el resto con Drizzle ni cambia tablas personalizadas.

En la instalación, después de preparar/migrar el esquema se cargan datos de
referencia, se crea el administrador si hace falta y se ejecuta la verificación
final antes de construir la API. Se guarda la distribución API previa si existe;
si falla la compilación o readiness, se intenta restaurarla. Las dependencias y
los cambios de base de datos no se revierten automáticamente.

Si una tabla/columna esperada no existe o su tipo/nulabilidad es incompatible, o
una columna de sesión existente tiene definición/valores inválidos, la migración
aborta; las adiciones de sesión parciales se revierten como una transacción. El
estado incompatible requiere revisión y migración manual. La copia previa no hace
seguro forzar un esquema desconocido ni sustituye dicha revisión.

Los docentes de prueba no se crean por defecto. Para solicitarlos en la
instalación:

```bash
sudo SEED_TEST_TEACHERS=yes bash deploy/install.sh
```

Outline es una integración heredada y no se instala por defecto. En la instalación
inicial se puede pedir explícitamente con `INSTALL_WIKI=yes`; requiere subdominio
propio. La wiki nativa de la aplicación es la opción normal. Nextcloud + Collabora
es opcional y el instalador puede ofrecerlo con dominio real.

## Actualización

Con `.env` existente, descarga el código **antes de iniciar un nuevo proceso**
del actualizador. Si `git status --short` muestra cambios, `git pull` falla o
no aparece la migración esperada, detente y revisa la instalación:

```bash
cd /ruta/al/Coordinacion-Familia-Profesional
git status --short
git pull --ff-only
grep -n 'migrate_existing_legal_acceptance_columns' deploy/db.sh
sudo env SEED_TEST_TEACHERS=no INSTALL_WIKI=no bash deploy/update.sh
```

El script también hace `git pull --ff-only`, pero descargar previamente evita
que un proceso Bash ya iniciado siga ejecutando lógica antigua tras el pull.
Instala dependencias bloqueadas. Antes de
construir la API, ejecuta este orden: backup cuando corresponde, comprobación de
conexión, clasificación y migración/verificación del esquema, carga de datos de
referencia (y de docentes de prueba, si se solicita) y verificación final. En una
base existente verifica el catálogo esperado completo y aplica solo las adiciones
de sesión, invitaciones y aceptación legal aprobadas en transacciones; nunca ejecuta Drizzle `push` sobre
esa base. Solo una base cuyo catálogo `public` no contiene objetos preexistentes
sigue la ruta vacía de Drizzle `push`. Los esquemas incompatibles —incluidas claves
o etiquetas de enums que no coincidan— abortan y requieren migración manual.

**Antes de actualizar un servidor público**, completar y revisar los borradores
de términos, privacidad y cookies de la web. Se ha indicado un responsable y
una sede y un correo de privacidad. La dirección postal del centro indicado se
ha tomado de la ficha oficial del Gobierno de Canarias
(`https://www.gobiernodecanarias.org/educacion/centroseducativos/buscador-centros-openlayers/resultados/detalle?codigo=38001553`);
queda por confirmar que sea el domicilio válido de contacto para este servicio.
También hay que verificar los proveedores activos en el servidor de destino,
las bases jurídicas por finalidad y establecer y aplicar plazos de conservación
y supresión (incluidas copias, registros y archivos). El código desactiva cuentas,
pero no las borra físicamente; no se deben prometer plazos de eliminación sin
implementarlos. Antes de eliminar la marca de borrador hace falta revisión profesional.
El formulario registra la versión que cada nuevo usuario aceptó, pero aceptar
un borrador no acredita cumplimiento legal. Al publicar una versión definitiva,
cambiar la versión legal en API y web de forma coordinada. Si Nextcloud ya está
instalado, el actualizador intentará refrescarlo también: `INSTALL_COLLAB=no`
solo evita la instalación inicial, no ese refresco.

```bash
sudo SEED_TEST_TEACHERS=yes bash deploy/update.sh
```

Antes de tocar la publicación web, se respalda la distribución API anterior, se
construye la nueva API y se reinicia el servicio. Si falla la compilación o la
comprobación de readiness (`/api/readyz`, que valida el acceso a la base) o del
esquema, se restaura la distribución API anterior si existía. Tras superar
readiness, se publica la nueva web y se ajusta nginx. Si falla la publicación, el
manejador restaura los archivos web y la configuración nginx previos, pero no
revierte la API que ya superó readiness. La restauración de la distribución API
no revierte las dependencias instaladas ni la migración de PostgreSQL. Para una
reversión completa hacen falta la copia de base de datos y la versión de código
compatible con ese esquema.
Outline no se modifica en una actualización normal. Solo se solicita expresamente
así:

```bash
sudo INSTALL_WIKI=yes bash deploy/update.sh
```

Las sesiones/JWT emitidos por versiones anteriores no contienen los campos de
sesión que valida 4.1.0. Después de actualizar, cada usuario tendrá que iniciar
sesión una vez de nuevo; no implica cambiar contraseñas ni perder cuentas.

## Copia previa a migración y restauración

Si la base ya contiene tablas, `install.sh` y `update.sh` ejecutan la operación
`backup` de `deploy/db.sh` antes de cambiar el esquema. La copia se crea en formato
custom de `pg_dump`, se valida con `pg_restore --list` y se protege con permisos
restringidos:

- Directorio predeterminado: `/var/backups/coordina-adg` (modo `700`).
- Nombre: `pre-schema-<fecha UTC>-<sufijo aleatorio>.dump`.
- Archivo: modo `600`.
- Para elegir otro directorio, define `DB_BACKUP_DIR` al ejecutar el instalador o
  la actualización.

El flujo **no restaura automáticamente** PostgreSQL, el código fuente ni las
dependencias instaladas. Si falla la compilación de la API o su readiness, el
actualizador intenta restaurar la distribución API previa; si falla la publicación
web después de readiness, restaura web/nginx pero conserva la API nueva. Para volver
completamente atrás, primero detén el servicio, verifica el nombre de la base destino
y recupera el código y las dependencias compatibles con la copia previa que se va a
restaurar. Haz también una copia del estado actual si necesitas conservarlo. Para
PostgreSQL local con autenticación *peer*, usa el rol
administrativo local `postgres`, y sustituye `coordina_adg` por el nombre real de
la base y del rol de aplicación propietario (no pases el `DATABASE_URL` con
contraseña como argumento):

```bash
set -e
DB_NAME='coordina_adg' # reemplazar por el nombre real de la base de datos
DB_ROLE='coordina_adg' # reemplazar por el rol de aplicación de DATABASE_URL
BACKUP='/var/backups/coordina-adg/pre-schema-AAA.dump' # sustituir por el archivo real
sudo install -o postgres -g postgres -m 600 \
  "$BACKUP" /tmp/coordina-adg-restore.dump
sudo systemctl stop coordina-adg
sudo -u postgres pg_restore --clean --if-exists --no-owner --no-acl \
  --role="$DB_ROLE" --dbname="$DB_NAME" /tmp/coordina-adg-restore.dump
sudo rm -f /tmp/coordina-adg-restore.dump
```

No inicies el servicio hasta haber recuperado el código y las dependencias
compatibles; en una restauración manual podría hacer falta recompilar. Después
arranca el servicio con `sudo systemctl start coordina-adg` y comprueba
`/api/readyz`. El archivo original de backup suele ser legible solo por `root`
(modo `600`); el
paso `install` hace una copia temporal privada accesible al rol local `postgres`.
`--clean` elimina del destino los objetos que se restaurarán: comprueba dos veces
el nombre de base y no ejecutes esto contra una base equivocada. En bases remotas
o sin autenticación peer, usa un fichero de servicio/credenciales libpq con
permisos seguros, no una contraseña en argumentos. Tras restaurar, recupera y
ejecuta la versión anterior del código compatible con ese esquema; no arranques el
API 4.1.0 contra una base pre-4.1.0. Comprueba finalmente el servicio y `/api/readyz`.

La copia de PostgreSQL no contiene los ficheros subidos. Respalda y restaura por
separado `/var/lib/coordina-adg/storage` (o el valor configurado en
`LOCAL_STORAGE_DIR`) y cualquier almacenamiento de objetos externo. Para que una
recuperación sea coherente, la base y el almacenamiento deben corresponder a un
punto temporal compatible.

### Copias ZIP de la aplicación

El formato vigente de backup ZIP es **v5**; no acepta formatos anteriores. El ZIP
incluye datos de la base y referencias/inventario de los objetos, pero **no incluye
los bytes de los objetos almacenados** (`bytesIncluded: false`). Al restaurar,
Coordina ADG verifica que los objetos referenciados se puedan comprobar y bloquea
la operación si faltan, no coinciden o no se pueden verificar. Conserva por tanto
una copia independiente del almacenamiento local/externo además del ZIP.

## Prueba aislada de migraciones PostgreSQL

Para probar migración de base vacía y actualización de una base existente sin
apuntar a una base configurada o compartida:

```bash
bash deploy/test-db.sh
```

Ejecuta el comando como usuario **sin privilegios de root**. Requiere disponibles
`initdb`, `pg_ctl`, `createdb`, `psql`, `pg_restore`, `pnpm` y `node`; crea un clúster
PostgreSQL temporal privado bajo el directorio temporal del sistema, usa el puerto
55439 y lo elimina al terminar. Comprueba la creación de una base vacía y que una
tabla pública o un enum público no relacionado bloquea Drizzle `push` sin alterar
el objeto. En una base existente, comprueba la conservación de usuario y tabla
personalizada, el rechazo de un `session_nonce` incompatible sin cambiar su
definición ni perder la fila, y
el rechazo de un esquema al que le falta `users.email UNIQUE`. También valida los
defaults, claves y enums requeridos, y los permisos de las copias generadas.

Esta prueba cubre únicamente las rutas de base de datos/migración. **No ejecuta ni
valida una instalación integral** con `apt`, nginx, systemd, certificados,
Nextcloud/Collabora o publicación real de web/app móvil. No sustituye una prueba
controlada de despliegue en un servidor de ensayo. La instalación integral con
paquetes del sistema y servicios nginx/systemd no se ha ejecutado como parte de
esta comprobación documental.
