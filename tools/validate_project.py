#!/usr/bin/env python3
"""Validaciones estructurales locales para la aplicación de Calidad."""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class IdCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name == "id" and value:
                self.ids.add(value)


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    errors: list[str] = []
    server = (ROOT / "Codigo.gs").read_text(encoding="utf-8")
    client = (ROOT / "Index.html").read_text(encoding="utf-8")

    try:
        manifest = json.loads((ROOT / "appsscript.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"appsscript.json no es JSON válido: {error}")
        manifest = {}
    require(manifest.get("runtimeVersion") == "V8", "El runtime debe ser V8.", errors)
    require(manifest.get("timeZone") == "America/Montevideo", "La zona horaria debe ser America/Montevideo.", errors)

    parser = IdCollector()
    parser.feed(client)
    required_ids = {
        "nav-dashboard", "nav-traceability", "nav-admin", "view-admin",
        "admin-trazabilidad-id", "admin-gobierno-id", "admin-calidad-id",
        "admin-trazabilidad-ttl", "admin-gobierno-ttl", "admin-calidad-ttl",
        "admin-resources", "admin-flow", "admin-files-body", "admin-users-body",
        "admin-operations-body", "toast-stack", "quality-mode-tecnico",
        "quality-mode-funcional", "select-periodicidad",
        "status-filter-warn", "status-filter-err",
    }
    missing_ids = sorted(required_ids - parser.ids)
    require(not missing_ids, "Faltan IDs de Administración: " + ", ".join(missing_ids), errors)

    server_functions = set(re.findall(r"^function\s+([A-Za-z_$][\w$]*)\s*\(", server, re.MULTILINE))
    remote_calls = set(re.findall(r"callServer\(\s*['\"]([^'\"]+)['\"]", client))
    missing_functions = sorted(remote_calls - server_functions)
    require(not missing_functions, "Funciones remotas sin implementación: " + ", ".join(missing_functions), errors)

    require(client.count("google.script.run") == 1, "google.script.run debe aparecer solo dentro de callServer.", errors)
    require(not re.search(r"\balert\s*\(", client), "No deben quedar llamadas a alert(); usa showToast.", errors)

    required_server_symbols = {
        "obtenerPanelAdministracion", "probarConexionesAdministracion",
        "guardarConfiguracionAdministracion", "invalidarCachesAdministracion",
        "registrarConexionUsuario", "registrarOperacion_", "claveCache_",
    }
    missing_symbols = sorted(required_server_symbols - server_functions)
    require(not missing_symbols, "Faltan funciones administrativas: " + ", ".join(missing_symbols), errors)

    required_config_keys = {
        "TRAZABILIDAD_FOLDER_ID", "GOBIERNO_SHEET_ID", "CALIDAD_SHEET_ID",
        "CACHE_TRAZABILIDAD_SEGUNDOS", "CACHE_GOBIERNO_SEGUNDOS",
        "CACHE_CALIDAD_SEGUNDOS", "ADMIN_EMAILS", "CACHE_VERSION",
    }
    missing_keys = sorted(key for key in required_config_keys if key not in server)
    require(not missing_keys, "Faltan claves de configuración: " + ", ".join(missing_keys), errors)

    critical_rule_ids = {"2-1", "2-2", "2-3", "3-1", "3-2", "4-2"}
    critical_block = re.search(r"REGLAS_MVP_TECNICO\s*=\s*\{([^}]+)\}", server)
    configured_critical_ids = set(re.findall(r"['\"](\d+-\d+)['\"]", critical_block.group(1))) if critical_block else set()
    require(
        configured_critical_ids == critical_rule_ids,
        "Las reglas MVP Técnico deben ser exactamente: " + ", ".join(sorted(critical_rule_ids)),
        errors,
    )
    require(
        "function normalizarIdReglaCalidad_" in server
        and "Utilities.formatDate(valor, Session.getScriptTimeZone(), 'd-M')" in server,
        "Los IDs de regla convertidos en fecha por Sheets deben normalizarse a d-M.",
        errors,
    )
    require(
        "function leerDatosCalidad_" in server
        and server.count("leerDatosCalidad_(hoja)") >= 4,
        "Las lecturas de Calidad deben preservar el texto visible de principle_rule_type.",
        errors,
    )
    require(
        server.count("normalizarIdReglaCalidad_(fila[idx.idRegla])") >= 3,
        "Monitor, detalle y estabilidad deben usar IDs de regla normalizados.",
        errors,
    )
    require(
        "Math.max(headers.indexOf('principle_rule_type')" not in server,
        "La cabecera principle_rule_type debe resolverse por prioridad, no por posición.",
        errors,
    )
    require(
        "detalle_calidad_v6" in server and "reglas_calidad_v3" in server,
        "Las cachés de detalle deben invalidar reglas clasificadas antes de la normalización.",
        errors,
    )
    require("fechas.slice(-10)" in server, "El histórico diario debe limitarse a 10 cortes.", errors)
    require("cortesMensuales.length < 3" in server, "El histórico mensual debe limitarse a 3 cortes.", errors)
    require("HIST_DIAS" not in server, "No debe quedar el límite histórico genérico anterior.", errors)
    require("historicosPorTabla" not in server, "La carga inicial no debe precalcular todos los históricos.", errors)
    require("currentQualityMode" in client, "Falta el estado de vista de Calidad.", errors)
    require(
        "Number(tabla.totalReglas || 0) > 0" in client,
        "La vista funcional debe excluir tablas sin reglas funcionales.",
        errors,
    )
    require(
        "t.name, t.cutoffDate, t.qualityMode" in client,
        "El detalle debe solicitarse con la vista técnica o funcional activa.",
        errors,
    )

    if errors:
        print("Validación fallida:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Validación correcta: {len(remote_calls)} funciones remotas, {len(required_ids)} IDs y manifiesto válidos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
