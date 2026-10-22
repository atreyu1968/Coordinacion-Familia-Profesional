---
name: Correo privado de coordinación
description: Reglas de privacidad y configuración para la bandeja Gmail por coordinador.
---

Google OAuth se configura desde la administración de la aplicación; cada coordinador autoriza su propio buzón. No usar un conector compartido de Gmail ni mezclar casos, mensajes, notas, borradores, adjuntos o credenciales entre usuarios. El acceso de Google se limita a lectura y envío; las credenciales se cifran en reposo con AES-GCM y una clave derivada de `JWT_SECRET`.

Los borradores de IA requieren una petición explícita y consentimiento; nunca se envían automáticamente. Cada envío exige confirmación humana. Si el resultado de un envío es ambiguo, comprobar la carpeta Enviados antes de intentar repetirlo, para evitar duplicados.

**Why:** el usuario eligió Gmail, descartó conectar una integración compartida y pidió que la configuración y el acceso se controlen desde la aplicación.

**How to apply:** al ampliar la bandeja, conservar aislamiento por usuario, mínima autorización OAuth, configuración desde administración y confirmación humana de todo envío.

La vinculación entre asuntos es una agrupación de presentación privada por propietario, no una fusión de registros. Mensajes, adjuntos, notas, borradores y envíos siguen en su caso original; el historial compartido atribuye cada mensaje y nota a ese origen. La IA y el borrador activo continúan limitados al caso seleccionado.

**Why:** los reenvíos relacionados deben consultarse juntos sin cambiar ni mezclar el contenido original ni ampliar el contexto autorizado para la IA.

**How to apply:** conservar el propietario en cada operación de agrupación y consulta; al añadir operaciones sobre grupos, mantener el contenido en el caso de origen y mostrar su procedencia.
