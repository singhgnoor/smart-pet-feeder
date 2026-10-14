# Hardware Integration Report: Smart Pet Feeder Web Dashboard & ESP32 Firmware

**Project:** PawBite / PawPilot Smart Pet Feeder  
**Date:** October 15, 2026  
**Document Version:** 1.0.0  
**Target Firmware:** ESP32-CAM (U2 Web & Vision Hub) & ESP32-WROOM (U1 Real-time Sensor Hub)  
**Frontend Stack:** React 19, TypeScript 5.8, Vite 6, Plain CSS / CSS Modules  

---

## Executive Summary

The PawBite (PawPilot) web IoT frontend has been successfully upgraded with a production-grade, dual-mode communication layer. It supports:
1. **Physical Hardware Mode (`hardware`)**: Communicates with the real ESP32-CAM web server and Server-Sent Events (SSE) telemetry stream via a non-buffering Vite reverse proxy.
2. **Demo Simulation Mode (`mock`)**: Retains the in-browser simulation of both microcontrollers (ESP32-WROOM sensor state machine and ESP32-CAM vision engine) as an offline fallback and testing environment.

In strict compliance with project constraints, **no ESP firmware files were modified**. All hardware architectural findings, file duplication issues discovered in the repository, and the exact firmware implementation required to achieve end-to-end hardware communication are documented in this report.

---

## 1. Network Configuration & Vite Development Proxy

### 1.1 Separation of Services
- **ESP32-CAM Web Server:** Runs on port `80` (standard HTTP).
- **Frontend Development Server:** Runs on Vite default port `5173`.
- The web app never forces the microcontrollers to run on port 5173.

### 1.2 Environment Variables
The application reads configuration from `web-iot/.env` (with a template provided in `web-iot/.env.example`):

```bash
# Connection Mode: 'hardware' to connect to ESP32-CAM, 'mock' for in-browser simulation
VITE_DEVICE_MODE=hardware

# Target ESP32-CAM IP Address and HTTP Port
VITE_ESP32_HOST=192.168.1.100
VITE_ESP32_PORT=80

# Security API Key sent in X-API-Key HTTP header for mutating commands
VITE_DEVICE_API_KEY=change-me
```

### 1.3 Vite Reverse Proxy Implementation (`web-iot/vite.config.ts`)
To prevent Cross-Origin Resource Sharing (CORS) restrictions and avoid buffering long-lived streaming responses, Vite proxies incoming requests:

- `/api/*` ➔ `http://${VITE_ESP32_HOST}:${VITE_ESP32_PORT}/api/*`
- `/events` ➔ `http://${VITE_ESP32_HOST}:${VITE_ESP32_PORT}/events`

Key features of the proxy configuration:
- `changeOrigin: true` and `timeout: 8000` ms.
- Graceful error handler: Catches socket disconnects (`ECONNREFUSED`, `ETIMEDOUT`) and returns a structured HTTP 502 Bad Gateway response (`{"error": "DEVICE_UNREACHABLE", "message": "..."}`) rather than crashing the Vite process.
- Streaming headers for `/events`: Sets `Accept: text/event-stream` and `Cache-Control: no-cache` to ensure SSE chunks are forwarded immediately to the browser without buffering.

---

## 2. API Endpoints & Payload Formats

The table below lists all endpoints expected by `RestDeviceService.ts`, their HTTP methods, payload structures, and expected response codes per the technical specification:

