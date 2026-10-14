# Phase 2 protocol and integration test matrix

Status vocabulary: `PASS`, `FAIL`, `BLOCKED`, `NOT VERIFIED`, `MISSING`, `CONTRACT MISMATCH`, `NOT APPLICABLE`. `SIMULATED PASS` is evidence only for the named software layer. Phase-1 matrix remains intact at `integration_test_matrix.md`.

## HTTP routes

| ID / route | Expected request and result | Auth | Procedure/evidence | Phase-2 result |
|---|---|---|---|---|
| P2-HTTP-01 `GET /api/status` | No body; strict CAM status JSON; no sensor display without fresh WROOM frame | None in checked-in CAM | Fake fetch confirms path and schema mapping; service withholds telemetry; real device not contacted | Client `SIMULATED PASS`; route `NOT VERIFIED`; source telemetry `CONTRACT MISMATCH` |
| P2-HTTP-02 `POST /api/feed` | JSON `{grams:5..200 integer}`; 202 accepted only at stated stage; never completed | `X-API-Key` in CAM, proxy side | Fake client checks URL/method/body/no browser key; malformed 202 rejected; proxy fake checks server key forwarding. CAM sends duplicate/unhandled UART messages and has no response correlation | Client/proxy `SIMULATED PASS`; device path `CONTRACT MISMATCH`; UI action `BLOCKED` pending trusted telemetry/correlation |
| P2-HTTP-03 `POST /api/abort` | Correlated command, gate-close-first result | Key | Rest service smoke confirms unsupported rejection before network request | `BLOCKED` client; `CONTRACT MISMATCH` firmware; no actuator test |
| P2-HTTP-04 `POST /api/clear` | Guarded clear and correlated result | Key | Rest service smoke confirms unsupported rejection before network request | `BLOCKED` client; `CONTRACT MISMATCH` firmware |
| P2-HTTP-05 `GET /api/schedule` | WROOM persisted four-slot schedule/revision | None currently | Rest service smoke confirms local unsupported error; CAM RAM echo not queried | `BLOCKED` client; `CONTRACT MISMATCH` firmware |
| P2-HTTP-06 `PUT /api/schedule` | Complete four-slot JSON; validated atomic persistence/readback | Key | Rest service smoke confirms no network call; Python fixture tests validate canonical boundaries/atomic replacement model | `SIMULATED PASS` reference validator; client `BLOCKED`; firmware `CONTRACT MISMATCH` |
| P2-HTTP-07 `GET /api/log` | Full newest-first device result records | None currently | Rest service smoke confirms unsupported error; no CAM route runtime | `BLOCKED` client; `CONTRACT MISMATCH` firmware |
| P2-HTTP-08 `GET /api/snapshot.jpg` | 200 `image/jpeg`, non-empty binary; errors preserved | None currently | Fake fetch validates client MIME/blob checks; fake proxy returns JSON only on other routes | `SIMULATED PASS` service fixture; hardware `BLOCKED`; overall `NOT VERIFIED` |
| P2-HTTP-09 `POST /api/tare` | No-body command with safe preconditions and correlated actual result | Key | Rest service smoke confirms local unsupported error | `BLOCKED` client; `CONTRACT MISMATCH` firmware |
| P2-HTTP-10 `POST /api/calibrate` | `{known_g:number}` validated; measured result only | Key | Rest service smoke confirms local unsupported error | `BLOCKED` client; `CONTRACT MISMATCH` firmware |
| P2-HTTP-11 `POST /api/config` | Strict config schema and persisted readback | Key | Rest service smoke confirms local unsupported error; no local cache success | `BLOCKED` client; `CONTRACT MISMATCH` firmware |
| P2-HTTP-12 `GET /events` | Open SSE, MIME, valid event schemas, reconnect | None in current CAM | FakeEventSource validates client subscription and suppression of synthetic telemetry; localhost proxy smoke verifies MIME, frame, and pass-through | Proxy/client `SIMULATED PASS`; actual CAM `BLOCKED`; event source contracts `CONTRACT MISMATCH` |
| P2-HTTP-13 `OPTIONS /*` | CORS preflight according to origin policy | None | Static route inspection only; no CAM process | `NOT VERIFIED` |

Authentication negative cases against actual CAM (missing, wrong, correct key) are `BLOCKED`; no device was available. Proxy test confirms the key is added only server-side for non-read methods and is absent from a built bundle. Actual auth strength remains open under PAW-H-01/PAW-M-04.

## UART producer → parser → handler → result

