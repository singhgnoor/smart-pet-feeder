# Phase 2 results — protocol reconciliation and integration remediation

**Date:** 2026-10-15  
**Scope:** web-only changes and software/static verification. Both ESP32 sketches were inspected and left unchanged. No physical device/network test was performed.

## Executive result

The web client now avoids presenting several known CAM-generated defaults as device facts. Hardware status is shown separately from unverified feeder telemetry. Hardware controls and readbacks that have no WROOM handler or trustworthy device result are rejected locally. A valid HTTP 202 is labeled `cam-accepted`; malformed 202 responses are errors. The mock simulator remains available.

The project remains **NOT READY — INTEGRATION BLOCKERS REMAIN**. The CAM/WROOM protocol still cannot safely complete end-to-end commands. Hardware tests, actual SSE, actual UART, and physical actuator behavior are pending. The reference UART V1 frame and ACK contract in `CANONICAL_PROTOCOL.md` is proposed, not present in firmware.

## 1. Web-only changes made

- `src/services/restDevice.ts`: reject malformed 202 bodies; add the explicit `cam-accepted` stage; reject unsupported WROOM operations before HTTP; stop treating failed schedule/history reads as empty success; remove hardware-side configuration fallback/cache; require non-empty `image/jpeg` snapshots; suppress current synthetic telemetry, log, and fixed-confidence pet events; convert low-food alert to threshold-only wording.
- `src/types/device.ts`: allow telemetry to be unknown and define command stage; add the `UNSUPPORTED` error code.
- `src/context/DeviceContext.tsx`: hardware telemetry remains unavailable; `canOperate` is false in hardware mode until device telemetry and operation correlation are implemented; accepted feed copy does not claim dispensing; mode changes clear old-mode state; an older request cannot overwrite a newer mode/refresh; unsupported status is visible.
- `src/components/TopBar.tsx`: separate CAM connection/UART-link badges and show that feeder data is unverified.
- `src/pages/HomeOverview.tsx`, `DeviceStatusView.tsx`, `AnalyticsView.tsx`, `LiveCameraView.tsx`, `ScheduleView.tsx`, `FeedingLogsView.tsx`, `SettingsView.tsx`: remove hardware-mode default sensor values, sample charts, mock images, fixed AI confidence, and unsupported actions/config presentation. Mock-mode features remain enabled.
- `src/services/deviceService.ts`: document that hardware calls can be unsupported and 202 is CAM acceptance only.
- `audit/frontend_client_smoke_test.mjs`: test these behaviors independently using fake fetch/EventSource.
- `audit/contract_audit.py`: static scan writes phase-2 output to a new filename. Original phase-1 `static_contract_results.json` remains a baseline snapshot.

No firmware source files were modified. No change was made outside the writable web workspace.

## 2. Findings resolved or mitigated

No original firmware or whole-system finding is closed. The original severity totals remain **5 High, 7 Medium, 1 Low, 2 Informational**.

Web mitigations only:

- **PAW-H-05:** partial mitigation: the browser no longer presents current CAM default telemetry, fabricated log events, or fixed pet confidence as verified readings. Firmware still emits/serves these values, so the finding remains open.
- **PAW-H-04:** partial mitigation: 202 is distinguished from completion; no operation is linked to unrelated telemetry/log events. Device IDs/ACKs/dedupe are still missing; feed is disabled in hardware UI.
- **PAW-M-01:** partial mitigation: unsupported WROOM operations fail before network calls and their settings controls are disabled. Firmware handlers remain missing.
- **PAW-I-02:** partial mitigation: hardware AI check is disabled and unsupported pet verdicts are ignored. Firmware still labels IR as fixed-confidence PET.
- **PAW-L-01:** independent reference protocol tests and a phase-2 static output were added, but there is still no project test/lint script, CI, pinned firmware build, or firmware-native test seam.

No severity finding is fully closed and no physical safety/security issue is reported fixed.

## 3. Protocol mismatches remaining

- Feed: CAM sends `FEED_NOW` and `FEED`; WROOM handles only the former, without local portion bounds, ACK, ID, or deduplication.
- Abort/clear/schedule/tare/calibration/configuration: CAM routes send commands with no WROOM command handlers; schedules are not persisted/executed.
- Status: WROOM has no telemetry producer; CAM can return and broadcast defaults.
- History: WROOM emits amount only; CAM synthesizes a full success log and HTTP log remains empty.
- Pet: IR presence is converted into a fixed-confidence vision verdict.
- SSE: CAM does not emit `status`/`error`; real content type/reconnect/transport was not checked against hardware.
- UART framing: no length limit, checksum, escaping, ID, ACK/NAK, or duplicate semantics in checked-in sketches.
- CAM HTTP parsing: request chunking, JSON errors, body size, schemas and some ranges are not validated in firmware.
- CAM route credentials/auth behavior remains a firmware issue; browser credentials remain server-side in Vite development mode only.