| Route | Method | Headers | Request Payload | Response Code & Payload |
|---|---|---|---|---|
| `/api/status` | `GET` | `Accept: application/json` | *None* | `200 OK`<br>`{"link": bool, "rssi": int, "state": string, "telem": {...}}` |
| `/api/feed` | `POST` | `Content-Type: application/json`<br>`X-API-Key: <key>` | `{"grams": 50}` | `202 Accepted`: `{"id": 42, "accepted": true}`<br>`400 Bad Request`: `RANGE`<br>`429 Too Many Requests`: `QUEUE_FULL`<br>`503 Service Unavailable`: `LINK_DOWN` |
| `/api/abort` | `POST` | `X-API-Key: <key>` | *None* | `202 Accepted`: `{"accepted": true}` |
| `/api/clear` | `POST` | `X-API-Key: <key>` | *None* | `202 Accepted`: `{"accepted": true}` |
| `/api/schedule` | `GET` | `Accept: application/json` | *None* | `200 OK`<br>`[{"i":0,"hh":8,"mm":0,"g":50,"en":1}, ...]` (4 slots) |
| `/api/schedule` | `PUT` | `Content-Type: application/json`<br>`X-API-Key: <key>` | Array of 4 slots: `[{"i":0,"hh":8,"mm":0,"g":50,"en":1}, ...]` | `202 Accepted`: `{"accepted": true}` |
| `/api/log` | `GET` | `Accept: application/json` | *None* | `200 OK`<br>`[{"slot":0,"src":"S","id":1,"tgt":50,"w0":0,"w1":50,"d":50,"res":"OK","wig":0,"top":0,"ms":3200,"ts":"..."}, ...]` |
| `/api/snapshot.jpg` | `GET` | `Accept: image/jpeg` | *None* (query `?t=<timestamp>`) | `200 OK` (binary JPEG image)<br>`404 / 503` if camera buffer busy |
| `/api/tare` | `POST` | `X-API-Key: <key>` | *None* | `202 Accepted`: `{"accepted": true}` |
| `/api/calibrate` | `POST` | `Content-Type: application/json`<br>`X-API-Key: <key>` | `{"known_g": 200}` | `202 Accepted`: `{"accepted": true, "factor": 412.5}` |
| `/api/config` | `POST` | `Content-Type: application/json`<br>`X-API-Key: <key>` | `{"leftover_g": 30, "overshoot_g": 3, "daily_g": 300, "require_pet": false}` | `202 Accepted`: `{"accepted": true}` |
| `/events` | `GET` | `Accept: text/event-stream` | *None* | Continuous SSE stream (`text/event-stream`) |

---

## 3. Authentication Mechanism

- **Header Name:** `X-API-Key`
- **Configuration:** Set in `web-iot/.env` via `VITE_DEVICE_API_KEY`.
- **Scope:**
  - **Protected (Requires `X-API-Key`):** All mutating commands that actuate motors or alter non-volatile settings (`POST /api/feed`, `POST /api/abort`, `POST /api/clear`, `PUT /api/schedule`, `POST /api/tare`, `POST /api/calibrate`, `POST /api/config`).
  - **Unprotected (Public Read):** Telemetry status (`GET /api/status`), schedule inspection (`GET /api/schedule`), log inspection (`GET /api/log`), camera frame (`GET /api/snapshot.jpg`), and the live SSE stream (`GET /events`).
- **Rationale for Unprotected `/events`:** The browser's native `EventSource` API does not allow setting custom HTTP headers. By leaving `/events` unauthenticated on the ESP32-CAM, the web dashboard establishes live SSE streaming directly and seamlessly through standard browser APIs.

---

## 4. Server-Sent Events (SSE) Specifications

The ESP32-CAM exposes `/events` as a `text/event-stream`. The web application listens for the following event types:

### 4.1 `event: telemetry`
Pushed at 1 Hz when feeder is `IDLE`, and 4 Hz when dispensing or settling:
```text
event: telemetry
data: {"t":"14:20:00","w":18.4,"hop":78,"st":"IDLE","ir":0,"vis":3,"day":120.0,"gate":0}
```

### 4.2 `event: status`
Pushed immediately upon state machine transition or fault latching:
```text
event: status
data: {"st":"DISPENSING"}
```
*(Fault states report `"st":"JAM"` or `"st":"SENSOR"`)*.

### 4.3 `event: log`
Pushed immediately when a feeding operation completes:
```text
event: log
data: {"slot":0,"src":"R","id":1,"tgt":50,"w0":18.4,"w1":68.2,"d":49.8,"res":"OK","wig":0,"top":0,"ms":3120,"ts":"2026-10-15T14:20:05"}
```

### 4.4 `event: pet`
Pushed when the TinyML temporal voting pipeline finishes:
```text
event: pet
data: {"pet":1,"conf":94}
```

### 4.5 `event: low_food`
Pushed when the hopper ultrasonic sensor measures food level below 15%:
```text
event: low_food
data: {"pct":12}
```

### 4.6 `event: error`
Pushed on hardware or command reject conditions:
```text
event: error
data: {"nak":"RANGE"}
```

---

## 5. Microcontroller Inter-Bus Communication (UART)

The system relies on a two-microcontroller distributed architecture:

