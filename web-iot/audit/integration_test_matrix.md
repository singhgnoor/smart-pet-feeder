# Integration Test Matrix

This matrix distinguishes static evidence, fake-device simulation, and actual device tests. No ESP32 hardware test was run. A 202 response is treated as acceptance only. Never use these results as proof of a physical dispense.

## Execution summary

| Layer | Result | Evidence |
|---|---|---|
| Static source contract scan | PASS as a scan; found mismatches | `python audit/contract_audit.py` → `audit/static_contract_results.json` |
| Frontend build/typecheck | PASS | `npm run build`; `npm run typecheck` |
| Frontend REST/SSE fake transport | PASS (SIMULATED) | `node audit/frontend_client_smoke_test.mjs`; checks URLs, methods, JSON mapping, 202, local range rejection, 401/503/timeout mapping, blob conversion, SSE parsing and malformed-event guard |
| Frontend/proxy fake server | PASS (SIMULATED) | `node audit/proxy_smoke_test.mjs`; local-only fake CAM, no hardware |
| CAM firmware HTTP contract tests | BLOCKED | Firmware sketch not compiled/running; no device or faithful firmware route harness |
| WROOM native protocol/state tests | BLOCKED | No Arduino CLI/PlatformIO/build manifest or host test harness |
| Actual CAM↔WROOM transport | BLOCKED | No authorized hardware setup or device network supplied |
| Physical feed and abort | BLOCKED | No safe explicit actuator test procedure; no commands sent |

## HTTP endpoint matrix

Shared status definitions: `PASS`, `FAIL`, `BLOCKED`, `NOT VERIFIED`, `MISSING`, `CONTRACT MISMATCH`, `NOT APPLICABLE`.

| Test IDs / endpoint | Expected request and response | Auth | Safe procedure and evidence | Actual result / final status |
|---|---|---|---|---|
| HTTP-STATUS-01..04 `GET /api/status` | No body; JSON 200 with link, rssi, state, and compact telem. Also exercise disconnect, malformed JSON, timeout. | None | Source route and frontend mapper inspected; no CAM process available. | CAM returns synthetic initial telemetry because WROOM never emits TELEM. Dynamic valid/offline/malformed/timeout tests BLOCKED. **FAIL** overall. |
| HTTP-FEED-01..11 `POST /api/feed` | JSON `{grams: 5..200}`; 202 means accepted. Test 4/5/200/201, zero, negative, float, missing/null/string, invalid JSON, empty body, wrong content type, extra fields, duplicate ID, busy, disconnected, timeout. | Missing/wrong/correct key cases required | Fake localhost proxy: valid JSON body forwarded and proxy key injected; received 202. Source: CAM sends FEED_NOW and FEED; WROOM handles only FEED_NOW. No WROOM ACK/ID. Negative HTTP/auth/boundary/device tests blocked. | Proxy path **PASS (SIMULATED)**; actual endpoint **CONTRACT MISMATCH**. No real feed attempted. |
| HTTP-ABORT-01..06 `POST /api/abort` | Empty body; expected 202 accepted, then later correlated aborted outcome; test unauth, wrong key, busy/idle, disconnected, timeout. | Required | Static source shows CAM sends ABORT, WROOM parser has no branch. No live request sent. | **CONTRACT MISMATCH** |
| HTTP-CLEAR-01..06 `POST /api/clear` | Empty body; expected accepted then fault state cleared; test missing/wrong/correct key, no fault, active feed, fault latched, disconnected. | Required | Static source shows WROOM has no CLEAR handler. | **CONTRACT MISMATCH** |
| HTTP-SCHEDULE-GET-01..04 `GET /api/schedule` | JSON array `{i,hh,mm,g,en}`; test valid array, malformed/non-array, stale data, timeout. | None | CAM serves RAM `scheduleJson`; WROOM schedule loop is TODO. Frontend silently converts failure to disabled defaults. | **FAIL**; dynamic cases BLOCKED |
| HTTP-SCHEDULE-PUT-01..10 `PUT /api/schedule` | JSON array of 4 slots; test valid/boundary hours 0/23 and minutes 0/59, invalid index/time/portion, missing slot, wrong field types/content type, malformed JSON, oversized/chunked body, auth, disconnected. | Required | Static source shows raw chunk copied and forwarded; no WROOM SCHED handler or validation. No actual request sent. | **CONTRACT MISMATCH** |
| HTTP-LOG-01..04 `GET /api/log` | JSON array of complete RawLogRecord; test empty, populated, malformed record, timeout. | None | CAM returns `logBufferJson`, initialized `[]` and never changed. WROOM only emits amount. | **FAIL** |
| HTTP-SNAPSHOT-01..05 `GET /api/snapshot.jpg` | JPEG 200; test busy/503, invalid MIME/body, timeout, cache behavior. | None | Frontend requests same route and handles Blob. No camera or HTTP server. Async framebuffer lifetime needs library-specific validation. | **BLOCKED** |
| HTTP-TARE-01..05 `POST /api/tare` | Empty body; accepted only while safe/idle, then observable tare result; test auth, busy, disconnected, timeout. | Required | WROOM has no TARE handler. Web timestamp success behavior removed; notification now says unconfirmed. | **CONTRACT MISMATCH** |
| HTTP-CAL-01..08 `POST /api/calibrate` | JSON `{known_g:number}`; test valid/edge/zero/negative/huge/missing/null/string, bad JSON/content type, auth, busy, timeout. | Required | CAM ignores parse result, defaults mass to 200, returns fixed factor; WROOM has no CAL handler. Web no longer stores that factor as a completed calibration. | **CONTRACT MISMATCH** |
| HTTP-CONFIG-01..08 `POST /api/config` | JSON fields `leftover_g`, `overshoot_g`, `daily_g`, `require_pet`; test range/type/missing/extra/malformed/content type/oversize/auth/disconnect. | Required | CAM forwards raw chunk; WROOM has no CFG handler. Browser localStorage cache is not device persistence. | **CONTRACT MISMATCH** |
| HTTP-OPTIONS-01..02 `OPTIONS /*` and unknown route | Expected generic OPTIONS 200 and unknown route 404; test CORS preflight headers. | None | Static handler inspected; no CAM HTTP server. | **NOT VERIFIED** |

