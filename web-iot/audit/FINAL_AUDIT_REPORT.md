# PawPilot / Smart Pet Feeder V2.0 Security and Integration Audit

**Audit date:** 2026-10-15  
**Repository baseline:** `main`, commit `dad720c` (`Add ESP32 feeder integration firmware`); initial `git status --short --branch` was clean.  
**Audit scope:** the `web-iot` Git checkout and read-only sibling firmware/documentation in `smart-pet-feeder`.  
**Release status: NOT READY — INTEGRATION BLOCKERS REMAIN.** Hardware end-to-end tests were not possible and the current source has verified producer/consumer mismatches. Do not infer that feeding, abort, schedule, or recovery works from the mock UI or a 202 response.

## Executive summary

The web application builds and type-checks. Its dependency audit reported zero known advisories in the lockfile at audit time. A safe localhost test confirmed that the Vite development proxy forwards a representative request, injects the configured key on the server side, and passes through a correctly framed fake SSE event. That test did not run firmware or contact hardware.

The physical integration is not compatible end to end. The CAM implements 11 HTTP route registrations and an SSE route. The WROOM accepts only `FEED_NOW`, `VERDICT:PET`, and heartbeat-shaped commands. It has no handlers for abort, clear, schedule, tare, calibration, or configuration. CAM returns 202 immediately after writing commands and does not wait for WROOM acceptance. CAM sends both `FEED_NOW` and `FEED` for one feed; only the first is recognized. No command ID is matched to a device result. The WROOM does not produce telemetry, and its amount-only log frame is converted by CAM into a fabricated full log record. CAM's `/api/log` buffer remains empty.

There are **5 High, 7 Medium, 1 Low, and 2 Informational findings**; no Critical finding was confirmed. The most urgent safety issues are the missing abort implementation, an unbounded top-up loop when scale readings fail to increase, the absence of end-to-end command acknowledgement/idempotency, and a committed placeholder API credential. Firmware changes are required and are proposals only; no firmware file was changed.

## Overall architecture and inventory

| Component | Location | Responsibilities and entry points | Interfaces / dependencies | Security boundary and verification |
|---|---|---|---|---|
| React frontend | `src/main.tsx`, `src/App.tsx`, `src/pages/*` | React 18 UI; eight feature screens: Overview, Feed Now, Schedule, Camera, Logs, Analytics, Device Status, Settings | DeviceContext and `DeviceService` | Browser is untrusted; controls must not depend on disabled buttons for authorization. Build/typecheck passed. |
| Device state | `src/context/DeviceContext.tsx` | Polls status/schedule/log/config/snapshot, consumes events, derives active feed and user messages | `DeviceService`, localStorage | State is partly cached/derived; accepted HTTP commands are not physical completion. |
| Hardware HTTP/SSE client | `src/services/restDevice.ts` | REST requests, timeouts, binary snapshot, EventSource parsing/reconnect and client-side visit cache | Same-origin `/api/*`, `/events` via Vite proxy | API key was previously read into browser code; fixed during audit to server-side proxy injection. |
| Wire model/mappers | `src/types/device.ts`, `src/services/protocol.ts` | Compact JSON/SSE schemas and UI conversion | CAM status/log/schedule, WROOM-derived telemetry | Strict TypeScript types do not validate runtime JSON fields. |
| Demo implementation | `src/services/mockDevice.ts`, `mockSnapshot.ts`, `src/data/demoData.ts` | In-browser simulated WROOM/CAM behavior, state machine, localStorage | No network | Simulation is not firmware evidence; Settings exposes mode selection. |
| Vite development proxy | `vite.config.ts` | Local dev server; `/api` and `/events` proxy; 502 handling | Vite 6, host/port env | Dev-only proxy; production `vite build` does not provide a device reverse proxy. |
| ESP32-CAM | `../esp-code/ESP-32-CAM-code.ino` | Wi-Fi station, camera, AsyncWebServer routes, SSE, UART bridge | ESP32 Arduino core, ESPAsyncWebServer, ArduinoJson, camera library; HTTP port 80; Serial2 115200 8N1, CAM RX14/TX15 | Has an API-key check on selected writes. Read routes/SSE are public; key is a source constant placeholder. Firmware not compiled or run. |
| ESP32-WROOM | `../esp-code/ESP_WROOM_32_code.ino` | HX711, HC-SR04, IR, DS3231, OLED, servo, partial state machine, Preferences | Wire, SPI, U8g2, HX711, ESP32Servo, RTClib, Preferences; Serial2 115200 8N1, RX16/TX17 | Physical actuator control. No firmware command authentication, range cap, or end-to-end command ACK. Firmware not compiled or run. |
| Duplicate sketches | `../Arduino_IDE_Codes/*.ino` | Copies of the two corresponding `esp-code` sketches | SHA-256 hashes match by role | Both copies were checked; parent integration report incorrectly says CAM file duplicates WROOM. |
| Circuit/reference docs | `../CIRCUIT_DIAGRAMS/*.pdf`, `../HARDWARE_INTEGRATION_REPORT.md`, `../Arduino_IDE_Codes/ESP32-WROOM-README..md` | Wiring and project claims | Specific `Smart_Pet_Feeder_V2_Technical_Reference.pdf` not present | Existing hardware report has claims contradicted by checked-in source (see below). PDF renderer tools were unavailable, so circuit diagrams were not visually audited. |
| Build/CI/test config | `package.json`, lockfile, `tsconfig.json`, `.gitignore` | npm scripts/build, dependency resolution | Node/npm, TypeScript, Vite | No `test` or lint script, no CI workflow found, no firmware build manifest. |