| ID / message | Sender → receiver; current frame | Current handler/result | Phase-2 procedure and result |
|---|---|---|---|
| P2-UART-01 Heartbeat request | CAM→WROOM `<HB:OK>\n` | WROOM recognizes `HB:`; liveness only, no command ACK | Static source trace; software 6s monitor/recovery model tested. Physical UART `BLOCKED`; `NOT VERIFIED` |
| P2-UART-02 Heartbeat report | WROOM→CAM `<HB:uptime>\n` every ~2s | CAM parser replies `<HB:OK>` and marks link | Static trace; no actual serial. `NOT VERIFIED` |
| P2-UART-03 Feed primary | CAM→WROOM `<FEED_NOW:g>\n` | WROOM parses `toInt`, requests feed only in idle; no local range guard/ACK/ID | Canonical Python frame/ledger model passes; source mismatch remains. `CONTRACT MISMATCH` |
| P2-UART-04 Feed duplicate format | CAM→WROOM `<FEED:g>\n` | No WROOM handler | Source scan confirms unhandled. `CONTRACT MISMATCH` |
| P2-UART-05 Abort | CAM→WROOM `<ABORT>\n` | No WROOM handler | Source scan confirms missing; physical path not tried. `MISSING` |
| P2-UART-06 Clear fault | CAM→WROOM `<CLEAR>\n` | No handler | Source scan confirms missing. `MISSING` |
| P2-UART-07 Schedule update | CAM→WROOM `<SCHED:JSON>\n` | No handler; schedule clock is TODO | Source scan confirms missing. `MISSING` |
| P2-UART-08 Tare | CAM→WROOM `<TARE>\n` | No handler | Source scan confirms missing. `MISSING` |
| P2-UART-09 Calibration | CAM→WROOM `<CAL:g>\n` | No handler | Source scan confirms missing. `MISSING` |
| P2-UART-10 Configuration | CAM→WROOM `<CFG:JSON>\n` | No handler | Source scan confirms missing. `MISSING` |
| P2-UART-11 Pet verdict | CAM→WROOM `<VERDICT:PET>\n` | WROOM only accepts while WAIT_PET | Source semantics inspected; no camera classifier/hardware. `CONTRACT MISMATCH` |
| P2-UART-12 Pet presence | WROOM→CAM `<PET_DETECTED>\n` | CAM labels IR as pet with fixed confidence | Static trace; client suppresses event. `CONTRACT MISMATCH` |
| P2-UART-13 Low hopper | WROOM→CAM `<LOW_FOOD>\n` | CAM publishes fixed `pct:12` | Static trace; client converts to threshold-only wording. `CONTRACT MISMATCH` |
| P2-UART-14 Feed log | WROOM→CAM `<LOG:amount>\n` | CAM fabricates full OK record; HTTP log remains empty | Static trace; client ignores hardware log event. `CONTRACT MISMATCH` |
| P2-UART-15 Telemetry | WROOM→CAM expected `<TELEM:JSON>\n` | CAM parser exists; WROOM producer absent | Static source test asserts missing producer. `MISSING` |
| P2-UART-16 ACK/NAK / terminal | WROOM→CAM expected ID-correlated | No producer/parser/HTTP correlation | Canonical ledger simulation passes; source test confirms absent. `MISSING` |
| P2-UART-17 Framing/checksum | Both directions `<...>\n`, no checksum/length/version/escaping | `readStringUntil` / String parsing | Python proposed codec passes round-trip/corruption/length tests; current firmware source remains delimiter-only. `CONTRACT MISMATCH` |

## Feature trace release gate

| Feature | Earliest broken link | Phase-2 state |
|---|---|---|
| Overview | CAM initializes plausible telemetry; WROOM does not produce TELEM | UI withholds readings and displays unavailable; CAM/WROOM integration remains `CONTRACT MISMATCH` |
| Manual feed | CAM emits two strings; WROOM handles one without ID/ACK/result correlation | UI disabled in hardware mode; direct service smoke proves 202 is only `cam-accepted`; physical operation `BLOCKED` |
| Abort | No WROOM handler, no gate closure | Client blocks before network; firmware `MISSING` |
| Clear fault | No WROOM handler | Client blocks before network; firmware `MISSING` |
| Schedules | CAM RAM echo; WROOM storage/execution absent | Client blocks; firmware `MISSING` |
| History | amount-only event fabricated by CAM; `/api/log` remains empty | Hardware log event ignored; firmware contract mismatch |
| Pet detection | IR event mapped to fixed confidence; no inference | Event ignored as a TinyML verdict; camera snapshot path remains unverified |
| Tare/calibration | CAM writes command but WROOM lacks handler | Client blocks; firmware `MISSING` |
| Configuration | CAM forwards command but WROOM lacks handler/readback | Client blocks; local config cache removed from hardware service |
| Camera | Actual capture, async framebuffer lifetime and browser receive unavailable | Fake MIME/blob test only; hardware `BLOCKED` |

## Independent harness scope

`python -m unittest discover -s audit -p test_protocol_harness.py -v` runs the independent Python reference-frame codec, CRC/bounds/escaping tests, feed/schedule schema tests, duplicate ID/ACK ledger model, heartbeat loss/recovery model, atomic schedule persistence model, and checked-in producer/consumer source checks. Passing simulator tests are not firmware tests. Actual CAM HTTP requests, actual SSE, actual UART, WROOM persistence, and physical operation remain `BLOCKED`.

