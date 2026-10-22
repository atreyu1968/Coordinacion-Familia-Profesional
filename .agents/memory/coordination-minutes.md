---
name: Actas de coordinación
description: Privacidad, publicación revisada y alcance multimedia de las actas de reuniones de coordinación.
---

Las reuniones de coordinación son un tipo de evento. La opción de levantar acta
es opcional y está reservada a la coordinación con permiso sobre la reunión.
El borrador, las fuentes y la conversación son privados; el coordinador puede
compartir explícitamente una versión final revisada con quienes tienen acceso al evento.
Los cambios del borrador no alteran automáticamente esa versión compartida.
**Why:** el usuario pidió que la opción fuera visible solo para el coordinador y eligió que este pudiera compartir el acta final.
**How to apply:** distinguir siempre gestión privada y lectura de la instantánea publicada; no exponer fuentes ni conversaciones a los lectores del acta.

La IA debe trabajar con documentos y audios y, en vídeos, con lo hablado
**y** las diapositivas e imágenes. Un análisis meramente de audio no satisface el alcance elegido.
El micrófono permite aportar instrucciones e ideas y revisar el acta, no acreditar
automáticamente acuerdos o asistencia.
**Why:** el usuario eligió expresamente análisis audiovisual y pidió hablar con la IA para aportar instrucciones e ideas.
**How to apply:** indicar los límites del muestreo visual, conservar una revisión humana previa a publicar y no presentar ideas dictadas como evidencia de decisiones.

La disponibilidad de procesamiento debe comprobarse por tipo de medio: audio/vídeo requiere ffmpeg y ffprobe; PDF requiere Poppler. La ausencia de herramientas PDF no debe bloquear grabaciones.
**Why:** el despliegue puede tener herramientas multimedia sin Poppler, y las dependencias no son intercambiables.
**How to apply:** validar cada archivo contra su grupo de herramientas y presentar fallos separados en la interfaz y configuración.

Las respuestas tardías de IA no pueden sustituir modificaciones guardadas mientras
se procesaban. Las autorizaciones deben comprobarse también al ejecutar trabajos
en segundo plano, no solo al encolarlos.
**Why:** las grabaciones pueden tardar varios minutos; durante ese tiempo pueden cambiar el borrador, las fuentes o los permisos.
**How to apply:** rechazar resultados obsoletos sin borrar el trabajo humano y permitir reintentos explícitos.

Si DeepSeek está configurado, conservarlo como proveedor de redacción; OpenAI
puede redactar cuando no haya DeepSeek, pero no debe sustituirlo silenciosamente
al fallar una petición.
**Why:** aprovechar la integración multimedia disponible sin eludir una configuración explícita del despliegue.
**How to apply:** mostrar el error del proveedor elegido; no reenviar el mismo material a otro proveedor como reintento oculto.

El borrador debe verse como un documento maquetado, no como marcas Markdown sin procesar; las tablas y listas deben conservar formato. Mantener claras y separadas las descargas PDF/DOCX del borrador, el adjunto definitivo y la publicación.
El adjunto definitivo no se envía a la IA y solo se comparte al publicar. Una subida posterior no debe cambiar en silencio el adjunto de una versión ya publicada.
**Why:** el usuario señaló que la mezcla de texto y Markdown, las tablas y la falta de controles claros hacían difícil revisar y finalizar actas.
**How to apply:** renderizar los formatos de texto admitidos en la vista previa y ofrecer PDF y DOCX editable a partir del borrador actual. Para resolver qué archivo corresponde a la versión compartida, elegir la subida más reciente creada antes o en el momento de publicación; una subida más nueva solo se hace pública al volver a publicar.
