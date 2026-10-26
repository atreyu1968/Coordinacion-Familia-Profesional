---
name: Experiencia de aprendizaje
description: Referencia de producto del usuario para la presentación y navegación de los cursos.
---

La experiencia de los cursos debe tener una presentación profesional inspirada en Domestika, manteniendo la identidad de Coordinación FP.

**Why:** El usuario calificó la interfaz anterior como poco profesional y pidió «algo más parecido a Domestika».

Los cursos se realizan únicamente en la aplicación web desde un ordenador. En
la app móvil y la PWA solo se muestra un aviso de disponibilidad en la web,
también al abrir enlaces directos a un curso.
**Why:** el usuario considera demasiado difícil realizar los cursos en móvil y
pidió expresamente que no puedan realizarse desde la PWA.
**How to apply:** no restaurar el aula ni el catálogo interactivo en móvil/PWA.
Conservar los cursos y su progreso en el servidor; esta limitación no afecta a
los certificados personales descargables desde móvil.

En el aula, el temario debe quedar en un panel izquierdo contraíble y el material activo en el panel derecho; elegir una lección o usar anterior/siguiente debe cambiar el material en esa misma pantalla. El encabezado compacto debe poder fijarse a voluntad.

**Why:** el usuario especificó esta navegación para que el contenido sea la vista principal y el alumnado conserve el contexto del curso.

Abrir un curso desde el catálogo debe abrir un aula independiente en una pestaña/ventana nueva en la web de escritorio. Los PDF se muestran directamente, los SCORM se ejecutan dentro del aula y los vídeos tienen su reproductor; seleccionar una lección no debe abrir otra pestaña ni iniciar una descarga.

**Why:** el usuario reiteró expresamente estas condiciones al aportar una captura de Domestika; cambiar solo el estilo o el texto no satisface la experiencia solicitada.

Los SCORM deben abrirse directamente a pantalla completa, con una salida clara
para volver al curso sin perder el progreso.
**Why:** el usuario pidió expresamente que «los scorms deben abrirse en pantalla completa».
**How to apply:** ocupar la pantalla disponible de forma automática en la web
de escritorio; ocultar también las barras del navegador solo
cuando su API lo permita y haya una acción del usuario. No depender de esa API
para ofrecer el reproductor ampliado.

**How to apply:** Mantener esta referencia al evolucionar el catálogo, la presentación y el aula de escritorio. No reducir futuras mejoras a dar formato al texto ni mezclar la experiencia del alumno con formularios de administración.
