"""Independent, software-only reference tests for the phase-2 protocol proposal.

These tests exercise a Python reference codec/ledger and inspect source contracts.
They do not execute ESP32 firmware, a CAM route, physical UART, or an actuator.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from urllib.parse import quote, unquote_to_bytes

ROOT = Path(__file__).resolve().parents[1]
CAM_PATH = ROOT.parent / "esp-code" / "ESP-32-CAM-code.ino"
WROOM_PATH = ROOT.parent / "esp-code" / "ESP_WROOM_32_code.ino"
MAX_PAYLOAD = 384
MAX_FRAME = 512


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def encode_frame(kind: str, msg_id: int, payload: bytes = b"") -> bytes:
    if not re.fullmatch(r"[A-Z_]{2,24}", kind) or not 0 <= msg_id <= 0xFFFFFFFF:
        raise ValueError("invalid type or ID")
    if len(payload) > MAX_PAYLOAD:
        raise ValueError("payload too long")
    escaped = quote(payload.decode("utf-8"), safe="-._~,:{}[]\"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ")
    prefix = f"v1|{kind}|{msg_id}|{len(payload)}|{escaped}".encode()
    frame = b"<" + prefix + f"|{crc16(prefix + b'|'):04X}>\n".encode()
    if len(frame) > MAX_FRAME:
        raise ValueError("frame too long")
    return frame


def decode_frame(frame: bytes) -> tuple[str, int, bytes]:
    if len(frame) > MAX_FRAME or not frame.endswith(b">\n") or not frame.startswith(b"<"):
        raise ValueError("invalid envelope")
    parts = frame[1:-2].split(b"|")
    if len(parts) != 6 or parts[0] != b"v1":
        raise ValueError("invalid fields")
    prefix = b"|".join(parts[:5])
    try:
        kind = parts[1].decode("ascii")
        msg_id = int(parts[2])
        size = int(parts[3])
        crc = int(parts[5], 16)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("invalid numeric/header field") from exc
    escaped = parts[4].decode("ascii")
    if re.search(r"%(?![0-9A-Fa-f]{2})", escaped):
        raise ValueError("invalid escape")
    payload = unquote_to_bytes(escaped)
    if not re.fullmatch(r"[A-Z_]{2,24}", kind) or not 0 <= msg_id <= 0xFFFFFFFF:
        raise ValueError("invalid type or ID")
    if size > MAX_PAYLOAD or size != len(payload):
        raise ValueError("invalid length")
    if crc != crc16(prefix + b"|"):
        raise ValueError("checksum mismatch")
    try:
        payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("payload is not UTF-8") from exc
    return kind, msg_id, payload


class CommandLedger:
    """Minimal independent model: a repeated ID never starts a second action."""
    def __init__(self) -> None:
        self.jobs: dict[int, tuple[bytes, str]] = {}
        self.busy = False

    def accept(self, msg_id: int, payload: bytes) -> str:
        if msg_id in self.jobs:
            old_payload, phase = self.jobs[msg_id]
            return phase if old_payload == payload else "rejected:ID_CONFLICT"
        if self.busy:
            return "rejected:BUSY"
        self.jobs[msg_id] = (payload, "accepted")
        self.busy = True
        return "accepted"

    def finish(self, msg_id: int, result: str) -> None:
        payload, _ = self.jobs[msg_id]
        self.jobs[msg_id] = (payload, result)
        self.busy = False


class Heartbeat:
    def __init__(self, timeout_ms: int = 6000) -> None:
        self.timeout = timeout_ms
        self.last_ms: int | None = None

    def receive(self, now_ms: int) -> None:
        self.last_ms = now_ms

    def online(self, now_ms: int) -> bool:
        return self.last_ms is not None and 0 <= now_ms - self.last_ms <= self.timeout


def validate_feed(body: object) -> bool:
    if not isinstance(body, dict) or set(body) != {"grams"}:
        return False
    grams = body["grams"]
    return isinstance(grams, int) and not isinstance(grams, bool) and 5 <= grams <= 200


def validate_schedule(body: object) -> bool:
    if not isinstance(body, list) or len(body) != 4:
        return False
    seen: set[int] = set()
    for slot in body:
        if not isinstance(slot, dict) or set(slot) != {"i", "hh", "mm", "g", "en"}:
            return False
        i, hh, mm, grams, enabled = (slot[k] for k in ("i", "hh", "mm", "g", "en"))
        if any(not isinstance(n, int) or isinstance(n, bool) for n in (i, hh, mm, grams, enabled)):
            return False
        if i not in range(4) or i in seen or hh not in range(24) or mm not in range(60):
            return False
        if grams not in range(5, 201) or enabled not in (0, 1):
            return False
        seen.add(i)
    return seen == {0, 1, 2, 3}


def validate_telemetry(body: object) -> bool:
    if not isinstance(body, dict):
        return False
    required = {"ts", "valid", "age_ms", "t", "w", "hop", "st", "ir", "vis", "day", "gate"}
    if set(body) != required or not isinstance(body["ts"], str) or not isinstance(body["t"], str):
        return False
    if not isinstance(body["valid"], bool) or not isinstance(body["age_ms"], int) or body["age_ms"] < 0:
        return False
    if not isinstance(body["st"], str) or body["ir"] not in (0, 1) or body["gate"] not in (0, 1):
        return False
    return all(isinstance(body[k], (int, float)) and not isinstance(body[k], bool) for k in ("w", "hop", "vis", "day"))


def authorize(method: str, headers: dict[str, str], expected_key: str) -> bool:
    if method in {"GET", "HEAD", "OPTIONS"}:
        return True
    return headers.get("X-API-Key") == expected_key and bool(expected_key)


def simulated_feed_response(body: object, headers: dict[str, str], expected_key: str, wroom: str) -> tuple[int, dict[str, object]]:
    if not authorize("POST", headers, expected_key):
        return 401, {"error": "AUTH"}
    if not validate_feed(body):
        return 400, {"error": "INVALID"}
    if wroom.startswith("NAK:"):
        return 409, {"error": wroom[4:]}
    if wroom == "TIMEOUT":
        return 504, {"error": "ACK_TIMEOUT"}
    return 202, {"accepted": True, "id": 7, "stage": "wroom-accepted"}


def validate_sse_event(name: str, data: object) -> bool:
    if not isinstance(data, dict):
        return False
    if name == "telemetry":
        return validate_telemetry(data)
    if name == "command":
        return isinstance(data.get("id"), int) and data.get("phase") in {"queued", "delivered", "accepted", "started", "completed", "rejected", "failed", "aborted"}
    if name == "low_food":
        return isinstance(data.get("valid"), bool) and isinstance(data.get("pct"), (int, float))
    if name == "error":
        return isinstance(data.get("code"), str) and isinstance(data.get("message"), str)
    return name in {"status", "log", "pet"}


def propagate_device_error(msg_id: int, code: str) -> tuple[int, dict[str, object]]:
    """Model WROOM NAK → CAM HTTP body; frontend retains the returned ID/code."""
    return 409, {"id": msg_id, "error": code}


class CanonicalCodecTests(unittest.TestCase):
    def test_valid_frame_round_trip_and_reserved_characters(self) -> None:
        payload = b'{"text":"angle < and >, pipe |, percent % and newline\\n"}'
        self.assertEqual(decode_frame(encode_frame("FEED", 44, payload)), ("FEED", 44, payload))

    def test_bad_crc_truncated_oversize_and_bad_escape_rejected(self) -> None:
        good = encode_frame("FEED", 3, b'{"grams":20}')
        corrupt = good.replace(b"grams", b"gramx")
        for frame in (corrupt, good[:-2], b"<" + b"x" * MAX_FRAME):
            with self.assertRaises(ValueError):
                decode_frame(frame)
        with self.assertRaises(ValueError):
            decode_frame(b"<v1|FEED|3|1|%ZZ|0000>\n")

    def test_payload_and_header_limits(self) -> None:
        with self.assertRaises(ValueError):
            encode_frame("FEED", 1, b"x" * (MAX_PAYLOAD + 1))
        with self.assertRaises(ValueError):
            encode_frame("BAD|TYPE", 1)

    def test_feed_and_schedule_schema_boundaries(self) -> None:
        self.assertTrue(validate_feed({"grams": 5}))
        self.assertTrue(validate_feed({"grams": 200}))
        for body in ({"grams": 4}, {"grams": 201}, {"grams": 5.5}, {"grams": True}, {}, {"grams": 10, "extra": 1}, None):
            self.assertFalse(validate_feed(body))
        slots = [{"i": i, "hh": 8, "mm": i, "g": 50, "en": 1} for i in range(4)]
        self.assertTrue(validate_schedule(slots))
        self.assertFalse(validate_schedule(slots[:-1]))
        self.assertFalse(validate_schedule([*slots[:3], {**slots[3], "hh": 24}]))

    def test_request_id_duplicate_suppression_and_correlation(self) -> None:
        ledger = CommandLedger()
        self.assertEqual(ledger.accept(91, b"feed:20"), "accepted")
        self.assertEqual(ledger.accept(91, b"feed:20"), "accepted")
        self.assertEqual(ledger.accept(91, b"feed:50"), "rejected:ID_CONFLICT")
        self.assertEqual(ledger.accept(92, b"feed:20"), "rejected:BUSY")
        ledger.finish(91, "completed:OK")
        self.assertEqual(ledger.jobs[91][1], "completed:OK")
        self.assertEqual(ledger.accept(92, b"feed:20"), "accepted")

    def test_heartbeat_timeout_and_recovery(self) -> None:
        hb = Heartbeat()
        self.assertFalse(hb.online(100))
        hb.receive(100)
        self.assertTrue(hb.online(6100))
        self.assertFalse(hb.online(6101))
        hb.receive(7000)
        self.assertTrue(hb.online(7001))

    def test_schedule_replace_is_validated_as_a_complete_set(self) -> None:
        store: list[dict[str, int]] = []
        proposed = [{"i": i, "hh": 6 + i, "mm": 0, "g": 40, "en": 1} for i in range(4)]
        if validate_schedule(proposed):
            store = json.loads(json.dumps(proposed))
        self.assertEqual(store, proposed)
        invalid = [{**s} for s in proposed]
        invalid[2]["g"] = 999
        if validate_schedule(invalid):
            store = invalid
        self.assertEqual(store, proposed, "invalid replacement must not partially mutate persisted schedule")

    def test_telemetry_event_schema_and_staleness_are_explicit(self) -> None:
        sample = {"ts": "2026-10-15T12:00:00", "valid": True, "age_ms": 50, "t": "12:00:00", "w": 10.0, "hop": 70.0, "st": "IDLE", "ir": 0, "vis": 0, "day": 0.0, "gate": 0}
        self.assertTrue(validate_telemetry(sample))
        self.assertFalse(validate_telemetry({**sample, "valid": "yes"}))
        self.assertFalse(validate_telemetry({**sample, "age_ms": -1}))
        self.assertFalse(validate_telemetry({**sample, "w": "10"}))

    def test_http_feed_schema_auth_accept_reject_timeout_and_error_mapping(self) -> None:
        key = "fixture-only"
        self.assertEqual(simulated_feed_response({"grams": 20}, {}, key, "ACK")[0], 401)
        self.assertEqual(simulated_feed_response({"grams": 20}, {"X-API-Key": "wrong"}, key, "ACK")[0], 401)
        self.assertEqual(simulated_feed_response({"grams": 20}, {"X-API-Key": key}, key, "ACK")[0], 202)
        self.assertEqual(simulated_feed_response({"grams": 201}, {"X-API-Key": key}, key, "ACK")[0], 400)
        self.assertEqual(simulated_feed_response({"grams": 20}, {"X-API-Key": key}, key, "NAK:FAULT")[1]["error"], "FAULT")
        self.assertEqual(simulated_feed_response({"grams": 20}, {"X-API-Key": key}, key, "TIMEOUT")[0], 504)

    def test_sse_event_contract_accepts_valid_rejects_malformed(self) -> None:
        self.assertTrue(validate_sse_event("telemetry", {"ts": "t", "valid": True, "age_ms": 0, "t": "12:00:00", "w": 1, "hop": 50, "st": "IDLE", "ir": 0, "vis": 0, "day": 0, "gate": 0}))
        self.assertTrue(validate_sse_event("command", {"id": 5, "phase": "completed"}))
        self.assertTrue(validate_sse_event("error", {"code": "SENSOR", "message": "invalid"}))
        self.assertFalse(validate_sse_event("telemetry", {"w": 0}))
        self.assertFalse(validate_sse_event("command", {"phase": "completed"}))
        self.assertFalse(validate_sse_event("not-an-event", {}))

    def test_wroom_error_propagates_through_cam_contract_with_same_id(self) -> None:
        status, payload = propagate_device_error(122, "SENSOR")
        self.assertEqual(status, 409)
        self.assertEqual(payload, {"id": 122, "error": "SENSOR"})

    def test_rejection_and_terminal_result_keep_the_request_id(self) -> None:
        ledger = CommandLedger()
        self.assertEqual(ledger.accept(12, b"feed:20"), "accepted")
        self.assertEqual(ledger.accept(13, b"feed:20"), "rejected:BUSY")
        ledger.finish(12, "failed:SENSOR")
        terminal = {"id": 12, "phase": "failed", "error": "SENSOR"}
        self.assertEqual(terminal["id"], 12)
        self.assertEqual(ledger.jobs[12][1], "failed:SENSOR")


class CheckedInSourceCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cam = CAM_PATH.read_text(encoding="utf-8")
        cls.wroom = WROOM_PATH.read_text(encoding="utf-8")

    def test_all_cam_command_families_are_scanned_against_wroom_handlers(self) -> None:
        cam_commands = set(re.findall(r'sendUartCmd\("([A-Z_]+)(?::)?', self.cam))
        wroom_handlers = set(re.findall(r'msg\.startsWith\("([A-Z_]+:?)', self.wroom))
        wroom_handlers |= set(re.findall(r'msg\s*==\s*"([A-Z_]+)"', self.wroom))
        unhandled = {cmd for cmd in cam_commands if not any(cmd.rstrip(":") == h.rstrip(":") for h in wroom_handlers)}
        self.assertTrue({"ABORT", "CLEAR", "SCHED", "TARE", "CAL", "CFG"}.issubset(unhandled))
        self.assertIn("FEED", unhandled)

    def test_checked_in_wroom_lacks_telemetry_and_correlated_ack_producers(self) -> None:
        self.assertIsNone(re.search(r'(?i)(?:print|printf)\s*\(\s*"<TELEM:', self.wroom))
        self.assertIsNone(re.search(r'(?i)(?:print|printf)\s*\(\s*"<(?:ACK|NAK|COMMAND_EVENT):', self.wroom))
        self.assertRegex(self.wroom, r'printf\("<LOG:%\.1f>')


if __name__ == "__main__":
    unittest.main(verbosity=2)
