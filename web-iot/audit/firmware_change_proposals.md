# Firmware Change Proposals (Not Implemented)

Firmware was inspected but not modified, per the audit scope. These are proposed changes for review and later firmware work. No proposal is a claim that a fix was tested.

## ESP32-WROOM — `../esp-code/ESP_WROOM_32_code.ino`

1. **Define and enforce a bounded command protocol in `commService()`.** Replace ad-hoc `String` parsing with a versioned frame containing message type, request ID, bounded payload length, and CRC. Validate delimiters, complete frame, checksum, exact numeric syntax, size, and supported fields. Resynchronize after malformed frames. CRC only detects accidental corruption; it does not authenticate the CAM.
2. **Implement explicit response messages.** For each accepted/rejected command emit an ACK/NAK carrying the request ID. Emit a separate terminal result event when an operation completes. Include status/error reason. CAM must not infer completion from a command write.
3. **Implement safe `FEED_NOW` handling.** Reject non-numeric, non-finite, and out-of-range portions locally (independent of CAM validation); reject when busy/faulted; deduplicate request IDs; ensure retry does not create a second feed. Set all operation timers/tokens intentionally.
4. **Implement `ABORT` in the parser and feeder state machine.** Close the gate first, prevent TOPUP/reopen transitions, preserve measured partial amount, and report ABORTED. Handle abort during precheck, wait-pet, dispense, settle, top-up, and idle. Add an emergency watchdog path and test gate-close failure behavior.
5. **Bound dispensing and recovery.** In `feederTask()`, add maximum elapsed dispense time, maximum top-up count and cumulative gate-open time, fresh HX711 sample requirement, sensor range checks, and a latched fault on no-weight-change. Ensure every timeout closes gate and exits to safe idle/fault without reopening automatically.
6. **Implement `CLEAR` with guarded recovery.** Define allowed fault states, verify actuator closed and sensors valid before clearing, and return result; do not restart an old operation when clearing.
7. **Implement `SCHED`, `TARE`, `CAL`, and `CFG` handlers.** Validate indices/time/portion, require idle for tare/calibration, constrain known mass and config ranges, persist only validated data in Preferences, and read it back for confirmation. Update `clockService()` to execute schedule slots using stable daily tokens, RTC-validity checks, and crash/reboot duplicate prevention. `lastFedToken` and schedule behavior currently are not used/implemented.
8. **Add complete telemetry and log producers.** Emit `<TELEM:...>` with fresh sensor timestamp/value/validity and gate/state, not stale values. Emit structured log with operation ID, source, target, initial/final/net weight, terminal result, duration, retry counts, and timestamp. Send state/fault transitions.
9. **Harden sensor and timing services.** Represent ultrasonic timeout/invalid readings as unknown rather than 0%; debounce IR and prevent stale pet verdict reuse; check RTC availability/validity before schedule control; detect HX711 unavailable or stale. Audit `readStringUntil` timeout and blocking `delay` paths against watchdog and UART servicing.
10. **Native test seams.** Factor parser, scheduler, safety prechecks, and state transitions into host-testable functions with no GPIO side effects; add tests for frame boundaries, invalid values, duplicates, fault/reboot, stale sensor, abort, and bounded top-up.

## ESP32-CAM — `../esp-code/ESP-32-CAM-code.ino`

1. **Replace source-level API credential.** Provision a unique per-device secret without committing it, reject placeholder/empty keys at build or boot, rate-limit failed auth, and document recovery/rotation. Current API key source constant is redacted here.
2. **Bound HTTP body handling.** Accumulate callbacks using `index` and `total` under explicit limits. Reject oversized, fragmented/malformed JSON, wrong content type, missing/wrong types, unknown fields if policy requires, invalid schedule ranges and calibration/config values. Do not construct a `String` from an unbounded/non-terminated callback pointer.
3. **Serialize commands through one queue.** Do not send both FEED_NOW and FEED. Add command IDs, bounded queue behavior, WROOM ACK/NAK timeout handling, 429/503 mapping, and terminal outcome correlation. Return 202 only after WROOM explicitly accepts. Retain the distinction between accepted and completed in SSE/status.
4. **Implement all matching routes consistently.** Ensure abort/clear/schedule/tare/cal/config are supported by WROOM before returning accepted. Validate UART link for every device-dependent route. Provide accurate status codes and stable JSON error payloads.
5. **Build status/history from WROOM frames.** Remove synthetic initial telemetry as a successful sensor state; expose unavailable/stale flags. Store complete feed records in bounded RAM or persistence so `/api/log` returns real data. Do not fabricate result=OK, source, target, timestamp, or confidence.
6. **Protect read routes and SSE.** Define a LAN threat model; restrict CORS to the intended origin; protect status, logs, snapshot, schedules and events. Since native EventSource cannot set arbitrary headers, use same-origin server-side proxy auth or a narrowly scoped short-lived token mechanism; do not put a long-lived key in a URL.
7. **Fix camera response lifetime.** Confirm exact AsyncWebServer response ownership. Keep the camera framebuffer held until transmission completion, or copy into response-owned memory before releasing it. Limit concurrent captures and verify with large/slow clients.
8. **Bound UART receiver.** Use nonblocking buffered parser with frame length cap, checksum verification, known event schemas, multiple-frame draining, and resync. Ensure long routes do not starve heartbeat and camera tasks.
9. **Implement actual vision semantics or change naming.** Current IR-to-fixed-confidence bridge is not TinyML. Either add verified camera inference/voting and pass a time-bounded verdict to WROOM, or report IR presence only.
10. **Recovery and network safety.** Add Wi-Fi reconnect/backoff and explicit offline state; current station loop blocks indefinitely and has no recovery path. Do not add an insecure fallback access point. Test network loss/restart on isolated bench.

## Cross-board changes

- Freeze a shared protocol document and fixtures for every command/event, frame version, max size, validation rule, timeout, retry, ACK/NAK, idempotency window, and result mapping.
- Verify board pin mapping and crossover/common ground with circuit source; current code uses CAM RX14/TX15 and WROOM RX16/TX17 at 115200 8N1. Circuit diagrams still need visual review.
- Add host parser/state-machine tests and actual two-board UART loopback before HTTP route tests.
- Never use an “accepted” response as evidence of physical operation. UI completion should follow correlated terminal result or a fresh state transition with matching operation ID.
