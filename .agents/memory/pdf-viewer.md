---
name: Vista previa integrada de PDF
description: Alcance y restricciones de la previsualización de PDF en escritorio, PWA y clientes nativos.
---

La vista previa debe estar disponible en escritorio/PWA y en las pantallas móviles que ofrecen archivos PDF, conservando la descarga y los permisos existentes.

**Why:** El usuario pidió que los PDF se abran dentro de la aplicación sin descargarlos y confirmó un visor integrado con reconstrucción de la aplicación móvil. Los archivos protegidos no deben quedar expuestos al evitar sus rutas autorizadas.

**How to apply:** Obtener siempre adjuntos privados a través de sus endpoints autenticados; no pasar rutas de almacenamiento sin autorización al visor. Los archivos temporales del visor nativo se eliminan al salir. Un cliente nativo distribuido debe reconstruirse para incluir las dependencias PDF; Expo Go y la PWA no sustituyen esa compilación.