Root tracked files comprise the frontend source, package manifests, Vite/TypeScript config, README, and assets. `node_modules` and `dist` are generated/ignored. A local `.env` exists but is ignored and was not printed or copied into this report. `tsconfig.tsbuildinfo` is tracked. No separate firmware source is inside this Git checkout; the sibling firmware was read only. The named technical reference PDF was not found; only three circuit PDFs were found. The report does not claim their wiring diagrams were validated because Poppler tools were unavailable.

### Feature-to-feature trace status

| Feature | Trace and earliest broken link | Final status |
|---|---|---|
| Overview | CAM `/api/status` and `telemetry` SSE → frontend mapper. CAM starts with synthetic telemetry; WROOM emits no `<TELEM:...>` frame. | FAIL |
| Manual feed | UI → `POST /api/feed` → CAM sends `<FEED_NOW:g>` plus unsupported `<FEED:g>` → WROOM may enter PRECHECK only if IDLE → WROOM sends amount-only LOG → CAM fabricates result → UI. No ID/ACK; hardware outcome not correlated. | CONTRACT MISMATCH |
| Abort | UI → CAM route sends `<ABORT>` and returns 202 → no WROOM parser branch. | CONTRACT MISMATCH |
| Clear fault | UI → CAM sends `<CLEAR>` and returns 202 → no WROOM parser branch. | CONTRACT MISMATCH |
| Schedules | UI PUT → CAM updates RAM echo and sends `<SCHED:...>` → WROOM has no schedule parser or execution (clockService comment is TODO). | CONTRACT MISMATCH |
| History | WROOM only sends `<LOG:amount>`; CAM fabricates metadata for SSE and never updates HTTP log buffer; GET `/api/log` remains `[]`. | FAIL |
| Pet detection | WROOM IR → `<PET_DETECTED>` → CAM reports fixed pet/confidence and replies `<VERDICT:PET>` → WROOM only accepts during WAIT_PET. No camera/TinyML classification. | CONTRACT MISMATCH |
| Tare/calibration | UI → CAM route sends TARE/CAL and returns 202 → no WROOM handler; calibration factor is constant. | CONTRACT MISMATCH |
| Configuration | UI → CAM forwards CFG and returns 202 → no WROOM handler; local browser cache is not device state. | CONTRACT MISMATCH |
| Camera | ESP camera capture → CAM snapshot route → frontend blob/object URL. Source method and MIME agree; actual image response and framebuffer lifetime not exercised. | BLOCKED |

## Security and reliability findings

Details, evidence, and remediation states are machine-readable in `security_findings.json`.

### High

