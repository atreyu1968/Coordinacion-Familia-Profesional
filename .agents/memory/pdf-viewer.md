---
name: Vista previa integrada de PDF
description: Alcance y restricciones de la previsualización de PDF en escritorio, PWA y clientes nativos.
---

La vista previa debe estar disponible en escritorio/PWA y en las pantallas móviles que ofrecen archivos PDF, conservando la descarga y los permisos existentes.

**Why:** El usuario pidió que los PDF se abran dentro de la aplicación sin descargarlos y confirmó un visor integrado con reconstrucción de la aplicación móvil. Los archivos protegidos no deben quedar expuestos al evitar sus rutas autorizadas.

**How to apply:** Obtener siempre adjuntos privados a través de sus endpoints autenticados; no pasar rutas de almacenamiento sin autorización al visor. Los archivos temporales del visor nativo se eliminan al salir. Un cliente nativo distribuido debe reconstruirse para incluir las dependencias PDF; Expo Go y la PWA no sustituyen esa compilación.

El visor web/PWA debe renderizar los PDF con PDF.js, no con `react-native-webview` ni depender del visor PDF del navegador.

**Why:** En Android/iOS la PWA usa la implementación web; WebView no admite esa plataforma y los PDF incrustados directamente no son fiables en navegadores móviles. Los documentos privados no deben enviarse a visores de terceros.

**How to apply:** Mantener separadas las implementaciones web y nativa. Servir los recursos de PDF.js localmente y pasar al visor solo bytes ya autorizados, nunca credenciales. El directorio estático del renderer no debe coincidir con la ruta de Expo: nginx prioriza directorios existentes frente al fallback de la aplicación y rompería los enlaces directos.

Los recursos de módulo de PDF.js deben publicarse como `.js` en las instalaciones
autogestionadas, salvo que se haya comprobado el MIME de `.mjs` en el servidor.
**Why:** el nginx de producción entregaba el worker `.mjs` existente con estado
200 pero `application/octet-stream`; el navegador rechazaba tanto el worker
como su importación de respaldo. No era un problema del PDF ni de sus permisos.
**How to apply:** comprobar extensión y referencia del worker en la compilación
real; una respuesta 200 no basta para validar un módulo JavaScript.
