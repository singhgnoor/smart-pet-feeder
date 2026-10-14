# Phase 2 verification evidence

This supplements (and does not replace) `VERIFICATION_EVIDENCE.md`. All current phase-2 runtime checks used local mocks/simulators. No real device or actuator was contacted.

## Commands and results

| Command | Result/evidence |
|---|---|
| `npm run typecheck` | Exit 0. TypeScript project checks passed after the phase-2 UI/service changes. |
| `npm run build` | Exit 0. Vite 6.4.4 transformed 2,220 modules and produced `dist/index.html`, CSS 16.16 kB, JS 683.50 kB (193.33 kB gzip). Existing warning: JS chunk exceeds 500 kB. |
| `npm audit --json` | Exit 0. 162 dependency nodes; 0 info/low/moderate/high/critical advisories in the current npm tree. |
| `python -m unittest discover -s audit -p test_protocol_harness.py -v` | 14 tests currently defined. Covers reference V1 framing/CRC/escaping/size limits, simulated auth/feed response/schema boundaries, SSE event schema, ID duplicate/conflict/busy/terminal and error-propagation model, 6-second heartbeat loss/recovery, atomic schedule model, telemetry schema/staleness, and static source assertions for missing WROOM handlers/TELEM/ACK. Software simulation/source check only. |
| `node audit\frontend_client_smoke_test.mjs` | Exit 0. Fake transport checks status with withheld telemetry, valid CAM 202 stage, malformed 202 rejection, range rejection, HTTP 401/503/timeout mapping, no browser API key, unsupported operations rejected before transport, snapshot MIME/blob and EventSource unsubscribe/suppression. The test intentionally injects malformed telemetry; the client logs a caught parse warning. No CAM or React browser runtime. |
| `python audit\contract_audit.py` | Exit 0 as a source scan. Output saved to `phase2_static_contract_results.json`; 11 CAM REST route registrations, frontend transports limited to status/feed/snapshot, 7 CAM UART command families without WROOM handlers, no WROOM TELEM producer, and CAM/frontend SSE event-name gaps found. These findings are not passes. |
| `node audit\proxy_smoke_test.mjs` | Exit 0. Local fake CAM verifies `/api/feed` forwarding and server-only key injection, read-only key omission, SSE MIME/frame pass-through, and no configured key in `dist` bundle. No network request leaves localhost. |

No `npm test`, lint, CI, Arduino CLI, PlatformIO, `cppcheck`, or CAM route test runner is configured/available. Firmware compilation, CAM HTTP auth/route tests, real EventSource reconnection, UART transfer, schedule persistence, device restart recovery and actuator tests are `BLOCKED`. No feeding command was issued to a device.

## Endpoint test evidence

Phase-1 exact source-derived route/request contracts remain in `endpoint_inventory.json`. Phase-2 status overlay is `PHASE_2_ENDPOINT_STATUS.json`; human-readable procedures are in `PHASE_2_INTEGRATION_TEST_MATRIX.md`.

- 11 registered CAM REST endpoints: source inspected; actual route execution not verified. Fake-client test reaches a fake status/feed server only.
- SSE `/events`: frontend smoke validates local EventSource subscriptions and suppression rules; proxy smoke verifies local `text/event-stream` framing. Actual CAM response MIME, events, buffering, reconnection and disconnect/recovery are `BLOCKED`.
- All CAM mutating endpoints require `X-API-Key` in source according to route gate; fake proxy test proves development proxy attaches a configured key server-side only for non-read methods. Missing/wrong/correct key against CAM is `BLOCKED`.
- Unsupported operations are verified by client smoke to reject locally without calling fetch; this prevents false UI acceptance but does not exercise the corresponding CAM route.
- Snapshot client MIME/non-empty behavior is fixture-tested only. Actual framebuffer lifetime and JPEG bytes are `BLOCKED`.

## UART evidence

`test_protocol_harness.py` is an independent software reference for the proposed frame. Its tests do not parse or execute Arduino functions. Static source scan confirms current WROOM handlers only for `FEED_NOW:`, `VERDICT:`, `HB:` and current output for heartbeat, low-food, pet presence, and amount-only log; no TELEM, ACK/NAK or terminal command event producer. Current real UART frames/checksum/partial reads/retries/recovery are not dynamically tested. No CRC exists in current firmware.

## Hardware and preservation evidence

- No CAM IP/port was probed. The test proxy binds to loopback and a fake local HTTP server.
- No WROOM serial port was opened; no device was reset, flashed, erased or reconfigured.
- No actuator command was sent to real hardware.
- ESP firmware files remain outside the web writable scope and were not targeted by any edit or test command.
- Original phase-1 audit reports and test history are retained. Phase-2 scanner output uses a new file; `static_contract_results.json` is preserved as phase-1 baseline. Existing sibling `Weekly-reports` user files were not touched.
- Secret values were not printed. The proxy smoke test uses an in-memory sentinel key and checks the existing local `.env` only in memory for bundle leakage.