**PAW-H-01 — Placeholder device API key is committed in CAM firmware.** `esp-code/ESP-32-CAM-code.ino:9,50-55`; duplicate in `Arduino_IDE_Codes`. Mutating routes rely on exact `X-API-Key`, but the checked-in constant is a public placeholder. A user who flashes it without replacement allows any client that can reach the CAM to request feed/abort/clear/configuration operations. The exact key value is redacted. Replace with a per-device secret from provisioned configuration and rotate any deployed value. Retest missing/wrong/correct credentials on an isolated device. Not fixed (firmware authorization required).

**PAW-H-02 — Abort reports accepted although WROOM ignores ABORT.** CAM route at `ESP-32-CAM-code.ino:155-160`; WROOM parser at `ESP_WROOM_32_code.ino:248-274`. A feed can continue; user-visible abort is ineffective. Implement a fail-safe abort handler that closes the gate immediately, returns a correlated result, and handles idle/busy/fault states. Not fixed.

**PAW-H-03 — WROOM top-up can repeat without a maximum.** `ESP_WROOM_32_code.ino:317-374`. After an 8-second dispense timeout it enters settle; if measured grams remain below target, TOPUP opens the gate and returns to SETTLE. There is no top-up count/time limit or sensor-stale check, so a failed/stale load cell can cause repeated openings. Add bounded attempts, sensor validity/timeout checks, and a latched safe fault with gate closed. Not fixed; physical reproduction is prohibited without a safe hardware procedure.

**PAW-H-04 — Feed command is not correlated or idempotent.** CAM sends two textual commands and returns a constant `id:1` 202 (`ESP-32-CAM-code.ino:140-153`). WROOM recognizes only FEED_NOW and has no command ID/deduplication (`ESP_WROOM_32_code.ino:255-263`). A lost response/retry or delayed repeat can be indistinguishable from a new request; CAM cannot prove which feed completed. Define a framed request ID, dedupe window/persistence policy, explicit ACK/NAK, and final result correlation. Not fixed.

**PAW-H-05 — CAM/UI can report synthetic telemetry and fabricated successful feed logs.** CAM initializes telemetry with defaults (`ESP-32-CAM-code.ino:44-48`), WROOM never emits TELEM, and CAM builds an `OK` log from only a number (`:263-288`). `/api/log` returns an unchanged empty buffer (`:47,181-184`). Dashboard can display plausible values and success metrics unsupported by device data. Emit complete validated frames and store real logs, or expose unknown/unconfirmed values. Not fixed.

### Medium

**PAW-M-01 — Mutating routes for clear, schedules, tare, calibration, and config have no WROOM handlers.** CAM routes at `:162-221`; WROOM parser only handles feed, verdict, heartbeat. Calls return 202 and some UI success copy was corrected during audit, but operations do not apply. Implement and validate handlers or remove/disable unavailable operations. Not fixed.

**PAW-M-02 — CAM request parsing ignores JSON errors, chunk indexes, lengths, and schema.** `ESP-32-CAM-code.ino:141-153,173-179,204-221`. `deserializeJson` results are ignored for feed/calibration; calibration defaults to 200; schedule/config use raw chunk pointers as C strings and do not cap body size or validate fields. Malformed/fragmented requests may be accepted or forwarded. Accumulate bounded bodies, honor `index/total`, validate content type and full schema, and reject parse errors before UART. Not fixed.

**PAW-M-03 — WROOM lacks independent actuator input bounds and key safety checks.** `ESP_WROOM_32_code.ino:255-263,287-307`. FEED_NOW uses `String.toInt()` with no 5–200 g clamp, and hopper percentage is not checked in PRECHECK; ultrasonic invalid/no-echo conditions are not represented. CAM currently validates 5–200, but WROOM is the actuator safety boundary. Validate independently and reject stale/invalid sensor values before opening. Not fixed.

**PAW-M-04 — Read/status, snapshot, schedule, log, and SSE are unauthenticated; CAM uses wildcard CORS.** `ESP-32-CAM-code.ino:103-107,109-138,170-195,232-234`. Untrusted clients on reachable networks can inspect status/schedules/history/camera and subscribe to events. Apply network isolation and an access-control approach compatible with EventSource (or use a same-origin authenticated proxy). Not fixed; this appears intentional in the existing integration report but has no threat-boundary justification.