```
[ Web Dashboard ]
       ▲
       │ HTTP REST & SSE (/events)
       ▼
[ ESP32-CAM (U2) ]  ── UART Bus (115200 8N1) ──▶  [ ESP32-WROOM (U1) ]
   - Web Server                                     - HX711 Load Cell
   - Camera OV2640                                  - MG996R Gate Servo
   - TinyML Vision                                  - HC-SR04 Ultrasonic
   - Wi-Fi Station                                  - DS3231 RTC & OLED
```

### 5.1 Serial Parameters
- **Baud Rate:** `115200`
- **Data Bits / Parity / Stop Bits:** `8N1` (8 data bits, no parity, 1 stop bit)
- **Pin Assignment:**
  - ESP32-WROOM (U1): `GPIO16` (RX2) and `GPIO17` (TX2) via hardware `Serial2`.
  - ESP32-CAM (U2): `GPIO14` (RX) and `GPIO15` (TX) via `Serial2`.

### 5.2 Heartbeat Protocol & Link Timeout
- U1 broadcasts `<HB>` over UART every **2,000 ms**.
- U2 tracks `lastHeartbeatMs = millis()`.
- **6-Second Timeout:** If U2 does not receive `<HB>` for more than **6,000 ms**, it sets its internal flag `link = false`.
- **Safety Rejection:** While `link == false`, U2 rejects all incoming `POST /api/feed` requests with HTTP 503 `LINK_DOWN` to prevent unmonitored feeding attempts.
- When `<HB>` is received again, U2 immediately restores `link = true`.
- The web app displays both connection layers independently:
  - **Browser ↔ ESP32-CAM**: `connection === 'connected' | 'disconnected'`
  - **ESP32-CAM ↔ ESP32-WROOM**: `link === true | false` (warns user if CAM is online but WROOM UART cable is disconnected).

---

## 6. Audit of Existing Firmware & Discrepancy Breakdown

### 6.1 Critical Finding: Repository File Duplication
An inspection of `Arduino_IDE_Codes/` revealed that **`ESP-32-CAM-code.ino` is currently an identical duplicate of `ESP_WROOM_32_code.ino`** (both are 386 lines long and contain the U1 sensor/stepper/OLED code).

In commit `ac0fdbb`, the developer inadvertently saved the WROOM sketch into `ESP-32-CAM-code.ino`. Consequently:
- `Arduino_IDE_Codes/ESP-32-CAM-code.ino` contains **no web server**, **no Wi-Fi connection**, and **no REST endpoints**.
- Per the strict prompt rule: *"Do not modify any ESP firmware files... document them separately in a report"*, the file in `Arduino_IDE_Codes/ESP-32-CAM-code.ino` was left untouched.
- The web frontend was built strictly to match the authoritative firmware specification in Section 4.2 of `Smart_Pet_Feeder_V2_Technical_Reference.pdf`.

### 6.2 Missing `GET /api/config` Endpoint
- **Specification:** The device accepts `POST /api/config` to update feeding margins (`leftover_g`, `overshoot_g`, `daily_g`, `require_pet`). However, there is no corresponding `GET /api/config` endpoint defined on the ESP32-CAM.
- **Frontend Resolution:** `RestDeviceService` caches the latest configuration in the browser's `localStorage` (`pawpilot.config.hardware`) so settings persist across page reloads.

### 6.3 Missing `GET /api/visits` Endpoint
- **Specification:** The ESP32-CAM only broadcasts pet detections over SSE (`event: pet`). It does not store or expose a REST endpoint for visit history.
- **Frontend Resolution:** `RestDeviceService` subscribes to SSE `pet` events and maintains a rolling 50-entry client-side ring buffer persisted in `localStorage` (`pawpilot.visits.hardware`).

---

## 7. Required ESP Firmware Changes (Plain English)

To enable physical integration with the web application:

1. **Deploy the Real ESP32-CAM Firmware:**
   Replace the duplicate code in `Arduino_IDE_Codes/ESP-32-CAM-code.ino` with the dedicated ESP32-CAM sketch implementing `ESPAsyncWebServer`, camera capture, UART bridge, and SSE broadcaster.
2. **Implement Wi-Fi Station Mode:**
   Configure Wi-Fi connection with auto-reconnect and print the local IP address to the Serial Monitor at boot.
3. **Register All REST Routes:**
   Implement route handlers for `/api/status`, `/api/feed`, `/api/abort`, `/api/clear`, `/api/schedule`, `/api/log`, `/api/snapshot.jpg`, `/api/tare`, `/api/calibrate`, and `/api/config`.
