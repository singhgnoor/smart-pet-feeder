# PawPilot canonical protocol and reconciliation

**Revision:** phase 2 draft, 2026-10-15  
**Authority:** checked-in CAM/WROOM source determines *current* behavior. The intended contract below is the minimum target contract; it is not implemented or hardware verified unless explicitly marked.

## 1. System boundary and trust

The browser talks only to the ESP32-CAM through same-origin `/api/*` and `/events`. The CAM is the HTTP/API-key boundary and UART bridge. The WROOM is the authority for actuator state, sensor values, schedule persistence, feeding result, and faults. A CAM HTTP response cannot prove WROOM receipt or physical completion. The development Vite proxy is not a production gateway and does not provide a production origin, TLS, or server-side secret store.

The checked-in frontend can configure `VITE_ESP32_HOST` and `VITE_ESP32_PORT` for the development proxy. `DEVICE_API_KEY` is injected by that proxy on non-read methods; it must not be exposed in `VITE_*` browser variables. Current CAM allows public read routes/SSE and uses wildcard CORS. Deployment must use a private LAN or a secured same-origin backend; long-lived keys must not be placed in browser storage or URLs.

## 2. HTTP contract

Common rules for the target: JSON requests use `Content-Type: application/json`; JSON responses use `application/json`. Mutations require `X-API-Key` at CAM and validate before queueing. A `202` means *accepted at the stage named in the response only*. It never means that dispensing or another physical operation completed. Errors have stable JSON `{ "error": "CODE", "message": "safe description" }`; clients preserve state on error.

| Method/path | Current checked-in CAM behavior | Target contract / phase-2 web behavior |
|---|---|---|
| `GET /api/status` | Public 200 JSON `{link,rssi,state,telem}`. Initial `telem` is initialized defaults; WROOM has no TELEM producer. | Return CAM reachability separately from WROOM heartbeat and a telemetry validity/freshness marker. Until this exists, web shows connectivity only and withholds sensor values. |
| `POST /api/feed` | API key; body `{grams}`; CAM range 5..200; sends both `FEED_NOW:g` and unsupported `FEED:g`; responds 202 with constant ID. No WROOM ACK. | Body `{ "grams": integer 5..200 }`. 202 `{accepted:true,id:uint32,stage:"wroom-accepted"}` only after correlated WROOM ACK; terminal event carries same ID. Phase-2 web labels any existing 202 `cam-accepted`, never completion; UI disables the action while device telemetry/correlation is unverifiable. |
| `POST /api/abort` | API key; sends ABORT; 202; WROOM has no handler. | Body `{id:uint32}` or explicit request ID header; WROOM closes gate and returns correlated acceptance/terminal ABORTED. Phase-2 blocks this operation before transport. |
| `POST /api/clear` | API key; sends CLEAR; 202; WROOM has no handler. | Guarded clear request, allowed fault codes only; WROOM reports rejection or cleared result by ID. Phase-2 blocks before transport. |
| `GET /api/schedule` | Public in-memory CAM `scheduleJson`, not WROOM persistence. | Return WROOM persisted schedule and revision, not CAM echo. Phase-2 treats schedule as unavailable. |
| `PUT /api/schedule` | API key; raw body copied/forwarded, no complete body/schema validation; WROOM has no handler. | Full replacement array of four unique `{i,hh,mm,g,en}` slots; hours 0..23, minute 0..59, portion 5..200 integer, en 0/1. Return 202 only after device ACK; GET/readback must match persisted revision. Phase-2 blocks before transport. |
| `GET /api/log` | Public `[]`; CAM buffer is not populated. | Newest-first complete records with operation ID, source, target, start/final/net weight, result, duration, retry counts and timestamp. Phase-2 treats history as unavailable. |
| `GET /api/snapshot.jpg` | Public camera capture; intended JPEG; runtime/frame lifetime not verified. | 200 `image/jpeg` bytes or stable JSON/text error. Phase-2 requires MIME and non-empty body before display. |
| `POST /api/tare` | API key; sends TARE; no WROOM handler; 202. | No-body request; WROOM only accepts while safe/idle, applies tare and returns correlated result. Phase-2 blocks before transport. |
| `POST /api/calibrate` | API key; CAM defaults known mass to 200 on malformed input; sends CAL; returns fixed factor without WROOM result. | `{known_g:number}` within a documented positive range; require idle and fresh stable scale; return measured factor only after WROOM result. Phase-2 blocks before transport. |
| `POST /api/config` | API key; raw body forwarding; WROOM has no CFG handler. | Strict `{leftover_g,overshoot_g,daily_g,require_pet}` schema/ranges, persistent WROOM readback/revision; accepted only after device ACK. Phase-2 blocks before transport. |
| `GET /events` | AsyncEventSource route. CAM emits `telemetry`, `log`, `pet`, `low_food`; several payloads are synthetic. | `text/event-stream`, no intermediary buffering, named JSON events; reconnect-safe. `command` carries `{id,phase,result?,error?}`. A valid operation is correlated by ID. Existing telemetry/log/pet data are ignored in hardware mode pending trusted producers. |