**PAW-M-05 — Schedule and daily-token behavior is not implemented in WROOM.** `ESP_WROOM_32_code.ino:70-73,221-238`; current `lastFedToken` is unused; schedule loop is a TODO. CAM schedule is RAM only. UI can show an accepted schedule which does not control real timed feeding. Not fixed.

**PAW-M-06 — UART has no checksum, max frame length, resynchronization policy, or command ACK.** Both sketches use newline-delimited Arduino `String` / `readStringUntil`; CAM reads one line per loop, WROOM loops on available input (`CAM:57-59,252-300; WROOM:241-275`). There is no CRC/checksum or length bound. A checksum, if later added, would detect accidental corruption but would not authenticate a sender. Bounded parser and explicit framing/ACKs are required. Not fixed.

**PAW-M-07 — CAM snapshot may release the camera frame before async send completes.** `ESP-32-CAM-code.ino:187-195` calls `esp_camera_fb_return(fb)` immediately after `req->send(res)`. The actual AsyncWebServer ownership/copy semantics were unavailable, so this is a potential lifetime defect, not a confirmed exploit. Verify library behavior; copy bytes or retain the frame until response completion if necessary. Not fixed / not verified.

### Low and informational

**PAW-L-01 — Web toolchain has no test/lint script or CI workflow.** `package.json` only provides dev/build/typecheck/preview; no `.github` workflow or repository test suite was found. Add repeatable contract tests and CI after firmware contracts are corrected. Not fixed.

**PAW-I-01 — Reference/integration documentation is stale or absent.** Named technical reference PDF is not present. `../HARDWARE_INTEGRATION_REPORT.md` claims production-ready integration and, in its section 6, says Arduino IDE CAM is a duplicate of WROOM; current file hashes show the CAM copies match each other, while the WROOM copies match each other. Its claimed route/telemetry behavior also disagrees with the current source. Reconcile documentation with tested code before hardware use. Not fixed.

**PAW-I-02 — No implemented TinyML path exists in the current CAM sketch.** IR triggers are emitted as fixed `pet=1, conf=94`; the live camera route only captures snapshots. This is not evidence of classification or 2-of-3 voting. Rename UI/docs to IR detection until actual inference is implemented and tested. Not fixed.

## Endpoint compatibility and authentication

The complete machine-readable route inventory is `endpoint_inventory.json`; individual test cases and statuses are in `integration_test_matrix.md`.

| Method / path | Frontend consumer | CAM registration | Key | Contract/test result |
|---|---|---|---|---|
| GET `/api/status` | `getStatus()` | Yes | No | FAIL: schema shape is present but telemetry producer missing; synthetic initial values. |
| POST `/api/feed` | `feed()` | Yes | Yes | CONTRACT MISMATCH: request path/body/range align; unsupported duplicate FEED frame and no WROOM ACK/ID. |
| POST `/api/abort` | `abort()` | Yes | Yes | CONTRACT MISMATCH: no WROOM handler. |
| POST `/api/clear` | `clearFault()` | Yes | Yes | CONTRACT MISMATCH: no WROOM handler. |
| GET `/api/schedule` | `getSchedule()` | Yes | No | FAIL: CAM RAM echo only; no WROOM scheduler/storage. |
| PUT `/api/schedule` | `putSchedule()` | Yes | Yes | CONTRACT MISMATCH: raw JSON is forwarded to unsupported handler; no validation. |
| GET `/api/log` | `getLog()` | Yes | No | FAIL: always empty buffer; WROOM log schema is amount-only. |
| GET `/api/snapshot.jpg` | `getSnapshot()` | Yes | No | BLOCKED: source contract matches; no physical camera test. |
| POST `/api/tare` | `tare()` | Yes | Yes | CONTRACT MISMATCH: no WROOM handler. |
| POST `/api/calibrate` | `calibrate()` | Yes | Yes | CONTRACT MISMATCH: no WROOM handler; fixed factor. |
| POST `/api/config` | `setConfig()` | Yes | Yes | CONTRACT MISMATCH: no WROOM handler; config is browser cache only. |
| GET `/events` | `subscribe()` | Yes | No | CONTRACT MISMATCH: proxy SSE smoke passed; event/data chain is incomplete. |

