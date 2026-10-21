# Instalación y mantenimiento de Nextcloud/Collabora

El instalador principal, el actualizador de la aplicación y la ejecución directa
de `install-collab.sh` usan la misma comprobación previa.

- **Instalación existente correcta:** muestra las versiones y conserva imágenes,
  contenedores, configuración y credenciales. No ejecuta `pull`, `up`, ni reinicios.
  Las actualizaciones de mantenimiento no provocan cambios.
- **Fallo o actualización mayor estable disponible:** muestra el motivo y
  pregunta antes de modificar nada. La respuesta predeterminada es **No**.
- **Sin terminal interactivo:** no modifica una instalación existente sin
  autorización explícita. Para una ejecución deliberadamente autorizada:
  `sudo COLLAB_APPROVE_UPDATE=yes bash deploy/nextcloud/install-collab.sh`.
  Esto no fuerza cambios sobre una instalación correcta sin actualizaciones
  mayores y nunca omite las comprobaciones de seguridad.
- **Instalación nueva:** sigue el proceso habitual. `INSTALL_COLLAB=no` permite
  omitir este componente desde el instalador/actualizador principal.

La comprobación utiliza Python 3 (habitual en Ubuntu), Docker y consultas HTTP de
solo lectura: estado de los cuatro contenedores, estado y migraciones de
Nextcloud, aplicaciones necesarias habilitadas, configuración Office/HTTPS,
acceso local y público HTTPS a Nextcloud y al discovery WOPI de Collabora, y
discovery OpenID Connect de la aplicación. No inicia sesiones reales ni edita
documentos para comprobarlos.

Las versiones se consultan en Docker Hub sin descargar imágenes. Nextcloud se
compara por versión mayor; CODE por su rama de calendario (p. ej. `25.04` frente
a `26.04`). Se ignoran etiquetas flotantes y versiones preliminares. Si la
consulta falla se avisa: no se afirma que no existan actualizaciones ni se
descargan imágenes por precaución. Las imágenes personalizadas no se sustituyen
por las oficiales automáticamente.

Una actualización aprobada de Nextcloud avanza **solo una versión mayor cada
vez**, usando una etiqueta estable exacta. Si no se identifica una versión
intermedia, no se salta directamente a una posterior. Las demás imágenes se
conservan por su digest; una reparación no descarga imágenes nuevas. Si no es
posible identificar las cuatro imágenes existentes, no se recrea la instalación
a ciegas ni se arriesga una bajada de versión.

Antes de autorizar mantenimiento, guarda una copia de la base de datos y los
archivos de Nextcloud. Nunca uses `docker compose down -v` como reparación.
Al finalizar una operación se repiten las comprobaciones sin volver a consultar
actualizaciones; si fallan, se informa del fallo en lugar de anunciar éxito.

## Pruebas sin Docker ni red

```sh
python3 deploy/nextcloud/test_preflight.py
bash deploy/nextcloud/test-readiness.sh
bash -n deploy/install.sh deploy/update.sh deploy/nextcloud/install-collab.sh deploy/nextcloud/preflight.sh
```