## SSE matrix

| Test ID | Procedure | Actual result / status |
|---|---|---|
| SSE-01 route and MIME | Connect EventSource to `/events`; verify `text/event-stream` and persistent response. | Fake localhost proxy returned event-stream MIME. CAM route runtime **BLOCKED**. |
| SSE-02 framing and payload | Emit each telemetry/status/log/pet/low_food/error event; verify JSON fields and event names. | Fake proxy telemetry frame framing **PASS (SIMULATED)**. CAM source emits telemetry/log/pet/low_food only; frontend consumes additional status/error. **CONTRACT MISMATCH**. |
| SSE-03 event semantics | Feed accepted then correlate WROOM state, final log, and UI completion. | No request IDs/command ACK; current hardware trace cannot establish result. **NOT VERIFIED**. |
| SSE-04 malformed event | Send malformed JSON/unknown event and ensure no state crash. | Frontend JSON parsing is guarded in source; runtime browser test not run. **NOT VERIFIED**. |
| SSE-05 disconnect/reconnect | Stop fake/real server, inspect EventSource reconnect and status. | Browser EventSource auto-reconnect and fallback poll are implemented by inspection; only fake event pass-through exercised. Actual CAM **BLOCKED**. |
| SSE-06 buffering | Stream event with delay and confirm prompt receipt through Vite. | Local fake server test received complete frame; no CAM runtime. **PASS (SIMULATED)** for proxy only. |

## UART protocol matrix

Transport parameters from source: 115200 baud, 8N1. CAM uses Serial2 RX GPIO14 / TX GPIO15; WROOM uses RX GPIO16 / TX GPIO17. Wiring needs TX↔RX crossover and common ground. The source protocol is `<ASCII payload>\n`; no checksum, max length, sequence ID, or ACK/NAK protocol exists. A checksum would detect accidental corruption only; it would not authenticate a sender.