Authentication checks enforced in source: feed, abort, clear, schedule PUT, tare, calibrate, and config require X-API-Key. Status, schedule GET, log, snapshot, SSE and OPTIONS do not. The Vite key injection was tested with a fake local CAM only. Unauthorized/missing/wrong/correct key behavior on actual firmware remains untested. The firmware key is hard-coded and must be replaced/rotated; current runtime `.env` is ignored and its contents are intentionally not reproduced.

## Test execution and build results

| Check | Result | Evidence / limitation |
|---|---|---|
| `npm run build` | PASS | TypeScript + Vite production build; output warns main JS chunk is about 682 kB (>500 kB advisory). |
| `npm run typecheck` | PASS | `tsc -b --noEmit`. |
| `npm audit --json` | PASS (0 known advisories) | 162 dependency records reported by npm at audit time; this does not prove firmware dependency safety. |
| `python audit/contract_audit.py` | PASS as static scan; mismatches recorded | No network/hardware. See `static_contract_results.json`. |
| `node audit/frontend_client_smoke_test.mjs` | PASS (simulated) | RestDeviceService with fake fetch/EventSource; checks request mapping, range rejection, 401/503/timeout handling, snapshot and malformed SSE parsing. Not a CAM or UI test. |
| `node audit/proxy_smoke_test.mjs` | PASS (simulated) | Local fake CAM checked POST body/key proxying, SSE MIME/framing, and that configured API key was absent from production bundle. Not firmware evidence. |
| Firmware compile / unit tests | BLOCKED | No Arduino CLI, PlatformIO, compiler/static-analysis tool, build manifest, or firmware test harness found in the environment/repository. Required Arduino libraries/board configuration not available for reproducible compile. |
| Hardware HTTP/SSE/UART/actuator tests | BLOCKED | No authorized device address/credentials/hardware test procedure was supplied; no physical command was issued. |
| Secret scanner | NOT RUN | Gitleaks/trufflehog not installed; source was manually searched. `.env` ignored; secret values redacted. |
| Circuit PDF visual review | BLOCKED | Poppler renderer/extractor tools unavailable. |

No actual feed operation was attempted. No physical CAM-to-WROOM communication was verified. SSE was verified only between Vite and a localhost fake server; actual CAM SSE is not verified. UART wiring, frame delivery, state transition, acknowledgement, and real outcome are not verified.

## Audit changes and retest

1. Changed the Vite dev proxy to inject the device API key server-side, removed the key from the browser REST client, and changed `.env.example`/README to use a non-`VITE_` server variable. The proxy smoke test confirmed the browser bundle did not include the configured key and the fake server received the key. Legacy `VITE_DEVICE_API_KEY` is still read by the Vite server for backward compatibility; migrate local `.env` to `DEVICE_API_KEY` and rotate the firmware placeholder separately.
2. Changed clear/schedule/config/tare/calibration UI notifications to say “accepted” and explicitly not confirmed; tare/calibration no longer record a successful timestamp or factor from the CAM's immediate 202 response. Build and typecheck passed after these edits. Manual physical behavior remains blocked.
3. Added read-only static contract scanner, frontend fake-transport smoke test, proxy fake-CAM smoke test, and the required reports under `audit/`. No firmware file was modified. Parent directory integration report and source were preserved.

## Unresolved issues and prioritized fixes

See `REMEDIATION_PLAN.md` and `firmware_change_proposals.md`. Before any hardware feeding test: replace the API placeholder, implement a bounded WROOM dispense loop and working abort, add validated/deduplicated command IDs and ACK/NAK, and prove the kill/close-gate behavior under fault injection on a safe bench setup. Then complete schedule/config/tare/calibration handlers and real telemetry/log records. Only after those source blockers are fixed should the full isolated HTTP/SSE/UART matrix be run.

## Final release-readiness assessment

**NOT READY — INTEGRATION BLOCKERS REMAIN.** The frontend artifact is buildable and its local proxy credential handling is improved. However, multiple required endpoints do not reach WROOM handlers; telemetry, logs, schedules, and completion status do not reflect real device state; abort is missing; and bounded recovery behavior is not established. Hardware tests are pending, and no physical feeding safety claim is made.