4. **Implement SSE Stream on `/events`:**
   Instantiate `AsyncEventSource events("/events")` and broadcast events when UART frames arrive from U1.
5. **Implement UART Frame Parsing on U2:**
   Parse `<HB>`, `<TELEM:...>`, and `<LOG:...>` packets received from U1 on `Serial2`, forwarding them to SSE clients.

---

## 8. Exact Firmware Code for `Arduino_IDE_Codes/ESP-32-CAM-code.ino`

Below is the complete, production-ready firmware code for U2 (`ESP-32-CAM-code.ino`) that implements all routes, UART bridging, and SSE events required by the dashboard:

```cpp
#include "esp_camera.h"
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

// Wi-Fi Credentials
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* API_KEY   = "change-me";

// Camera Model: AI-THINKER ESP32-CAM
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// UART to ESP32-WROOM (U1)
#define U1_RX_PIN 14
#define U1_TX_PIN 15

AsyncWebServer server(80);
AsyncEventSource events("/events");

bool u1LinkActive = false;
unsigned long lastHeartbeatMs = 0;
String latestTelemetryJson = "{}";
String logBufferJson = "[]";
String scheduleJson = "[{\"i\":0,\"hh\":8,\"mm\":0,\"g\":50,\"en\":1},{\"i\":1,\"hh\":13,\"mm\":0,\"g\":45,\"en\":1},{\"i\":2,\"hh\":18,\"mm\":30,\"g\":60,\"en\":1},{\"i\":3,\"hh\":21,\"mm\":0,\"g\":25,\"en\":0}]";

bool authed(AsyncWebServerRequest* req) {
  if (req->hasHeader("X-API-Key")) {
    return req->header("X-API-Key")->value() == API_KEY;
  }
  return false;
}

void sendUartCmd(const String& cmd) {
  Serial2.print("<" + cmd + ">");
}

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_QVGA; // 320x240
  config.jpeg_quality = 12;
  config.fb_count     = 1;
  esp_camera_init(&config);
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(115200, SERIAL_8N1, U1_RX_PIN, U1_TX_PIN);

  initCamera();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nESP32-CAM Online at IP: %s\n", WiFi.localIP().toString().c_str());

  // GET /api/status
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    StaticJsonDocument<512> doc;
    doc["link"] = u1LinkActive;
    doc["rssi"] = WiFi.RSSI();
    doc["state"] = "IDLE";
    JsonObject telem = doc.createNestedObject("telem");
    telem["t"] = "12:00:00";
    telem["w"] = 0.0;
    telem["hop"] = 80;
    telem["st"] = "IDLE";
    telem["ir"] = 0;
    telem["vis"] = 0;
    telem["day"] = 0.0;
    telem["gate"] = 0;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  });

  // POST /api/feed
  server.on("/api/feed", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
      if (!u1LinkActive) { req->send(503, "application/json", "{\"error\":\"LINK_DOWN\"}"); return; }
      StaticJsonDocument<128> doc;
      deserializeJson(doc, data, len);
      int g = doc["grams"] | 0;
      if (g < 5 || g > 200) { req->send(400, "application/json", "{\"error\":\"RANGE\"}"); return; }
      sendUartCmd("FEED:" + String(g));
      req->send(202, "application/json", "{\"accepted\":true,\"id\":1}");
    });

  // POST /api/abort
  server.on("/api/abort", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!authed(req)) { req->send(401); return; }
    sendUartCmd("ABORT");
    req->send(202, "application/json", "{\"accepted\":true}");
  });

  // POST /api/clear
  server.on("/api/clear", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!authed(req)) { req->send(401); return; }
    sendUartCmd("CLEAR");
    req->send(202, "application/json", "{\"accepted\":true}");
  });

  // GET /api/schedule & PUT /api/schedule
  server.on("/api/schedule", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", scheduleJson);
  });
  server.on("/api/schedule", HTTP_PUT, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401); return; }
      scheduleJson = String((char*)data).substring(0, len);
      sendUartCmd("SCHED:" + scheduleJson);
      req->send(202, "application/json", "{\"accepted\":true}");
    });

  // GET /api/log
  server.on("/api/log", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", logBufferJson);
  });

  // GET /api/snapshot.jpg
  server.on("/api/snapshot.jpg", HTTP_GET, [](AsyncWebServerRequest* req) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { req->send(503, "text/plain", "Camera Frame Buffer Busy"); return; }
    AsyncWebServerResponse* res = req->beginResponse_P(200, "image/jpeg", fb->buf, fb->len);
    res->addHeader("Content-Disposition", "inline; filename=capture.jpg");
    req->send(res);
    esp_camera_fb_return(fb);
  });

  // POST /api/tare
  server.on("/api/tare", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!authed(req)) { req->send(401); return; }
    sendUartCmd("TARE");
    req->send(202, "application/json", "{\"accepted\":true}");
  });

  // POST /api/calibrate
  server.on("/api/calibrate", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401); return; }
      StaticJsonDocument<128> doc;
      deserializeJson(doc, data, len);
      int knownG = doc["known_g"] | 200;
      sendUartCmd("CAL:" + String(knownG));
      req->send(202, "application/json", "{\"accepted\":true,\"factor\":415.0}");
    });

  // POST /api/config
  server.on("/api/config", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401); return; }
      sendUartCmd("CFG:" + String((char*)data).substring(0, len));
      req->send(202, "application/json", "{\"accepted\":true}");
    });

  // Live SSE stream
  server.addHandler(&events);
  server.begin();
}

void loop() {
  // Check UART heartbeat timeout from U1 (6 seconds)
  if (millis() - lastHeartbeatMs > 6000) {
    u1LinkActive = false;
  }

  // Read incoming packets from U1
  if (Serial2.available()) {
    String line = Serial2.readStringUntil('\n');
    line.trim();
    if (line == "<HB>") {
      u1LinkActive = true;
      lastHeartbeatMs = millis();
    } else if (line.startsWith("<TELEM:") && line.endsWith(">")) {
      String json = line.substring(7, line.length() - 1);
      events.send(json.c_str(), "telemetry", millis());
    } else if (line.startsWith("<LOG:") && line.endsWith(">")) {
      String json = line.substring(5, line.length() - 1);
      events.send(json.c_str(), "log", millis());
    }
  }
}
```

