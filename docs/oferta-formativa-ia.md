# Actualizar la oferta formativa con IA

## Acceso

Esta herramienta está disponible para el **superadministrador**:

- En **Centros → Actualizar oferta con IA**, consulta todos los centros no
  retirados que pertenecen a la familia profesional activa. Los filtros y la
  página del listado no limitan esta consulta.
- En la ficha de un centro, dentro de **Oferta formativa**, el mismo botón
  consulta únicamente ese centro.

Debe estar configurada la API de IA en el panel de control. Se utiliza la
configuración existente de DeepSeek u OpenAI; no hay que aportar otra clave
en este diálogo. El servidor descarga el documento oficial y proporciona su
texto al modelo: la IA no tiene que inventar enlaces ni navegar por su cuenta.

## Fuentes y curso

Si no se indica ninguna dirección, se consulta el
[portal oficial de oferta de FP por islas](https://www.gobiernodecanarias.org/educacion/web/formacion_profesional/orientacion/oferta_formacion_profesional/).
Se localizan los PDF enlazados que identifican el curso activo.

También puedes introducir hasta diez direcciones oficiales de Educación del
Gobierno de Canarias, una por línea, tanto páginas HTML como PDF con texto.
Esto permite utilizar la documentación de un curso anterior o fuentes
específicas de FP Adaptada. Un PDF escaneado sin texto no se interpreta mediante
suposiciones.

**No se sustituye el curso activo por el más reciente que aparezca en internet.**
La fuente debe identificar el mismo año académico mediante su encabezado o
su ruta oficial. Una página que únicamente diga «curso actual» no basta.
Si el portal ya anuncia otro año, el diálogo lo advierte y permite introducir
el enlace del año correcto. No encontrar una fuente válida no significa que
el centro carezca de oferta.

Los documentos titulados «planificación previa» se señalan como tales. Su
publicación no prueba por sí sola que un grupo finalmente se haya abierto.
Tampoco debe confundirse una enseñanza autorizada con una efectivamente ofertada.

## Revisión y guardado

1. Inicia la consulta. Cada documento se analiza por separado, con progreso
   visible y sin lanzar todas las peticiones de IA simultáneamente.
2. Revisa el centro, su código oficial, el ciclo, la cita literal y el enlace
   de origen. Se distinguen los ciclos ya registrados de las nuevas propuestas.
3. Confirma la revisión y añade las propuestas aceptadas. Si alguna fuente
   no pudo consultarse, se avisa de que el resultado es parcial.
4. Consulta el resumen de altas, coincidencias ya existentes y centros
   pendientes. Los listados y las tarjetas del panel se vuelven a consultar.

Las propuestas caducan a los 45 minutos y solo puede aplicarlas el usuario que
las solicitó. Si cambia el curso, la familia, el código de un centro o un ciclo
antes de guardar, hay que repetir la consulta.

## Límites de seguridad

- Se comprueban los códigos de los centros y los ciclos del catálogo de la
  familia activa. Una denominación desconocida no crea un ciclo automáticamente.
- La prueba debe ser una cita real que relacione el código del centro con el
  ciclo. Las coincidencias ambiguas se descartan para revisión manual.
- Solo se añaden ciclos que falten en el **curso activo**. No se borra la
  oferta anterior, no se modifican otros cursos y no se sustituyen turnos
  introducidos manualmente. Las bajas o correcciones siguen gestionándose
  manualmente desde la ficha del centro.
- Repetir la misma importación no duplica los ciclos. Si falla la aplicación
  de una propuesta, se revierte toda esa operación.
- No se envían perfiles ni documentos privados a la IA: esta consulta usa el
  catálogo de centros y ciclos y los documentos públicos oficiales.

La herramienta no necesita nuevas tablas ni migraciones. El instalador y el
actualizador ya incluyen `pdftotext` mediante `poppler-utils`, necesario para
leer los PDF oficiales.
