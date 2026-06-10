# Coordina ADG

Plataforma de coordinación de Familias Profesionales: gestión de centros,
profesorado, FCT, encuestas, eventos, mensajería en tiempo real, foros,
videollamadas y formularios documentales.

Es un monorepo **pnpm** con tres aplicaciones y dos librerías compartidas:

| Carpeta | Qué es |
| --- | --- |
| `artifacts/api-server` | API Express 5 + Drizzle ORM + Socket.io |
| `artifacts/web` | Aplicación web (React 19 + Vite + wouter) |
| `artifacts/movil` | Aplicación móvil (Expo) |
| `lib/db` | Esquema y cliente de PostgreSQL (Drizzle) |
| `lib/api-spec` / `api-zod` | Especificación de la API y tipos compartidos |

---

## 1. Instalación automática en un servidor Ubuntu

Pensado para un servidor **Ubuntu recién creado** (20.04 / 22.04 / 24.04), sin
nada instalado. El script se encarga de todo: paquetes del sistema, Node.js,
pnpm, PostgreSQL, compilación, base de datos, primer administrador, nginx y el
servicio de arranque automático.

En el servidor, como usuario con `sudo`:

```bash
# 1. Instalar git (lo único que hace falta para descargar el proyecto)
sudo apt-get update && sudo apt-get install -y git

# 2. Descargar el proyecto
git clone https://github.com/atreyu1968/Coordinacion-Familia-Profesional.git
cd Coordinacion-Familia-Profesional

# 3. Ejecutar el instalador
sudo bash deploy/install.sh
```

El instalador te preguntará:

- **Dominio o IP** del sitio (usa `_` si todavía no tienes dominio y quieres
  entrar por la IP del servidor).
- **Correo y contraseña** del primer administrador (rol *superadmin*).

Al terminar, abre `http://TU_DOMINIO_O_IP/` e inicia sesión con esas credenciales.

### Instalación sin preguntas (desatendida)

Puedes pasar todos los valores como variables de entorno:

```bash
sudo DOMAIN=adg.example.org \
     ADMIN_EMAIL=admin@example.org \
     ADMIN_PASSWORD='UnaContraseñaFuerte' \
     LETSENCRYPT_EMAIL=tucorreo@example.org \
     bash deploy/install.sh
```

Si indicas `DOMAIN` (real, no una IP) y `LETSENCRYPT_EMAIL`, el instalador
solicita e instala automáticamente un certificado **HTTPS** con Let's Encrypt.
El DNS del dominio debe apuntar ya al servidor.

> El instalador es **idempotente**: puedes volver a ejecutarlo sin miedo. No
> regenera el `JWT_SECRET` ni la contraseña de la base de datos si ya existen, y
> no toca el usuario administrador si ya está creado.

---

## 2. ¿Qué deja instalado?

- **PostgreSQL** con una base de datos y un usuario dedicados.
- El **API** corriendo como servicio systemd `coordina-adg` (arranca solo al
  reiniciar el servidor).
- **nginx** sirviendo la web compilada y haciendo de proxy del API y de los
  websockets (`/api` → Node).
- Un fichero **`.env`** en la raíz del proyecto con la configuración.
- Los ficheros subidos en formularios se guardan en disco, en
  `/var/lib/coordina-adg/storage` (almacenamiento **local**, sin depender de
  ningún servicio en la nube).

---

## 3. Operación diaria

```bash
# Estado y registros del API
systemctl status coordina-adg
journalctl -u coordina-adg -f

# Reiniciar / parar / arrancar
sudo systemctl restart coordina-adg
sudo systemctl stop coordina-adg
sudo systemctl start coordina-adg

# nginx
sudo systemctl restart nginx
```

### Actualizar a la última versión

```bash
cd /ruta/al/proyecto
sudo bash deploy/update.sh
```

Descarga el último código, reinstala dependencias, recompila, aplica los
cambios de esquema de la base de datos y reinicia el servicio.

### Copias de seguridad

- **Base de datos:**
  ```bash
  sudo -u postgres pg_dump coordina_adg > coordina_adg_$(date +%F).sql
  ```
