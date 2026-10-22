---
name: Certificados de asistencia
description: Reglas de identidad, evidencia de asistencia y verificación de los certificados de eventos.
---

## Registro e identidad
El registro por QR es exclusivo de personas autenticadas en la aplicación.
Se usa su perfil sin volver a pedir nombre o correo. No hay registro anónimo.
**Why:** el usuario rectificó expresamente la opción inicial de admitir asistentes sin cuenta.
**How to apply:** proteger tanto la consulta del evento por QR como el registro; nunca aceptar una identidad elegida en el cuerpo de la petición.

El organizador puede importar un CSV de asistencias comprobadas. Sus destinatarios
deben registrarse con exactamente el correo aportado en el CSV y verificar que
lo poseen antes de descargar sus certificados, tanto en escritorio como en móvil.
**Why:** el usuario exigió cuentas individuales vinculadas al correo del listado y descarga personal desde ambas aplicaciones.
**How to apply:** filtrar por el correo de la sesión, no por un correo/usuario recibido del cliente; una invitación sigue siendo necesaria para crear una cuenta nueva.

## Evidencia y verificación
Inscribirse, responder «Asistiré» o escanear un QR no demuestra asistencia.
El organizador debe validarla antes de la expedición. La anulación retira esa
aprobación hasta una nueva revisión, para impedir que el destinatario la deshaga
autoexpidiendo otro certificado.
**Why:** el QR debe verificar una asistencia real y una emisión autorizada, no convertir una intención o un enlace reenviado en prueba.
**How to apply:** mantener separadas inscripción, validación y expedición; serializar revisión, emisión y anulación por asistencia.

Los certificados son PDF personalizados para el evento concreto, basados en el
ejemplo del usuario, sin fijar el nombre, reunión ni fecha de ese ejemplo.
Su QR público verifica el registro original y la anulación, sin publicar correo
ni listados. Es verificación electrónica, no firma electrónica cualificada.
**Why:** el usuario pidió PDF y comprobación de autenticidad; un QR no tiene por sí solo ese valor jurídico.
**How to apply:** conservar los datos originales de emisión ante cambios posteriores; no sustituirlos por datos actuales del evento/perfil.
