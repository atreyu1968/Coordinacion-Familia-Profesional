#!/usr/bin/env bash
# Sourced before ANY installed-stack mutation. Only /tmp is used for inspection.
collab_preflight() {
  COLLAB_EXISTING=0
  COLLAB_SKIP=0
  COLLAB_PULL_SERVICES=""
  if ! command -v python3 >/dev/null 2>&1; then
    echo "No se puede comprobar Nextcloud/Collabora sin python3. Instala python3 y vuelve a intentarlo; no se realizará ningún cambio." >&2
    COLLAB_SKIP=1
    return 0
  fi
  local report answer key value
  if ! report="$(python3 "${SCRIPT_DIR}/preflight.py" --directory "${SCRIPT_DIR}" --domain "${APP_DOMAIN:-}")"; then
    echo "No se pudo comprobar Nextcloud/Collabora. No se realizará ningún cambio." >&2
    COLLAB_SKIP=1
    return 0
  fi
  if ! python3 -c '
import json,sys
r=json.load(sys.stdin)
assert isinstance(r,dict) and type(r["installed"]) is bool and type(r["healthy"]) is bool
assert all(isinstance(r[key],dict) for key in ("versions","pins","targets"))
assert all(isinstance(r[key],list) for key in ("issues","warnings","updates"))
assert set(r["pins"]).issubset({"nextcloud","nextcloud-db","nextcloud-redis","collabora"})
assert set(r["targets"]).issubset({"nextcloud","collabora"})
' <<< "${report}" 2>/dev/null; then
    echo "La comprobación ha devuelto un resultado inválido. No se realizará ningún cambio." >&2
    COLLAB_SKIP=1
    return 0
  fi
  if [[ "$(python3 -c 'import json,sys; print(int(json.load(sys.stdin)["installed"]))' <<< "${report}")" != 1 ]]; then
    return 0
  fi
  COLLAB_EXISTING=1
  python3 -c '
import json,sys
r=json.load(sys.stdin)
print("Nextcloud y Collabora: comprobaciones correctas." if r["healthy"] else "No se ha podido validar el funcionamiento completo de Nextcloud/Collabora.")
for k,v in r["versions"].items():
    print("  "+k+": "+(v or "versión no determinada"))
for issue in r["issues"]: print("  - "+issue)
for update in r["updates"]:
    print("  Actualización mayor de "+update["service"]+": "+update["current"]+" → "+update["available"])
    if update["target"]: print("    Paso permitido: "+update["target"])
for warning in r["warnings"]: print("  Aviso: "+warning)
' <<< "${report}"
  if [[ "$(python3 -c 'import json,sys; r=json.load(sys.stdin); print(int(r["healthy"] and not r["updates"]))' <<< "${report}")" == 1 ]]; then
    echo "Se conserva la instalación existente sin actualizar imágenes, contenedores ni configuración."
    COLLAB_SKIP=1
    return 0
  fi
  echo "Actualizar o reparar puede reiniciar servicios. Conserva una copia de seguridad de Nextcloud y su base de datos."
  answer="${COLLAB_APPROVE_UPDATE:-}"
  if [[ -z "${answer}" && -t 0 ]]; then
    read -r -p "¿Quieres actualizar o reparar Nextcloud/Collabora? [sí/NO]: " answer || true
  fi
  case "${answer,,}" in
    sí|si|s|yes|y) ;;
    *) echo "No se actualizará ni modificará la instalación existente."; COLLAB_SKIP=1; return 0 ;;
  esac
  if [[ "$(python3 -c 'import json,sys; r=json.load(sys.stdin); print(int(r["healthy"] and not r["targets"]))' <<< "${report}")" == 1 ]]; then
    echo "No hay un paso de actualización mayor que pueda automatizarse con seguridad. Se conserva la instalación sin cambios."
    COLLAB_SKIP=1
    return 0
  fi
  # Every existing service is pinned before repair. Only explicitly detected
  # major upgrades are pulled; floating tags never update incidental services.
  if [[ "$(python3 -c 'import json,sys; r=json.load(sys.stdin); print(int(len(r["pins"]) == 4))' <<< "${report}")" != 1 ]]; then
    echo "No se han podido identificar las cuatro imágenes existentes con seguridad." >&2
    echo "No se recrearán contenedores ni se arriesgará una bajada de versión. Revisa Docker y vuelve a ejecutar el instalador." >&2
    COLLAB_SKIP=1
    return 0
  fi
  while IFS=' ' read -r key value; do
    case "${key}" in
      NEXTCLOUD_IMAGE|NEXTCLOUD_DB_IMAGE|NEXTCLOUD_REDIS_IMAGE|COLLABORA_IMAGE) printf -v "${key}" '%s' "${value}" ;;
      PULL) COLLAB_PULL_SERVICES+="${value} " ;;
    esac
  done < <(python3 -c '
import json,sys
r=json.load(sys.stdin)
keys={"nextcloud":"NEXTCLOUD_IMAGE","nextcloud-db":"NEXTCLOUD_DB_IMAGE","nextcloud-redis":"NEXTCLOUD_REDIS_IMAGE","collabora":"COLLABORA_IMAGE"}
for service,key in keys.items(): print(key,r["targets"].get(service,r["pins"][service]))
for service in r["targets"]: print("PULL",service)
' <<< "${report}")
}