- **Ficheros subidos:** copia el directorio `/var/lib/coordina-adg/storage`.

---

## 4. Variables de entorno

Se guardan en el fichero `.env` de la raíz (lo genera el instalador). Ver
`/.env.example` para una plantilla comentada.

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `NODE_ENV` | sí | `production` |
| `PORT` | sí | Puerto interno del API (nginx hace de proxy) |
| `DATABASE_URL` | sí | Cadena de conexión a PostgreSQL |
| `JWT_SECRET` | sí | Secreto para firmar los tokens de sesión |
| `LOG_LEVEL` | no | `info` por defecto |
| `STORAGE_DRIVER` | sí | `local` para guardar ficheros en disco |
| `LOCAL_STORAGE_DIR` | sí (con `local`) | Carpeta de los ficheros subidos |
| `PUBLIC_APP_URL` | no | Solo si el API se sirve en otro origen |
| `MOBILE_WEB_URL` | no | URL pública (HTTPS) para activar la página *App Móvil* |
| `JAAS_APP_ID` / `JAAS_KID` / `JAAS_PRIVATE_KEY` | no | Videollamadas con JaaS (8x8) |
| `RESEND_API_KEY` / `RESEND_FROM` | no | Envío de correos (recuperar contraseña) |
| `NEXTCLOUD_URL` / `NEXTCLOUD_ADMIN_USER` / `NEXTCLOUD_ADMIN_PASSWORD` | no | Espacio colaborativo (provisión de carpetas) |
| `NEXTCLOUD_OIDC_CLIENT_ID` / `NEXTCLOUD_OIDC_CLIENT_SECRET` | no | Cliente OIDC que usa Nextcloud para el inicio de sesión único |
| `OIDC_SIGNING_KEY` | no | Clave RSA (PEM) para firmar los *id_token* (si no, se genera y guarda sola) |

### Funciones opcionales

- **Videollamadas (JaaS / 8x8):** si no configuras las variables `JAAS_*`, la
  app usa el servidor público `meet.jit.si` automáticamente. Con JaaS, los
  coordinadores entran como moderadores sin pantalla de acceso. La clave privada
  se guarda en una sola línea, sustituyendo los saltos de línea por `\n`.
- **Correo (Resend):** necesario para que el flujo de *“he olvidado mi
  contraseña”* pueda enviar el código por correo. Sin él, el resto de la app
  funciona con normalidad.
- **App Móvil (PWA):** la app móvil es la propia web instalable en el teléfono
  (no necesita tienda de aplicaciones). La página *App Móvil* muestra el código
  QR de instalación solo si `MOBILE_WEB_URL` apunta a tu URL pública HTTPS. El
  instalador la rellena automáticamente cuando indicas un dominio real. La
  instalación como app y las notificaciones push requieren HTTPS.
- **Espacio colaborativo (Nextcloud + Collabora):** cada módulo dispone de una
  carpeta compartida y un editor de documentos en tiempo real. Es un componente
  opcional autoalojado; ver la sección *Espacio colaborativo* más abajo. Sin
  configurar, la página *Espacio colaborativo* avisa de que no está disponible y
  el resto de la app funciona con normalidad. Las credenciales se introducen en
  el **Panel de Control** (nunca se muestran de nuevo) o por variables de entorno.

---

## 4.b Espacio colaborativo (Nextcloud + Collabora)

Componente **opcional** que añade a cada módulo una carpeta compartida (Nextcloud
Drive) y edición de documentos en tiempo real (Collabora). El inicio de sesión es
único: el propio API actúa como proveedor de identidad (OIDC) y Nextcloud
(app `user_oidc`) es el cliente, así que el profesorado no ve una segunda pantalla
de acceso. Los miembros de cada espacio se calculan a partir de las asignaciones
docentes (`teaching_assignments`) y del rol/ámbito de cada usuario.

Requisitos: un servidor con **Docker** y dos subdominios del dominio principal
(p. ej. `drive.tu-dominio.com` y `office.tu-dominio.com`); usar subdominios del
mismo dominio registrable es importante para que el SSO funcione.

