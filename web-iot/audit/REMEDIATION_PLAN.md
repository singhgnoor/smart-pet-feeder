# Remediation Plan

Firmware recommendations are proposals only. No firmware source changes were made during this audit.

## 1. Critical safety and security fixes

No Critical-class finding was confirmed. Address these High findings before any actuator integration test:

1. **Replace and rotate the committed CAM API placeholder** (PAW-H-01). Provision a per-device key outside source control; configure the CAM and server-side Vite proxy with the same value; verify missing/wrong/correct authentication on an isolated device. The browser bundle must remain key-free.
2. **Bound WROOM dispense recovery** (PAW-H-03). Add stale/invalid scale detection, bounded top-up count and total gate-open duration, close-on-timeout, and a latched fault. Unit-test with a simulated frozen scale before any actuator bench test.
3. **Implement safe abort** (PAW-H-02). Close gate immediately, suppress top-up/reopen transitions, report terminal abort with request ID. Test each state transition with an actuator disconnected or safe load fixture first.
4. **Add command IDs, dedupe, and ACK/NAK** (PAW-H-04). Define retry semantics and persistent or bounded dedupe policy. HTTP 202 should mean WROOM accepted, and terminal result should correlate to that ID.
5. **Replace synthetic status and log records** (PAW-H-05). Define complete validated WROOM telemetry/log frames, stale-data handling, real history storage/readback, and actual result status. UI must show unavailable until a real frame arrives.

Dependencies: establish protocol frame version and message fixtures before implementing handlers; then implement WROOM state/ACK behavior, CAM parser/HTTP queue, frontend event correlation, and an isolated firmware-native test harness.

## 2. High-priority fixes

- Cover all mutation commands in WROOM: CLEAR, SCHED, TARE, CAL, CFG. Return explicit rejection for unsupported commands rather than silent ignore.
- Harden CAM body accumulation, maximum length, content-type checking, JSON parsing, and field/range validation. Validate schedule indices/time/portion and calibration/config values before changing RAM or sending UART.
- Add independent WROOM portion bounds and sensor readiness/validity. The actuator board must not rely solely on CAM checks.
- Confirm snapshot framebuffer ownership using the exact AsyncWebServer version; retain or copy the buffer through response completion.
- Document and apply a read-route/SSE network access policy. Restrict wildcard CORS and protect camera/history/telemetry.

## 3. Integration blockers

1. Implement schedule persistence/execution, RTC validity checks, daily token rollover, and reboot/duplicate tests.
2. Define complete log records; make `/api/log` return real history instead of an unchanged empty array.
3. Implement telemetry/state/error event producers with fresh timestamps and input validation. Ensure frontend event names and schemas match exactly.
4. Replace fixed IR-derived PET confidence with verified camera inference, or label UI as IR presence only. Test verdict expiry and pet-wait timeout.
5. Ensure Wi-Fi disconnect/recovery is nonblocking and reported honestly; avoid public fallback AP behavior.
6. Confirm UART crossover wiring/common ground, board-specific pin compatibility, heartbeat recovery, partial-frame handling, and queue/backpressure behavior on bench.

## 4. Medium-priority reliability fixes

- Bound and resynchronize UART frame parsing; replace unbounded String use; consider CRC for accidental corruption and explicitly document that CRC is not sender authentication.
- Add state-machine tests for malformed data, repeated commands, lost ACK, fault latch, reboot in dispense, no weight increase, ultrasonic no-echo, RTC unavailable, and command queue full.
- Add frontend tests for status schema validation, 400/401/429/500/503, malformed JSON, timeouts, stale telemetry, EventSource malformed events, duplicate events, localStorage corruption, and accepted-versus-completed UI behavior.
- Make deployment mode explicit: the current hardware proxy exists only in Vite dev server config; production output has no backend proxy and cannot keep a device key server-side by itself.

## 5. Low-priority improvements

- Add CI for npm build/typecheck/audit and source contract checks; add reproducible firmware build jobs and static analysis when toolchains are pinned.
- Split large frontend output chunk; current production build warns about ~682 kB minified JS.
- Update the parent integration report and add the missing technical reference/documented pin contract; visually review the circuit PDFs.
- Provide dependency provenance/version records for the Arduino libraries and exact board/core versions.

## Retest sequence

1. Static producer-consumer checks and host parser/state unit tests.
2. Compile both boards with pinned core/library versions; inspect compiler warnings and memory use.
3. UART loopback with valid, malformed, truncated, oversized, duplicate, and corrupted frames.
4. CAM HTTP harness tests for auth, schema, body limits, statuses, and disconnected WROOM.
5. Vite proxy + frontend transport tests against the CAM contract harness, including SSE reconnection and error semantics.
6. Isolated hardware bench: read-only status/snapshot/heartbeat first; then non-actuating schedule/config tests.
7. Actuator tests only with an approved safe fixture and supervised protocol for feed, abort, sensor failure, power loss, and recovery.
8. Re-run security review, dependency scans, and all matrices; do not promote to integration verified while any required path remains BLOCKED, NOT VERIFIED, FAIL, MISSING, or CONTRACT MISMATCH.
