#!/usr/bin/env python3
"""Read-only inspection. Never pulls images, starts containers or writes configuration."""
import argparse
import json
import re
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
    if result.returncode:
        raise RuntimeError("No se pudo ejecutar la comprobación de Docker/Nextcloud")
    return result.stdout.strip()


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "CoordinaADG-installer/1.0"})
    with urllib.request.urlopen(request, timeout=8) as response:
        data = response.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError("Respuesta demasiado grande")
    return data.decode("utf-8")


def setting(path, key, default=""):
    if path.exists():
        for line in path.read_text().splitlines():
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return default


def release(value):
    return tuple(map(int, value.split("."))) if re.fullmatch(r"\d+(?:\.\d+){1,5}", value) else None


def stable_tags(repository, suffix="", name=None):
    query = "?page_size=100&ordering=last_updated"
    if name:
        query += "&name=" + name
    data = json.loads(fetch(f"https://hub.docker.com/v2/repositories/{repository}/tags/{query}"))
    tags = []
    for item in data.get("results", []):
        tag = item.get("name", "")
        numeric = tag[:-len(suffix)] if suffix and tag.endswith(suffix) else tag if not suffix else ""
        version = release(numeric)
        if version and len(version) >= 3:
            tags.append((version, tag))
    return tags


def update_plan(nc_version, co_version, sources=None):
    updates, warnings, targets = [], [], {}
    for service, current, repository, suffix in (
        ("nextcloud", nc_version, "library/nextcloud", "-apache"),
        ("collabora", co_version, "collabora/code", ""),
    ):
        if sources is not None:
            source = sources.get(service, "")
            official = r"(?:docker\.io/)?(?:library/)?nextcloud(?::|@)" if service == "nextcloud" else r"(?:docker\.io/)?collabora/code(?::|@)"
            if not re.match(official, source):
                warnings.append(f"La imagen de {service} es personalizada o desconocida; no se sustituirá automáticamente.")
                continue
        parsed = release(current)
        if not parsed:
            warnings.append(f"No se ha podido determinar la versión actual de {service}; no se actualizará su imagen.")
            continue
        try:
            tags = stable_tags(repository, suffix, "-apache" if service == "nextcloud" else None)
            if not tags:
                raise ValueError("No hay versiones estables identificables")
            latest, latest_tag = max(tags)
            width = 1 if service == "nextcloud" else 2  # CODE uses calendar release branches.
            if latest[:width] <= parsed[:width]:
                continue  # Patch/minor updates never trigger maintenance.
            target = (latest, latest_tag)
            if service == "nextcloud":
                # Nextcloud forbids skipping major versions.
                immediate = [tag for tag in tags if tag[0][0] == parsed[0] + 1]
                if not immediate:
                    immediate = [tag for tag in stable_tags(repository, suffix, f"{parsed[0] + 1}.")
                                 if tag[0][0] == parsed[0] + 1]
                target = max(immediate) if immediate else None
            updates.append({
                "service": service, "current": current,
                "available": ".".join(map(str, latest)),
                "target": ".".join(map(str, target[0])) if target else None,
            })
            if target:
                targets[service] = ("nextcloud:" if service == "nextcloud" else "collabora/code:") + target[1]
            else:
                warnings.append("Nextcloud requiere versiones intermedias que no se han encontrado; no se automatizará el salto.")
        except Exception:
            warnings.append(f"No se pudieron consultar las versiones estables de {service}; no se presupone que esté actualizado.")
    return updates, targets, warnings


