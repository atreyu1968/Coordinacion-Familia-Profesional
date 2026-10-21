# Historial administrativo de cuentas

En **Usuarios → Historial**, los gestores pueden consultar cambios de nombre,
rol, centro, provincia y desactivación/reactivación. Se registran el actor
(identificador y nombre en el momento de la operación), la cuenta afectada,
la fecha y únicamente los valores administrativos que realmente han cambiado.
No se almacenan contraseñas, hashes, tokens ni peticiones completas.

El cambio y su evento se confirman en una única transacción. Un fallo revierte
ambos. Las ediciones sin cambios, operaciones rechazadas y reactivaciones
repetidas no generan eventos. Las actualizaciones concurrentes desfasadas se
rechazan y requieren recargar la cuenta.

## Acceso

- Superadministración: historial completo, incluidas cuentas desactivadas.
- Coordinación: solo cuentas gestionables actualmente y eventos cuyos ámbitos
  anterior y posterior pertenezcan a su provincia.
- Jefatura: la misma restricción para su centro.
- En ambos casos, el rol anterior y el posterior deben ser inferiores al del
  responsable actual. No se muestran eventos de un ámbito previo ni los
  detalles de un traslado desde otro ámbito.
- El resto de roles no tiene acceso. El servidor aplica las restricciones antes
  de paginar, independientemente de los controles visibles en la web.

Los sucesos son instantáneas independientes y no se reescriben al cambiar
nombres, roles o destinos. No se crean eventos retroactivos. Este historial
cubre las acciones administrativas de gestión de cuentas; no presenta las
ediciones de perfil propio ni procesos automáticos como acciones de un gestor.

## Actualización de instalaciones existentes

La nueva tabla se incluye en el esquema de instalaciones nuevas. El verificador
de las instalaciones existentes rechaza tablas esperadas ausentes, por lo que
**antes de ejecutar la actualización** debe hacerse una copia de seguridad y un
administrador debe aplicar `deploy/migrations/account-audit.sql` a la base de
datos correspondiente mediante `psql` con `ON_ERROR_STOP=1`. El archivo solo
crea una tabla vacía y su índice; no modifica usuarios ni historiales anteriores.
Si la tabla ya existe, detiene la operación y debe revisarse su definición
en lugar de forzar o borrar datos.

La auditoría se incorpora a las copias completas mediante el descubrimiento
normal del esquema. Las copias anteriores a esta tabla tienen una huella de
esquema distinta y no se deben importar forzando la validación.
