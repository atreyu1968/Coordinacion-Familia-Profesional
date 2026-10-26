# Importar y exportar cursos autodirigidos desde un ZIP

Los administradores de cursos pueden crear un curso completo con varias
lecciones desde **Autodirigido → Importar ZIP**. El ámbito se elige en la
aplicación; no se toma del archivo. El ZIP se carga en almacenamiento privado,
se valida y se convierte en un curso **borrador**. La importación no publica el
curso ni envía avisos a los usuarios.

## Estructura del ZIP

El archivo debe llamarse con extensión `.zip` e incluir
`coordina-course.json` directamente en la raíz. Los archivos de las lecciones
se guardan dentro de `assets/` y se enlazan desde el manifiesto:

```text
mi-curso.zip
├── coordina-course.json
└── assets/
    ├── introduccion.pdf
    ├── video-demostracion.mp4
    └── paquete-scorm.zip
```

No se debe incluir una carpeta superior que contenga el manifiesto. Los archivos
que no estén referenciados por una lección se ignoran.

## Exportar un curso

Los administradores con acceso al curso pueden abrirlo en **Autodirigido** y
usar **Exportar ZIP**. La descarga conserva el título, la descripción,
el orden y el tipo de las lecciones, además de
sus contenidos, adjuntos y paquetes SCORM. El manifiesto queda en la raíz del
archivo y sus recursos se incluyen bajo `assets/`, por lo que el ZIP se puede
volver a importar con el flujo descrito abajo.

La exportación respeta los mismos límites que la importación: 100 MB comprimidos,
250 MB descomprimidos, 100 MB por adjunto y 200 lecciones. Si falta un adjunto o
se supera un límite, la aplicación informa del error y no entrega un ZIP parcial.
El progreso de usuarios no forma parte del formato de curso y no se exporta.

## Exportar varios cursos juntos

En **Autodirigido**, los administradores pueden marcar los cursos que gestionan
y usar **Exportar selección** para descargar un único ZIP. El archivo contiene
una carpeta dentro de `cursos/` por curso; cada carpeta conserva su propio
`coordina-course.json` y sus recursos en `assets/`. El identificador del curso
forma parte del nombre de la carpeta para evitar colisiones entre títulos o
archivos iguales.

El ZIP incluye `informe-exportacion.json`, con los cursos incluidos y el motivo
por el que se omitió cualquiera que no se pudo exportar. La pantalla también
muestra esos motivos al terminar la descarga. La solicitud admite hasta 50
cursos y la operación completa se limita a 100 MB comprimidos, 250 MB
descomprimidos y 5.000 archivos. Se mantienen además los límites por curso
descritos arriba.

Para importar uno de los cursos exportados, extrae el ZIP conjunto, entra en la
carpeta correspondiente dentro de `cursos/` y crea un ZIP individual con
`coordina-course.json` y `assets/` en su raíz. Después impórtalo como se indica
en **Pasos de importación**. El ZIP conjunto no se importa directamente como un
solo curso.

## Manifiesto `coordina-course.json`

Este ejemplo incluye lecciones de texto, vídeo, cuestionario, archivo y SCORM:

```json
{
  "format": "coordina-adg-course",
  "version": 1,
  "course": {
    "title": "Introducción a la gestión administrativa",
    "description": "Material de apoyo para trabajar los conceptos básicos."
  },
  "lessons": [
    {
      "title": "Presentación",
      "kind": "text",
      "required": true,
      "content": {
        "text": "Objetivos y contenidos del curso."
      }
    },
    {
      "title": "Demostración",
      "kind": "video",
      "required": true,
      "content": {
        "url": "https://ejemplo.org/video.mp4"
      }
    },
    {
      "title": "Comprobación",
      "kind": "quiz",
      "required": true,
      "content": {
        "questions": [
          {
            "prompt": "¿Cuál es la finalidad del registro?",
            "options": [
              "Dejar constancia de la entrada o salida de documentos",
              "Sustituir el archivo de la organización"
            ],
            "correctIndex": 0
          }
        ]
      }
    },
    {
      "title": "Documento de apoyo",
      "kind": "file",
      "required": false,
      "file": "assets/introduccion.pdf"
    },
    {
      "title": "Actividad SCORM 1.2",
      "kind": "scorm12",
      "required": true,
      "file": "assets/paquete-scorm.zip"
    }
  ]
}
```

### Campos y reglas

- `format` debe ser `coordina-adg-course` y `version` debe ser `1`.
- `course.title` es obligatorio. `description` puede omitirse y, en ese caso,
  queda vacía.
- `lessons` conserva el orden del manifiesto y debe contener entre 1 y 200
  lecciones.
- `kind` admite `text`, `file`, `video`, `quiz`, `scorm12` y `scorm2004`.
- `required` indica si la lección cuenta para completar el curso; por defecto es
  `true`.
- Las lecciones `text` requieren `content.text`.
- Las lecciones `video` requieren `content.url` con una dirección HTTP o HTTPS.
- Las lecciones `quiz` requieren entre 1 y 100 preguntas. Cada pregunta tiene
  `prompt`, entre 2 y 20 `options` y `correctIndex`, que empieza en **0**.
- Las lecciones `file` requieren `file`, una ruta exacta dentro de `assets/`.
- Las lecciones `scorm12` y `scorm2004` requieren `file` apuntando a otro ZIP
  dentro de `assets/`. Ese paquete debe incluir `imsmanifest.xml` en su raíz y
  una ruta de inicio válida.
- No se admiten rutas absolutas, `..`, barras invertidas ni rutas codificadas
  con `%` en nombres de recursos.

## Límites y comportamiento

- ZIP exterior: máximo 100 MB.
- Contenido descomprimido total: máximo 250 MB; máximo 5.000 elementos.
- `coordina-course.json`: máximo 1 MB.
- Cada archivo de lección: máximo 100 MB.
- Solo se importa al ámbito elegido por el administrador. Para cursos de módulo,
  el módulo debe pertenecer a la familia profesional activa.
- El seguimiento SCORM se comunica desde el navegador y se utiliza como
  información de progreso dentro del curso.
- La importación valida todos los datos antes de guardar el curso. Si falla,
  elimina los archivos temporales y los recursos ya copiados; no deja un curso
  parcial.
- Tras importar, revisa el borrador en Autodirigido, comprueba las lecciones y
  usa **Publicar curso** cuando quieras hacerlo visible.

## Pasos de importación

1. Abre **Autodirigido** con una cuenta con permisos de gestión.
2. Pulsa **Importar ZIP**.
3. Selecciona el ámbito (cursos generales o un módulo autorizado) y el archivo.
4. Pulsa **Subir e importar** y espera a que termine la validación.
5. Abre el borrador resultante, revisa las lecciones y publícalo manualmente.

## Errores habituales

- **Falta `coordina-course.json`:** colócalo en la raíz del ZIP, no dentro de una
  subcarpeta.
- **No se encontró un archivo:** revisa que la ruta escrita en `file` coincida
  exactamente con el nombre y las mayúsculas/minúsculas del ZIP.
- **Lección de texto, vídeo o cuestionario no válida:** revisa los campos
  obligatorios y sus límites en el ejemplo.
- **Paquete SCORM no válido:** verifica que el ZIP interno incluya
  `imsmanifest.xml` en la raíz y un archivo de inicio existente.
- **Ámbito no autorizado:** elige un ámbito que aparezca en la lista de la
  aplicación.