def inspect(directory, domain="", check_updates=True):
    directory = Path(directory).resolve()
    env = directory / ".env"
    report = {
        "installed": env.exists(), "healthy": False, "issues": [], "warnings": [],
        "versions": {"nextcloud": "", "collabora": ""}, "pins": {}, "targets": {}, "updates": [],
    }
    try:
        existing = command(["docker", "ps", "-a", "-q", "--filter",
                            f"label=com.docker.compose.project.working_dir={directory}"])
        report["installed"] = report["installed"] or bool(existing)
    except Exception:
        if not report["installed"]:
            return report
        report["issues"].append("Docker no está disponible para comprobar la instalación existente.")
        return report
    if not report["installed"]:
        return report

    compose = ["docker", "compose", "-f", str(directory / "docker-compose.yml")]
    if env.exists():
        compose += ["--env-file", str(env)]
    sources = {}
    for service in ("nextcloud", "nextcloud-db", "nextcloud-redis", "collabora"):
        try:
            cid = command(compose + ["ps", "-a", "-q", service])
            if not cid or len(cid.splitlines()) != 1:
                raise ValueError("Contenedor ausente o ambiguo")
            state, health, image, source = command(["docker", "inspect", "--format",
                "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Image}}|{{.Config.Image}}", cid]).split("|")
            sources[service] = source
            # Preserve the exact running/stopped image, even if a floating tag
            # has been pulled by another process since the container was made.
            digests = command(["docker", "image", "inspect", "--format", '{{join .RepoDigests "\\n"}}', image])
            pin = digests.splitlines()[0] if digests else image
            if not re.fullmatch(r"[A-Za-z0-9._:/@-]+", pin):
                raise ValueError("Referencia de imagen no válida")
            report["pins"][service] = pin
            if state != "running" or health not in ("", "healthy"):
                report["issues"].append(f"El contenedor {service} no está en estado correcto.")
        except Exception:
            report["issues"].append(f"No se pudo comprobar el contenedor {service}.")
    try:
        status = json.loads(command(compose + ["exec", "-T", "-u", "www-data", "nextcloud", "php", "occ", "status", "--output=json"]))
        report["versions"]["nextcloud"] = status.get("versionstring", "")
        if status.get("installed") is not True or status.get("maintenance") is not False or status.get("needsDbUpgrade") is not False:
            raise ValueError("Estado no listo")
    except Exception:
        report["issues"].append("Nextcloud no confirma una instalación lista, sin mantenimiento ni migraciones pendientes.")
    try:
        apps = json.loads(command(compose + ["exec", "-T", "-u", "www-data", "nextcloud", "php", "occ", "app:list", "--output=json"]))
        if not all(name in apps.get("enabled", {}) for name in ("groupfolders", "user_oidc", "richdocuments")):
            raise ValueError("Faltan aplicaciones")
    except Exception:
        report["issues"].append("No se han confirmado Group folders, OpenID Connect y Nextcloud Office habilitados.")

    domain = domain or setting(env, "APP_DOMAIN")
    if domain and re.fullmatch(r"[A-Za-z0-9.-]+", domain) and domain != "_":
        try:
            base = f"https://{domain}/collabora"
            wopi = command(compose + ["exec", "-T", "-u", "www-data", "nextcloud", "php", "occ",
                                     "config:app:get", "richdocuments", "wopi_url"])
            try:
                public_wopi = command(compose + ["exec", "-T", "-u", "www-data", "nextcloud", "php", "occ",
                                                "config:app:get", "richdocuments", "public_wopi_url"])
            except Exception:
                public_wopi = ""  # Optional; Office falls back to wopi_url.
            protocol = command(compose + ["exec", "-T", "-u", "www-data", "nextcloud", "php", "occ",
                                         "config:system:get", "overwriteprotocol"])
            if wopi.rstrip("/") != base or (public_wopi and public_wopi.rstrip("/") != base) or protocol == "http":
                raise ValueError("Configuración de Office/HTTPS inconsistente")
        except Exception:
            report["issues"].append("La configuración de Nextcloud Office/HTTPS no coincide con los servicios públicos.")
    nc_port = setting(env, "NEXTCLOUD_PORT", "8081")
    co_port = setting(env, "COLLABORA_PORT", "9980")
    if not nc_port.isdigit() or not co_port.isdigit():
        report["issues"].append("Los puertos configurados no son válidos.")
    else:
        endpoints = [
            ("Nextcloud local", f"http://127.0.0.1:{nc_port}/status.php", "status"),
            ("Collabora local", f"http://127.0.0.1:{co_port}/collabora/hosting/discovery", "discovery"),
        ]
        if domain and re.fullmatch(r"[A-Za-z0-9.-]+", domain) and domain != "_":
            endpoints += [
                ("Nextcloud HTTPS", f"https://{domain}/nextcloud/status.php", "status"),
                ("Collabora HTTPS", f"https://{domain}/collabora/hosting/discovery", "discovery"),
                ("OpenID Connect", f"https://{domain}/api/oidc/.well-known/openid-configuration", "oidc"),
            ]
        else:
            report["issues"].append("No se pudo determinar un dominio válido para comprobar el acceso HTTPS.")
        for label, url, kind in endpoints:
            try:
                body = fetch(url)
                if kind == "discovery":
                    if ET.fromstring(body).tag != "wopi-discovery":
                        raise ValueError("Discovery no válido")
                else:
                    value = json.loads(body)
                    if kind == "status" and (value.get("installed") is not True or value.get("maintenance") is not False or value.get("needsDbUpgrade") is not False):
                        raise ValueError("Estado HTTP no listo")
                    if kind == "oidc":
                        issuer = f"https://{domain}/api/oidc"
                        if (value.get("issuer", "").rstrip("/") != issuer or
                            not all(value.get(key, "").startswith(issuer + "/") for key in ("authorization_endpoint", "token_endpoint"))):
                            raise ValueError("Discovery OIDC incompleto o incorrecto")
            except Exception:
                # Legacy working installs may let nginx strip the subpath.
                # Validate the real local service without requiring a migration.
                if label == "Collabora local":
                    try:
                        body = fetch(f"http://127.0.0.1:{co_port}/hosting/discovery")
                        if ET.fromstring(body).tag == "wopi-discovery":
                            continue
                    except Exception:
                        pass
                report["issues"].append(f"No se pudo validar {label}.")
        try:
            capabilities = json.loads(fetch(f"http://127.0.0.1:{co_port}/collabora/hosting/capabilities"))
            version = capabilities.get("productVersion", "")
            if release(version):
                report["versions"]["collabora"] = version
        except Exception:
            try:
                capabilities = json.loads(fetch(f"http://127.0.0.1:{co_port}/hosting/capabilities"))
                version = capabilities.get("productVersion", "")
                if release(version):
                    report["versions"]["collabora"] = version
            except Exception:
                pass
    if not report["versions"]["collabora"]:
        try:
            output = command(compose + ["exec", "-T", "collabora", "/usr/bin/coolwsd", "--version"])
            match = re.search(r"\b(\d{2}\.\d{2}\.\d+(?:\.\d+){0,3})\b", output)
            if match:
                report["versions"]["collabora"] = match.group(1)
        except Exception:
            pass
    report["healthy"] = not report["issues"]
    if check_updates:
        report["updates"], report["targets"], warnings = update_plan(
            report["versions"]["nextcloud"], report["versions"]["collabora"], sources)
        report["warnings"] += warnings
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--domain", default="")
    parser.add_argument("--no-updates", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.directory, args.domain, not args.no_updates), ensure_ascii=False))
    except Exception:
        # Never echo Docker output or environment contents (they may contain secrets).
        print(json.dumps({"error": "No se pudo completar la comprobación; no se ha modificado la instalación."}))
        raise SystemExit(1)
