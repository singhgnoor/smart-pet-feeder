# Verification Evidence

## Baseline and preservation

- Working directory: `D:\Study\IIT Ropar\Sem 3\TL-project\smart-pet-feeder\web-iot`.
- Initial branch/status: `main...origin/main`, commit `dad720c`, clean status.
- Initial tracked file inventory captured before edits. Local ignored `.env` was not printed, copied, or included in reports.
- Firmware lives in the parent project directory, outside the writable Git checkout. It was read only. SHA-256 comparison showed matching copies by role: `esp-code/ESP-32-CAM-code.ino` equals `Arduino_IDE_Codes/ESP-32-CAM-code.ino`; WROOM copies also match each other. CAM and WROOM are not duplicates of each other.
- The specified `Smart_Pet_Feeder_V2_Technical_Reference.pdf` was not found. Circuit PDFs are present; visual inspection was not possible because `pdftoppm`, `pdfinfo`, and `pdftotext` were unavailable.

## Commands executed

Initial and inventory commands:

```powershell
Get-Location
git status --short --branch
git log -1 --format='%h %ad %s' --date=iso-strict
git ls-files
Get-ChildItem .. -Force
Get-ChildItem ..\esp-code -Recurse -File -Force
Get-ChildItem ..\Arduino_IDE_Codes -Recurse -File -Force
Get-ChildItem .. -Recurse -File -Filter *.pdf -Force
```

Source was reviewed by reading both sketches with credential literals redacted, frontend REST and wire types, protocol mapper, DeviceService, DeviceContext, Vite config, package/lock metadata, README, `.gitignore`, `.env.example`, parent integration report, WROOM README, and every frontend page/component inventory. Targeted `rg` searches mapped route/event/UART producers and consumers. No command printed the ignored `.env` contents.

Build/test/security commands:

```powershell
npm run build
npm run typecheck
npm audit --json
python audit\contract_audit.py
node audit\frontend_client_smoke_test.mjs
node audit\proxy_smoke_test.mjs
Get-Command arduino-cli, platformio, clang-tidy, cppcheck, gitleaks, trufflehog -ErrorAction SilentlyContinue
git status --short
```

## Results

- `npm run build`: PASS. TypeScript and Vite production build completed. Vite warns the primary JavaScript output exceeds 500 kB minified.
- `npm run typecheck`: PASS (`tsc -b --noEmit`).
- `npm audit --json`: PASS with zero known vulnerabilities in the npm audit response (162 dependency records at run time).
- `python audit\contract_audit.py`: PASS as a scanner. It found 11 CAM routes, CAM commands without WROOM handlers, WROOM's missing telemetry producer, and SSE event producer/consumer differences. Its output explicitly says it is static, not runtime/hardware evidence.
- `node audit\proxy_smoke_test.mjs`: PASS (SIMULATED). A local fake CAM received POST `/api/feed`, the server-side test key and JSON body; it emitted an SSE telemetry event which passed through the local Vite proxy with `text/event-stream`; the configured key was not present in the production bundle. No device address was contacted and no actuator command reached firmware.
- `node audit\frontend_client_smoke_test.mjs`: PASS (SIMULATED). RestDeviceService was loaded through Vite SSR with fake fetch/EventSource. It checked status parsing, feed method/body/202, range rejection before fetch, no browser API-key header, HTTP 401/503 and timeout mapping, schedule serialization/parsing, snapshot Blob conversion, SSE telemetry parsing, malformed-event guard, and unsubscribe. The intentionally malformed frame produced a warning that the test confirmed was caught. This is not React UI or firmware testing.
- Firmware compiler/static-analysis tools were not installed/discoverable; there is no PlatformIO/Arduino project manifest or firmware test harness. Both sketches were not compiled.
- No npm `test` or lint script, React UI test harness, CI workflow, gitleaks/trufflehog, CAM firmware runtime, UART unit tests, or hardware tests were available. The standalone frontend client smoke test above was added and run. No arbitrary audit package was installed.

## Endpoint and UART evidence

The exact source-derived interface inventory and statuses are in `endpoint_inventory.json`. The static source output is in `static_contract_results.json`. The full test procedures and blocked cases are in `integration_test_matrix.md`.

Confirmed source facts:

- CAM route registrations: `/api/status`, `/api/feed`, `/api/abort`, `/api/clear`, GET and PUT `/api/schedule`, `/api/log`, `/api/snapshot.jpg`, `/api/tare`, `/api/calibrate`, `/api/config`; plus AsyncEventSource `/events`, OPTIONS and 404 fallback.
- CAM checks X-API-Key on mutating routes; read routes and SSE do not check it. The committed firmware credential is a placeholder and its value is redacted.
- CAM sends `<FEED_NOW:g>` and `<FEED:g>`; WROOM recognizes only `FEED_NOW:`. WROOM has no ABORT, CLEAR, SCHED, TARE, CAL, or CFG command handler.
- WROOM emits heartbeat, LOW_FOOD, PET_DETECTED, and amount-only LOG; it does not emit TELEM. CAM creates telemetry defaults and fabricates fields for log SSE. CAM's HTTP log buffer remains `[]`.
- WROOM uses a gate state machine with a repeated TOPUP path and no maximum retry count. It lacks local portion range validation.
- The only executed SSE test was fake localhost proxy framing. Actual CAM SSE MIME, persistence/reconnection, event schemas, and browser receipt are NOT VERIFIED.
- No actual CAM↔WROOM network/UART connectivity or physical feed operation was verified. No feed/abort/state-changing request was issued to hardware.

## Remediation retest evidence

Two web-only changes were made in the writable repo: server-side Vite proxy API-key injection and accepted/unconfirmed wording for actions whose 202 response does not prove completion. Regression evidence: successful post-change build, typecheck, frontend fake-transport smoke test, and localhost proxy smoke test. Firmware changes were not made. No hardware side effects were introduced.

## Commands to rerun

From the `web-iot` directory:

```powershell
npm run build
npm run typecheck
npm audit --json
python audit\contract_audit.py
node audit\frontend_client_smoke_test.mjs
node audit\proxy_smoke_test.mjs
```

The last command starts a fake server and a local Vite server on loopback only. It reads the ignored `.env` key into memory solely to assert that it is absent from `dist`; it never prints the value. Hardware verification requires a separate isolated bench setup and a reviewed safety procedure.