| Test ID / message | Producer → frame → consumer/handler → outcome | Negative/failure injection | Actual result / status |
|---|---|---|---|
| UART-HB-01 WROOM heartbeat | WROOM → `<HB:uptime>` every 2s → CAM prefix/terminator check → marks link active and replies `<HB:OK>` → WROOM accepts HB prefix and marks linked. | Missing/stale heartbeat, partial frame, unknown HB, unplug/recovery. | Static syntax is compatible; no serial loopback/hardware. **NOT VERIFIED** |
| UART-HB-02 CAM heartbeat reply | CAM reply `<HB:OK>` → WROOM recognizes `HB:`. | Truncated or repeated HB. | Static syntax compatible; no hardware. **NOT VERIFIED** |
| UART-FEED-01 FEED_NOW | CAM → `<FEED_NOW:g>` → WROOM `toInt`, if IDLE set target and PRECHECK. | Non-number, negative/oversized, duplicate after completion, repeated while busy, truncated/oversized. | Parser exists but no independent bound, ACK, ID, or runtime test. **NOT VERIFIED** |
| UART-FEED-02 legacy FEED | CAM also sends `<FEED:g>` → no WROOM handler. | Unknown-command behavior. | Confirmed ignored by source. **CONTRACT MISMATCH** |
| UART-ABORT-01 | CAM `<ABORT>` → WROOM no handler → no close/abort acknowledgement. | Active operation. | **CONTRACT MISMATCH**; no actuator test. |
| UART-CLEAR-01 | CAM `<CLEAR>` → no handler. | Fault-latched state. | **CONTRACT MISMATCH** |
| UART-SCHEDULE-01 | CAM `<SCHED:JSON>` → no handler; WROOM schedule service TODO. | Bad indices/times/chunk/oversize. | **CONTRACT MISMATCH** |
| UART-TARE-01 / CAL-01 / CFG-01 | CAM emits `<TARE>`, `<CAL:g>`, `<CFG:JSON>` → no handler. | Invalid values and busy state. | **CONTRACT MISMATCH** |
| UART-TELEM-01 | CAM expects `<TELEM:JSON>` → CAM updates status/SSE; WROOM has no producer. | Stale/malformed telemetry. | Producer is **MISSING** |
| UART-LOG-01 | WROOM `<LOG:amount>` → CAM parses float → fabricated `OK` SSE record. | Bad number/partial data/duplicate. | Semantic record schema **CONTRACT MISMATCH** |
| UART-LOW-01 | WROOM `<LOW_FOOD>` → CAM emits fixed `{pct:12}`. | stale ultrasonic/no echo/repeated alerts. | Source path only, event not measured. **NOT VERIFIED** |
| UART-PET-01 | WROOM IR `<PET_DETECTED>` → CAM emits fixed PET verdict and sends `<VERDICT:PET>` → WROOM only transitions WAIT_PET to DISPENSE. | Person/other, stale verdict, wrong state, replay. | No TinyML; hardware path **CONTRACT MISMATCH** |
| UART-PARSER-01 | Inject invalid checksum, truncated, oversized, delimiter noise, unknown command; verify resync and next valid command. | Required but no device-independent harness. | No checksum or explicit frame bound exists; runtime test **BLOCKED** |

## Feature integration traces

| Feature | Required path and evidence | Earliest broken link / status |
|---|---|---|
| Overview | WROOM sensor/RTC → TELEM frame → CAM status/SSE → `telemetryFromRaw` → visible values | WROOM does not send TELEM; CAM fallback is synthetic. **FAIL** |
| Manual feed | UI → HTTP → CAM → UART → WROOM PRECHECK/state → actuator/result → correlated event → UI | WROOM ACK/ID absent; CAM sends extra unsupported command. **CONTRACT MISMATCH** |
| Abort | UI → route → UART → immediate gate close/state → result event → UI | No WROOM ABORT handler. **CONTRACT MISMATCH** |
| Clear fault | UI → route → UART → fault reset → state event → UI | No CLEAR handler. **CONTRACT MISMATCH** |
| Schedules | UI → PUT → CAM → SCHED parser/storage → RTC scheduler → execution log → refreshed UI | No SCHED parser or scheduler. **CONTRACT MISMATCH** |
| History | WROOM full feed record → UART → CAM history storage/GET → SSE/REST → UI | WROOM sends only amount; CAM fabricates SSE record and GET remains empty. **FAIL** |
| Pet detection | IR trigger → image classification/vote → verdict → WROOM gate decision → event/UI | CAM calls IR trigger a fixed pet verdict; no vision model. **CONTRACT MISMATCH** |
| Tare/calibration | UI → CAM → WROOM validation/scale result → ACK/event → UI | No WROOM handlers; CAM fixed calibration value. **CONTRACT MISMATCH** |
| Configuration | UI → CAM → WROOM validate/persist → readback → UI | No CFG handler or readback. **CONTRACT MISMATCH** |
| Camera | OV2640 capture → CAM route JPEG → frontend Blob/image | Hardware and asynchronous buffer ownership untested. **BLOCKED** |

## Safe failure injection status

Missing/wrong keys, HTTP 400/401/429/500/503, JSON type errors, boundary values, CAM-down/WROOM-down, timeout, SSE HTML/bad MIME, event corruption/reconnect, UART checksum/truncation/oversize, duplicate feed, stale heartbeat, busy/faulted tare/calibration, and invalid sensor values were **not** sent to hardware. The relevant source defects and missing tests are recorded above; HTTP mock behavior from the proxy smoke test is not counted as firmware behavior. State-changing tests remain blocked pending an isolated test harness or a safe authorized bench procedure.
