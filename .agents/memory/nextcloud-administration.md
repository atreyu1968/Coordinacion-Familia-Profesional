---
name: Administración de Nextcloud
description: Correspondencia del superadministrador de la plataforma con la administración global de Nextcloud.
---

El superadministrador de la plataforma debe ser también administrador de
Nextcloud.

**Why:** El usuario lo solicitó expresamente; administrar solo la plataforma
no cubre la gestión del espacio colaborativo.

**How to apply:** Mantener esa correspondencia al revisar el acceso a Nextcloud
y los cambios de rol o estado. No extenderla automáticamente a los coordinadores
ni confundir la identidad personal con las credenciales técnicas de integración.

Al confirmar que una cuenta quedó deshabilitada, normalizar el campo OCS `enabled`
si llega como booleano, número o cadena (`false`/`0`); un valor ausente o ambiguo
debe seguir fallando de forma segura. Exponer en el error solo el paso y los
códigos HTTP/OCS, nunca el cuerpo de respuesta ni credenciales.

Si la consulta inicial de una cuenta gestionada devuelve un código OCS explícito
998 o 404, la cuenta remota no existe y se puede continuar con el borrado local.
No tratar un 404 HTTP sin código OCS como prueba de ausencia, ni aceptar 404
durante la desactivación o la verificación final.

**Why:** Nextcloud puede serializar los estados booleanos de forma distinta; una
comparación estricta puede impedir un borrado local incluso cuando la cuenta ya
quedó deshabilitada.

**How to apply:** Mantener la interpretación estricta de valores reconocidos y
añadir pruebas para cada forma serializada y para los códigos OCS de usuario
inexistente al tocar flujos de revocación.