```bash
# 1) Levantar Nextcloud + Collabora, configurar nginx, HTTPS y la app user_oidc.
#    Ejecútalo DESPUÉS de deploy/install.sh. Es idempotente (se puede repetir).
sudo APP_DOMAIN=adg.tu-dominio.com LETSENCRYPT_EMAIL=tu@correo.com \
     bash deploy/nextcloud/install-collab.sh

# Alternativa manual del stack (sin nginx/SSO automáticos):
cd deploy/nextcloud && cp .env.example .env && $EDITOR .env
docker compose up -d
```

Al terminar, el script imprime la URL de Nextcloud y Collabora, el usuario y
contraseña de administración y el *Client ID/Secret* OIDC. Pégalos en
**Panel de Control → Espacio colaborativo** (o expórtalos como variables de
entorno `NEXTCLOUD_*`). A partir de ahí, cada usuario abre el espacio de su
módulo desde la página *Espacio colaborativo* de la web.

---

## 5. Desarrollo local (opcional)

Requiere Node.js 24+, pnpm 10+ y una base de datos PostgreSQL.

```bash
pnpm install                       # instalar dependencias
pnpm run typecheck                 # comprobación de tipos de todo el monorepo
pnpm --filter @workspace/api-server run test   # tests del API

# Aplicar el esquema a la base de datos
DATABASE_URL=postgresql://... pnpm --filter @workspace/db run push
```

Cada aplicación se ejecuta con su propio comando `dev` (`pnpm --filter
@workspace/web run dev`, etc.). En Replit, los *workflows* ya están configurados.

---

## 6. Arquitectura de producción

```
                ┌────────────────────── nginx (puerto 80/443) ──────────────────────┐
   Navegador ──►│  /            → web compilada (artifacts/web/dist/public)          │
                │  /api/        → proxy a Node 127.0.0.1:PORT (incl. websockets)      │
                └───────────────────────────────┬────────────────────────────────────┘
                                                 │
                                   API (systemd: coordina-adg)
                                                 │
                              ┌──────────────────┴───────────────────┐
                              ▼                                       ▼
                        PostgreSQL                      Disco local (ficheros subidos)
```

- La web hace peticiones **relativas** a `/api/`, así que todo va por nginx en el
  mismo origen (sin problemas de CORS ni de cookies).
- La autenticación usa un **token JWT** (Bearer), no cookies, por lo que funciona
  igual con HTTP o HTTPS.

---

## 7. Resolución de problemas

- **Toda la web da 500 (también detrás de Cloudflare):** nginx no puede leer los
  archivos web. El instalador publica la web en `/var/www/coordina-adg` (una
  ubicación que nginx siempre puede leer), justo para evitar esto. Si vienes de
  una instalación antigua que servía desde la carpeta del repo (p. ej.
  `/root/...` o `/home/usuario/...`), el `error.log` mostrará `Permission denied`
  y un `rewrite or internal redirection cycle`. Soluciónalo recompilando con la
  versión nueva, que copia la web a `/var/www`:
  ```bash
  cd /ruta/al/proyecto
  sudo bash deploy/update.sh
  ```
- **La web carga pero falla todo lo del API:** revisa el servicio con
  `journalctl -u coordina-adg -f`. Causas típicas: `DATABASE_URL` incorrecta o
  PostgreSQL parado (`systemctl status postgresql`).
- **`nginx -t` falla:** revisa `/etc/nginx/sites-available/coordina-adg`.
- **No puedo iniciar sesión:** vuelve a crear/restablecer el administrador:
  ```bash
  DATABASE_URL="$(grep ^DATABASE_URL= .env | cut -d= -f2-)" \
  SEED_ADMIN_EMAIL=admin@example.org SEED_ADMIN_PASSWORD='NuevaClave' \
  SEED_ADMIN_RESET_PASSWORD=true \
  pnpm --filter @workspace/scripts run seed-admin
  ```
- **Las subidas de ficheros fallan:** comprueba que `LOCAL_STORAGE_DIR` existe y
  pertenece al usuario del servicio, y que en nginx `client_max_body_size` es
  suficiente (50 MB por defecto).
```
