---
name: Descargas HTML como DOCX
description: Alcance de conversión a Word para los adjuntos HTML descargables de la aplicación.
---

En las superficies de descarga de adjuntos, los archivos `.html` y `.htm` deben conservar la descarga original y ofrecer además una conversión DOCX. La conversión prioriza contenido legible, títulos, listas y tablas; no ejecuta scripts ni pretende convertir el runtime SCORM.

Al convertir enlaces HTML a Word, solo se crean hipervínculos para URL absolutas `http:`, `https:` y `mailto:`. Los esquemas restantes se conservan como texto sin vínculo.
**Why:** impedir que un HTML adjunto introduzca vínculos ejecutables o esquemas no soportados en el DOCX.
**How to apply:** mantener esta lista permitida al cambiar el conversor y comprobarla en pruebas junto con los vínculos web normales.

**Why:** el usuario pidió que todas las descargas HTML de la aplicación permitan también descargar DOCX.
**How to apply:** al añadir otra superficie de descarga de adjuntos, comprobar la extensión y reutilizar el conversor común; mantener intacto el archivo original y los HTML que se ejecutan como parte de un paquete SCORM.

Al conservar imágenes, aceptar solo datos rasterizados validados o recursos del mismo origen, con tamaño limitado; omitir SVG y recursos externos. Seguir excluyendo scripts, iframes, formularios y controles.
**Why:** renderizar imágenes remotas contactaría sitios de terceros, y SVG/contenido activo puede ejecutar código o introducir contenido no previsto en el documento.
**How to apply:** mantener este límite de confianza al ampliar formatos de imagen o la carga de recursos del conversor.