### Error/status mapping target

- `400`: invalid content type, malformed JSON, missing field, wrong type, or range failure.
- `401`: missing/incorrect API key for mutation.
- `409`: busy, fault-latched, duplicate ID with conflicting payload, or stale revision.
- `429`: bounded command queue full (if separately rate-limited).
- `502`: browser-to-CAM proxy cannot reach CAM.
- `503`: CAM is up but WROOM link/ACK path is unavailable.
- `504`: CAM-to-WROOM ACK timeout. No automatic retry of a non-idempotent command without the original ID.

Current CAM source does not consistently implement this mapping. The browser only maps observed HTTP status and does not synthesize a successful result on malformed 202.

## 3. SSE events

Target event payloads:

- `telemetry`: `{ts,valid,age_ms,t,w,hop,st,ir,vis,day,gate}`. Invalid/stale sensor fields are explicitly invalid/unknown; never default to plausible zeros.
- `status`: `{ts,link,state,fault?}`; this is device status, distinct from browser/EventSource connectivity.
- `command`: `{id,phase:"queued"|"delivered"|"accepted"|"started"|"completed"|"rejected"|"failed"|"aborted",result?,error?}`. Phase order is monotonic and correlated to one ID.
- `log`: a complete terminal record with `id`, and same schema as `/api/log`.
- `pet`: actual implemented classifier verdict only; current IR-to-fixed-confidence bridge is not a vision result.
- `low_food`: `{ts,valid,pct}` only when measured percent is valid. Current CAM hardcodes `pct:12`; consumers must not display that value as a measurement.
- `error`: `{id?,code,message}`; must be emitted only for a real device/CAM error.

Current CAM does not emit `status` or `error`; current WROOM does not produce telemetry. Browser EventSource auto-reconnect is transport behavior, not evidence that the UART or sensor path recovered. The Vite proxy supplies keep-alive/no-cache and passes SSE in a local smoke test only; production must configure equivalent unbuffered streaming in a real backend/reverse proxy.

## 4. UART framing and command contracts

### Current firmware wire facts (not the target)

- CAM Serial2: 115200 baud, 8N1, RX14/TX15. WROOM Serial2: 115200 baud, 8N1, RX16/TX17. Physical cross-connect/common ground remains unverified.
- Current framing is angle-bracketed text terminated by newline, e.g. `<FEED_NOW:50>\n`; no length cap, checksum, request ID, escaping rule, ACK/NAK, or deduplication is defined.
- WROOM recognizes `FEED_NOW:`, `VERDICT:PET`, and `HB:`. CAM additionally sends `FEED:`, `ABORT`, `CLEAR`, `SCHED:`, `TARE`, `CAL:`, and `CFG:`; those have no WROOM handler. `FEED_NOW` has no local WROOM range validation.
- WROOM emits `<HB:uptime>`, `<LOW_FOOD>`, `<PET_DETECTED>`, and `<LOG:amount>`. It emits no `<TELEM:...>` and no terminal response correlated to a request. CAM converts amount-only LOG into a full-looking `OK` record and periodically republishes initialized telemetry defaults.
- WROOM sends heartbeat every 2 seconds; source uses a 6-second link timeout. CAM answers inbound WROOM heartbeat with `<HB:OK>`. This is liveness only, not command acceptance.

### Minimum target frame (proposed; firmware change required)

Use a bounded textual envelope for straightforward host fixtures and firmware parsing:

`<v1|TYPE|ID|LEN|PAYLOAD|CRC16>\n`

- `TYPE`: uppercase token from the list below; `ID`: unsigned 32-bit decimal (0 reserved for liveness/unsolicited events); `LEN`: decoded payload byte count; `PAYLOAD`: percent-escaped UTF-8 JSON or empty; escape `%`, `<`, `>`, `|`, CR, LF as `%HH` bytes; cap decoded payload at 384 bytes and full frame at 512 bytes.
- `CRC16`: CRC-16/CCITT-FALSE (poly `0x1021`, init `0xFFFF`, no reflection, xorout `0`) over the bytes after `<` through the delimiter immediately before the CRC. CRC detects accidental corruption only. It does not authenticate a sender or prevent replay/tampering by an attacker with UART access.
- Parser requires exact length, valid escaping, known type, valid JSON schema, valid checksum, and complete closing delimiter. On failure discard the frame, resynchronize at the next `<`, and emit no actuator action. Never treat a partial/oversize frame as a command.

