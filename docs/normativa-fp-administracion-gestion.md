# Recopilación normativa de Formación Profesional

Revisión de fuentes: **27 de octubre de 2026**.

## Dónde se consulta

En **Documentación → Normativa**, tanto en la web como en la app móvil.
Se incorporan un índice y ocho páginas temáticas con **70 referencias** a
BOE, Gobierno de Canarias y TodoFP: marco estatal, títulos de Administración
y Gestión, implantación y horarios de Canarias, evaluación y FEOE,
optativas/modalidades/dobles titulaciones, convalidaciones, FP Adaptada y fuentes de seguimiento.

Cada referencia contiene título, tipo, aplicación y enlace oficial.
Las normas modificadoras y las correcciones se distinguen de las bases,
los anexos y los portales de seguimiento. Los cinco títulos cubiertos son
Servicios Administrativos, Informática de Oficina, Gestión Administrativa,
Administración y Finanzas y Asistencia a la Dirección.

No es un inventario exhaustivo ni un dictamen de vigencia. Deben verificarse
las modificaciones posteriores y la aplicabilidad al ciclo, cohorte, curso,
modalidad y régimen de formación en empresa. No se actualiza automáticamente.
Las normas del ámbito de gestión del Ministerio no se presentan como
currículos de Canarias. Los planes anteriores no se confunden con el nuevo
sistema de la Ley Orgánica 3/2022.

## Instalación y actualizaciones

El catálogo se incorpora al ejecutar `seed-reference-data`, ya utilizado por
`deploy/update.sh` y por el instalador. En una instalación nueva sin usuarios,
se completa después de crear el primer administrador mediante `seed-admin`.
También puede ejecutarse, con el entorno de base de datos ya configurado:

```sh
pnpm --filter @workspace/scripts run seed-normativa
```

No necesita cambios de esquema. Solo se carga en la familia activa
Administración y Gestión. No crea cuentas ni emplea usuarios ficticios como
autores: utiliza un superadministrador activo existente.

La operación es transaccional y serializa ejecuciones simultáneas. No
sobrescribe contenido editado, no revive páginas retiradas por la
administración y no duplica enlaces. La documentación existente se conserva.
Solo se refresca el índice si coincide íntegramente con la plantilla generada
original y no tiene ediciones humanas; las páginas temáticas no se sobrescriben.

El apartado **Convalidaciones** incluye guía de tramitación y documentación,
supuestos habituales de ADG, traslado de calificaciones, IPE/FOL/EIE,
idiomas, reconocimiento universitario y diferencias frente a exenciones,
equivalencias y homologaciones. Enlaza las orientaciones canarias de 2026/2027,
el formulario de solicitud y las instrucciones ECTS de 8 de abril de 2026.
La aplicación informa, pero no tramita ni resuelve solicitudes administrativas.

El apartado **FP Adaptada** recoge los dos itinerarios ADG, sus cinco módulos
profesionales diferentes, los tres ámbitos comunes y tutoría, con códigos y
horarios contrastados en los anexos III y IV de la resolución de 21 de febrero
de 2025. Incluye instrucciones, currículo general, ampliaciones y admisión.
El catálogo docente los distingue como **FP Adaptada**, no como Grado Básico.
La carga conserva los identificadores y asignaciones existentes y no reactiva
registros expresamente retirados. Las horas se conservan en el catálogo de
referencia y se muestran en Documentación; no se añaden campos al esquema.

## Mantenimiento de las fuentes

La recopilación revisada se mantiene en
`scripts/src/data/normativa-fp.json`, con fecha de revisión y notas de
aplicabilidad. Los contenidos publicados se pueden gestionar con los
permisos habituales de Documentación. Las ediciones existentes prevalecen
sobre la carga inicial: cambiar el JSON no sobrescribe esas páginas.

Para revisar una norma, comprobar en BOE el análisis jurídico y las versiones;
en Canarias, el BOC y los índices de implantación, evaluación, formación dual
y dobles titulaciones. Actualizar la fecha únicamente después de una revisión
real, no en cada arranque o actualización técnica de la aplicación.
