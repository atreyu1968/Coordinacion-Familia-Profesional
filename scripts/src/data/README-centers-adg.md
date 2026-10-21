# Directorio actualizado de Administración y Gestión

La relación facilitada por el usuario el 21 de octubre de 2026 contiene 65
códigos, denominaciones, teléfonos y correos. El fichero
`centers-adg-2026.json` reproduce esos datos. Todos los correos de la fuente
coinciden con `<código>@gobiernodecanarias.org`; por eso el importador los deriva
del código validado.

La columna numérica sin encabezado del documento original no se interpreta
como módulos, ciclos, grupos ni plazas. La fuente tampoco permite inventar
direcciones, coordenadas, islas o municipios de los centros nuevos.

El importador conserva los identificadores y las relaciones de los centros
existentes, así como sus otros datos y familias. Una coincidencia inequívoca
por nombre permite corregir un código antiguo que no figure en el catálogo
oficial; los conflictos de identidad abortan la transacción. No se eliminan
centros ausentes ni se reactivan centros desactivados.

Vista previa, sin cambios:

```bash
pnpm --filter @workspace/scripts run sync-adg-centers
```

Aplicar a la base de datos configurada para el proceso:

```bash
pnpm --filter @workspace/scripts run sync-adg-centers --apply
```

El cargador general `seed-reference-data`, utilizado por la instalación y la
actualización del servidor, también aplica esta relación después del catálogo
histórico. Los campos proporcionados por esta relación prevalecen para sus
65 códigos; los demás campos se conservan. Una corrección posterior de esos
datos de contacto debe actualizar también esta fuente para que persista en las
siguientes actualizaciones.