## 4. Automated verification

| Check | Result | Scope |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript compile; no runtime/device evidence |
| `npm run build` | PASS with existing large-chunk warning (683.50 kB JS, 193.33 kB gzip) | Production web bundle |
| `npm audit --json` | PASS; 0 known vulnerabilities | Resolved npm dependency tree |
| Independent protocol harness | PASS, 14 tests | Python reference codec/validator/auth/HTTP/SSE/error propagation/ID ledger/heartbeat/schedule simulator plus static firmware source checks; simulated/software-only |
| Frontend client smoke | PASS | Fake fetch/EventSource; includes malformed 202, unsupported local rejection, CAM-only acceptance and unverified telemetry suppression |
| Static contract audit | PASS as a scan, findings remain | Source route, producer/consumer/event inventory; not a device test |
| Vite proxy smoke | PASS | Local fake CAM; server-side API-key injection, GET key omission, SSE MIME/frame; no device contacted |
| npm test / lint | NOT AVAILABLE | `package.json` defines no test or lint script |
| CAM/WROOM firmware build/native tests | BLOCKED | No Arduino CLI/PlatformIO manifest/toolchain/test harness available |
| Actual endpoint/auth/SSE/UART tests | BLOCKED | No authorized hardware/device network was supplied |
| Safe physical feed/abort operation | BLOCKED | No explicit safe fixture/procedure authorization; no actuator command sent |

See `PHASE_2_VERIFICATION_EVIDENCE.md`, `phase2_static_contract_results.json`, and `PHASE_2_ENDPOINT_STATUS.json` for detailed evidence and statuses.

## 5. Remaining blockers and firmware work

The WROOM needs safe bounded feed/abort state transitions and sensor validity; the CAM and WROOM need a request ID, bounded frame, explicit ACK/NAK, deduplication, and terminal result contract. WROOM must produce valid telemetry/history and handle the mutation commands that the CAM exposes. CAM HTTP body parsing/auth, schedule/config persistence, and camera buffer lifetime need firmware changes. Detailed, prioritized patches and tests are in `PHASE_2_FIRMWARE_PATCH_PLAN.md`.

## 6. Hardware verification still pending

No actual CAM connectivity, WROOM heartbeat, device SSE, read-only schedule/history, JPEG transfer, UART frame, command delivery, configuration persistence, or physical feed was verified. Current source suggests route/frame mismatches; static source inspection is not a hardware run. Keep all hardware commands gated until the firmware patch plan is implemented and the safety test sequence approved.

## 7. Commands to rerun

From the `web-iot` directory, after dependencies are installed:

```powershell
npm run typecheck
npm run build
npm audit --json
python -m unittest discover -s audit -p test_protocol_harness.py -v
node audit\frontend_client_smoke_test.mjs
python audit\contract_audit.py
node audit\proxy_smoke_test.mjs
```

The last command starts loopback fake servers and reads the ignored `.env` key only to assert it is absent from the bundle; it does not print the key or reach hardware. No direct browser-to-WROOM connection exists.

## 8. Recommended next sequence

1. Review/freeze `CANONICAL_PROTOCOL.md`, especially frame encoding, field ranges, ID lifecycle, retries, and terminal-result meaning.
2. Implement WROOM parser host tests, feed validation, bounded top-up, safe abort, ACK/NAK, ID deduplication, telemetry and complete logs.
3. Implement CAM bounded HTTP parsing, auth provisioning, one-command queue, correlated UART handling, truthful status/SSE, persistent history/schedules, and snapshot buffer ownership.
4. Implement and test clear/schedule/tare/calibration/config semantics with persistence/readback.
5. Compile both boards using pinned dependencies; run host protocol tests and UART loopback; then CAM HTTP/SSE harness.
6. Conduct isolated, non-actuating hardware checks; perform physical feed/abort only on an explicitly approved safe fixture with supervision.
7. Re-enable hardware UI controls only after correlated terminal events and fresh telemetry pass the full integration matrix.

