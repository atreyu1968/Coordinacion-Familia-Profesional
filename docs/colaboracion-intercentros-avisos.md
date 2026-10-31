# Avisos intercentros agrupados

## Funcionamiento

Los módulos intercentros de Administración y Gestión agrupan sus novedades en
ventanas de cinco minutos. Cada persona recibe **un único aviso por módulo y
ventana**, aunque haya varias aportaciones.

Se incluyen:

- Nuevos hilos generados al inicializar un piloto verificado.
- Respuestas nuevas en sus hilos estructurados.
- Síntesis y cambios de versión o estado, incluido el archivo.
- Apertura de consultas y publicación de referencias.

Los foros generales conservan sus avisos anteriores. No se envía correo por cada
intervención ni se ha activado un resumen semanal.

El aviso abre el módulo: `/foros?module=ID` en web y `/foros/modulo/ID` en móvil.
Desde allí se consultan sus temas. El texto del aviso es genérico: no incorpora
mensajes, documentos privados ni posturas personales.

## Destinatarios y permisos

Antes de entregar se vuelven a comprobar la familia, los módulos accesibles del
curso activo, las cuentas activas y las excepciones vigentes de gestión y
moderación. No basta con que una persona perteneciera al módulo al producirse
el cambio. Se omiten fuentes eliminadas y cuentas sin acceso.

La persona que hace un cambio no recibe su propio aviso, salvo que en la misma
ventana también existan cambios de otras personas.

Tener un aviso nunca concede permiso para abrir su destino.

## Recuperación y límites

El cambio y su evento pendiente se guardan en la misma transacción. Un
trabajador revisa la cola cada treinta segundos, después del cierre de cada
ventana. Si falla la entrega persistente, se reintenta con espera progresiva.
La cola sobrevive a los reinicios.

El aviso y su registro de entrega también se guardan juntos. Los procesos
simultáneos no pueden crear dos avisos de la misma ventana para una persona.
Leer o borrar un aviso no permite que un reintento lo vuelva a crear.

**La entrega garantizada por este mecanismo es la persistencia del aviso dentro
de la aplicación.** La actualización en tiempo real y la notificación push
dependen de conexión, dispositivo, suscripciones y permisos; son de mejor
esfuerzo. Si falla el push, el aviso sigue disponible en la aplicación.

No se puede prometer una hora exacta de recepción durante una caída o cuando
hay retrasos en la cola. No se aplican aprobaciones institucionales automáticas.

## Instalación y actualización

Esta entrega añade dos tablas, con una migración aditiva e idempotente incluida
en `deploy/db.sh`. El actualizador debe ejecutar las migraciones antes de
arrancar el nuevo servidor. No copiar solo el archivo compilado sobre una base
sin actualizar.

La migración no borra mensajes, acuerdos, avisos ni sesiones existentes. Una
reversión temporal a código anterior conserva la cola, pero no la procesa hasta
recuperar una versión compatible. Deben mantenerse además las restricciones de
acceso a acuerdos y recursos descritas en los manuales anteriores.