| Message | Direction | Payload | Required response / effect |
|---|---|---|---|
| `PING` / `PONG` | CAM→WROOM / WROOM→CAM | `{ "uptime_ms": n }` | PONG carries ID, reset/uptime and status; timeout after 6 seconds marks UART down. Heartbeat ID 0 is not a command ACK. |
| `FEED` | CAM→WROOM | `{ "grams": n }` | Local range, state, sensor, daily and hopper checks; ACK/NAK for same ID. Duplicate ID+identical payload returns prior stage/result without another dispense. |
| `ABORT` | CAM→WROOM | `{}` | Close gate first; reject if closure cannot be established. Correlated terminal `ABORTED` or rejection. |
| `CLEAR` | CAM→WROOM | `{}` | Validate fault and safe recovery preconditions; correlated ACK/NAK and cleared state. Must never resume an old feed. |
| `SCHEDULE_SET` | CAM→WROOM | `{ "revision": n, "slots":[...] }` | Validate all four slots atomically, persist and read back; ACK revision or NAK. |
| `SCHEDULE_GET` | CAM→WROOM | `{}` | Return persisted revision and slots. |
| `TARE`, `CALIBRATE`, `CONFIG_SET` | CAM→WROOM | bounded typed JSON | Only safe preconditions; device result/readback correlated by ID; errors propagate. |
| `ACK`, `NAK` | WROOM→CAM | `{ "phase":"accepted" }` or `{ "code":..., "message":... }` | Must echo ID. ACK means WROOM accepted, not physical completion. |
| `COMMAND_EVENT` | WROOM→CAM | `{ "phase":"started"|"completed"|"aborted"|"failed", "result":... }` | Echo ID; only terminal event can close the command tracker. |
| `TELEMETRY` | WROOM→CAM | versioned sensor record with per-sensor validity/time | Fresh measured values; CAM forwards as SSE/status without inventing fields. |
| `FEED_LOG` | WROOM→CAM | complete log record including ID/result | CAM stores bounded history and serves same record from HTTP and SSE. |
| `PET_PRESENCE` / `PET_VERDICT` | WROOM↔CAM | timestamped IR/presence and actual classifier result | Presence must not be mislabeled as vision classification; verdict has bounded lifetime and operation context. |
| `FAULT` | WROOM→CAM | `{ "code":..., "latched":true }` | Forward to status/SSE; clear only after guarded device-side validation. |

Command IDs are allocated by CAM, monotonically advanced with reboot-safe random/session component or persisted counter, and retained in a bounded dedupe journal. Same ID with a different payload is rejected. CAM tracks each ID through delivery, WROOM acceptance, start, and terminal result. Lost ACK must be queried/retried with the *same* ID; it must never allocate a new feed ID. A terminal result must not be inferred from unrelated telemetry or amount-only log events.

## 5. Current producer→consumer trace summary

| Path | Current source trace | Status |
|---|---|---|
| Manual feed | UI→POST feed `{grams}`→CAM validates→writes two UART strings→WROOM handles first command only if IDLE→amount-only log→CAM fabricates success; no command ACK/ID | Contract mismatch; phase-2 UI suppresses sensor/progress and treats 202 as CAM-only acceptance |
| Abort/clear/tare/cal/config | UI service previously called CAM route→CAM writes string→WROOM parser has no matching branch→CAM 202 | Unsupported; phase-2 client rejects locally |
| Schedule | CAM keeps RAM JSON and echoes it; WROOM has no handler or schedule implementation | Unsupported; phase-2 client rejects locally |
| Telemetry | CAM parser accepts TELEM, but WROOM source has no producer; CAM initial values are SSE-emitted | Unverified/synthetic; phase-2 client suppresses sensor events and status telemetry |
| History | WROOM amount-only LOG→CAM fabricates full OK record for SSE; `/api/log` buffer stays empty | Contract mismatch; phase-2 client ignores hardware log event and treats history unavailable |
| Pet | WROOM IR event→CAM assigns fixed pet/confidence→WROOM verdict | Presence only, not TinyML; phase-2 client does not treat it as a vision verdict |
| Camera | Camera capture→CAM snapshot route→browser image | Source contract compatible; real response/runtime blocked |

## 6. Phase-2 web safeguards

The web client keeps the dev proxy and mock simulator. Hardware status can establish CAM connectivity and report the CAM's UART-link bit, but current CAM telemetry values are not surfaced. Unsupported WROOM mutations/readbacks fail with `UNSUPPORTED` before an HTTP request. `202` requires a valid JSON object with `accepted:true` and is tagged `cam-accepted`; no terminal event is correlated because the firmware supplies no ID contract. The hardware manual-feed control remains disabled because fresh feeder telemetry is unavailable. No workaround fabricates device behavior.

