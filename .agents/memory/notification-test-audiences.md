---
name: Audiencias en pruebas de notificaciones
description: La base de desarrollo compartida puede incluir gestores globales ajenos a las cuentas temporales.
---

Las pruebas de avisos deben aislar la base o limpiar todos los avisos ligados a
sus destinos ficticios, no únicamente los dirigidos a cuentas creadas por la prueba.

**Why:** En una base compartida, los gestores globales existentes pueden ser
destinatarios legítimos de módulos ficticios. Limpiar solo las cuentas temporales
deja avisos de ensayo en otras cuentas; seleccionar el primer registro de entrega
sin identificar al destinatario también produce comprobaciones incorrectas.

**How to apply:** Usar destinos exclusivos e inequívocos de ensayo, comprobar las
entregas del destinatario concreto y retirar únicamente los avisos que pertenezcan
a esos destinos. Nunca usar una limpieza global de avisos ni probarlo en producción.
