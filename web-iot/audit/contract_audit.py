#!/usr/bin/env python3
"""Read-only source contract scan for PawPilot and the two ESP32 sketches.

This is deliberately a static check. It never opens a socket, imports device
credentials, or sends commands to hardware. Its output must not be described as
runtime or hardware verification.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAM = ROOT.parent / "esp-code" / "ESP-32-CAM-code.ino"
WROOM = ROOT.parent / "esp-code" / "ESP_WROOM_32_code.ino"
REST = ROOT / "src" / "services" / "restDevice.ts"

cam_text = CAM.read_text(encoding="utf-8")
wroom_text = WROOM.read_text(encoding="utf-8")
rest_text = REST.read_text(encoding="utf-8")

method_names = {
    "HTTP_GET": "GET",
    "HTTP_POST": "POST",
    "HTTP_PUT": "PUT",
    "HTTP_PATCH": "PATCH",
    "HTTP_DELETE": "DELETE",
    "HTTP_OPTIONS": "OPTIONS",
}
routes = [
    {"method": method_names.get(m, m), "path": p}
    for p, m in re.findall(r'server\.on\("([^\"]+)",\s*(HTTP_[A-Z]+)', cam_text)
]
route_set = {(r["method"], r["path"]) for r in routes}
frontend_paths = sorted(set(re.findall(r"['\"](/api/[^?'\"]+)", rest_text)))
if "/api/snapshot.jpg" in rest_text:
    frontend_paths = sorted(set(frontend_paths + ["/api/snapshot.jpg"]))
frontend_calls = []
request_pattern = re.compile(r"this\.request(?:<[^>]+>)?\(\s*(['\"])(/api/[^?'\"]+)\1")
for match in request_pattern.finditer(rest_text):
    tail = rest_text[match.end():match.end() + 160]
    options = re.match(r"\s*,\s*\{\s*method:\s*['\"]([A-Z]+)['\"]", tail)
    frontend_calls.append({"method": options.group(1) if options else "GET", "path": match.group(2)})
if "/api/snapshot.jpg" in rest_text:
    frontend_calls.append({"method": "GET", "path": "/api/snapshot.jpg"})

producer_commands = sorted(set(re.findall(r'sendUartCmd\("([A-Z_]+)(?::)?', cam_text)))
wroom_prefixes = sorted(set(re.findall(r'msg\.startsWith\("([A-Z_]+:?)', wroom_text)))
wroom_exact = sorted(set(re.findall(r'msg\s*==\s*"([A-Z_]+)"', wroom_text)))
consumer_commands = sorted(set(wroom_prefixes + wroom_exact))
unhandled = [
    c for c in producer_commands
    if not any(c.rstrip(":") == h.rstrip(":") for h in consumer_commands)
]
cam_sse_types = sorted(set(re.findall(r'events\.send\([^\n]*?,\s*"([a-z_]+)"', cam_text)))
frontend_sse_types = sorted(set(re.findall(r"addEventListener\('([a-z_]+)'", rest_text)))

result = {
    "kind": "static_source_contract_scan",
    "runtime_or_hardware_test": False,
    "files": {
        "cam": str(CAM.relative_to(ROOT.parent)),
        "wroom": str(WROOM.relative_to(ROOT.parent)),
        "frontend_client": str(REST.relative_to(ROOT)),
    },
    "registered_cam_http_routes": routes,
    "frontend_api_paths": frontend_paths,
    "frontend_calls": sorted(frontend_calls, key=lambda x: (x["path"], x["method"])),
    "frontend_calls_without_cam_method_route": [
        c for c in frontend_calls if (c["method"], c["path"]) not in route_set
    ],
    "frontend_paths_without_any_cam_route": [
        p for p in frontend_paths if not any(x["path"] == p for x in routes)
    ],
    "cam_routes_without_frontend_api_path": [
        r for r in routes if r["path"].startswith("/api/") and r["path"] not in frontend_paths
    ],
    "cam_uart_command_prefixes": producer_commands,
    "wroom_uart_command_prefixes": consumer_commands,
    "cam_commands_without_wroom_handler": unhandled,
    "wroom_emits_telem_frame": bool(re.search(r'(?i)(?:print|printf)\s*\(\s*"<TELEM:', wroom_text)),
    "wroom_emits_log_frame": bool(re.search(r'(?i)(?:print|printf)\s*\(\s*"<LOG:', wroom_text)),
    "cam_sse_event_names": cam_sse_types,
    "frontend_sse_event_names": frontend_sse_types,
    "frontend_sse_events_without_cam_producer": sorted(set(frontend_sse_types) - set(cam_sse_types)),
    "checks": {
        "cam_and_wroom_files_found": CAM.is_file() and WROOM.is_file(),
        "routes_discovered": len(routes) == 11,
        "known_wroom_feed_handler_discovered": "FEED_NOW:" in consumer_commands,
    },
}

out = ROOT / "audit" / "phase2_static_contract_results.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
raise SystemExit(0 if all(result["checks"].values()) else 1)
