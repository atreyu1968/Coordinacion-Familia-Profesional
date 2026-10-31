---
name: Comparaciones semánticas de JSONB
description: Evitar conflictos falsos al comparar contenido recuperado de PostgreSQL con entradas JSON.
---

No usar la serialización directa de objetos como igualdad semántica de JSONB.
PostgreSQL no conserva el orden de inserción de las claves de un objeto.

**Why:** Una consulta de acuerdos rechazaba un cierre sin cambios porque las
fuentes recuperadas de JSONB tenían sus claves en otro orden. El texto y las URL
eran idénticos; el conflicto era falso.

**How to apply:** Comparar valores normalizados por campos o utilizar una
comparación profunda que ignore el orden de claves. Conservar el orden de las
listas cuando tenga significado. Cubrir el recorrido real guardar → recuperar
de PostgreSQL → volver a guardar, no solo objetos en memoria.