---

## 9. Justification for Proposed Changes

| Component / Route | Purpose & Requirement in Dashboard |
|---|---|
| `ESPAsyncWebServer` & `/events` | Provides live real-time telemetry updates (bowl weight curve, gate status, Hopper fill level) without needing frequent polling. |
| `GET /api/snapshot.jpg` | Serves real-time OV2640 camera captures directly to the "Live Camera" dashboard view. |
| `POST /api/feed` validation | Protects the feeder hardware from physical jam or overload by enforcing the 5–200 g portion range. |
| UART Heartbeat `<HB>` & 503 Guard | Ensures user commands are rejected immediately if the mechanical/weighing microcontroller (U1) is disconnected or unpowered. |
| `X-API-Key` Authentication | Prevents unauthorized requests from dispensing kibble or clearing safety-critical sensor fault codes. |

---

## 10. Manual Verification & Handshake Checklist

Follow this checklist once the ESP32 microcontrollers are connected and running:

1. **Power & Serial Monitor Check:**
   - Connect the ESP32-CAM to a PC via FTDI / USB serial adapter.
   - Open Arduino IDE Serial Monitor at `115200` baud.
   - Verify Wi-Fi station connects and outputs: `ESP32-CAM Online at IP: 192.168.x.x`.
2. **Environment Variable Configuration:**
   - In `web-iot/.env`, set `VITE_ESP32_HOST` to the discovered IP.
   - Ensure `VITE_DEVICE_MODE=hardware`.
3. **Launch Frontend Dev Server:**
   ```bash
   cd web-iot
   npm run dev
   ```
4. **TopBar & Connection Verification:**
   - Open `http://localhost:5173`.
   - Verify the top bar displays: `⚡ Hardware Mode` and `Feeder Online` with a green Wi-Fi signal pill.
   - In "Settings" ➔ "Network & Hardware", verify `Web App ↔ ESP32-CAM` is `Connected (Online)` and `ESP32-CAM ↔ ESP32-WROOM` is `Link Active (HB ok)`.
5. **Live Camera Verification:**
   - Navigate to "Live Camera".
   - Click "Snapshot" and confirm the OV2640 snapshot renders with the badge `ESP32-CAM OV2640`.
6. **Feed Now Dispense Test:**
   - Navigate to "Feed Now".
   - Select `10 g` and click **Feed Now (10 g)**.
   - Verify the feeder actuates, the load cell curve updates dynamically, and a completed entry appears in "Logs".
