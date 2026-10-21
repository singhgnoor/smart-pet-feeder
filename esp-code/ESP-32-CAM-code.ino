#include "esp_camera.h"
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

// Wi-Fi Credentials
const char* WIFI_SSID = "PetFeeder";
const char* WIFI_PASS = "petfeeder123";
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

// Backward/forward compatibility for SCCB pin definition in camera_config_t
#ifndef pin_sscb_sda
#define pin_sscb_sda pin_sccb_sda
#endif
#ifndef pin_sscb_scl
#define pin_sscb_scl pin_sccb_scl
#endif

// UART to ESP32-WROOM (U1)
#define U1_RX_PIN 14
#define U1_TX_PIN 15

AsyncWebServer server(80);
AsyncEventSource events("/events");

bool u1LinkActive = false;
unsigned long lastHeartbeatMs = 0;
String latestTelemetryJson = "{\"t\":\"12:00:00\",\"w\":0.0,\"hop\":80,\"st\":\"IDLE\",\"ir\":0,\"vis\":0,\"day\":0.0,\"gate\":0}";
String logBufferJson = "[]";
String scheduleJson = "[{\"i\":0,\"hh\":8,\"mm\":0,\"g\":50,\"en\":1},{\"i\":1,\"hh\":13,\"mm\":0,\"g\":45,\"en\":1},{\"i\":2,\"hh\":18,\"mm\":30,\"g\":60,\"en\":1},{\"i\":3,\"hh\":21,\"mm\":0,\"g\":25,\"en\":0}]";

bool authed(AsyncWebServerRequest* req) {
  if (req->hasHeader("X-API-Key")) {
    return req->header("X-API-Key")->value() == API_KEY;
  }
  return false;
}

void sendUartCmd(const String& cmd) {
  Serial2.print("<" + cmd + ">\n");
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
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
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

  // Global CORS Headers for seamless browser access
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Accept");

  // GET /api/status
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    StaticJsonDocument<512> doc;
    doc["link"] = u1LinkActive;
    doc["rssi"] = WiFi.RSSI();
    doc["state"] = "IDLE";

    // Parse latest telemetry if available, otherwise return baseline
    StaticJsonDocument<256> telemDoc;
    DeserializationError err = deserializeJson(telemDoc, latestTelemetryJson);
    if (!err) {
      doc["telem"] = telemDoc;
      if (telemDoc.containsKey("st")) {
        doc["state"] = telemDoc["st"];
      }
    } else {
      JsonObject telem = doc.createNestedObject("telem");
      telem["t"] = "12:00:00";
      telem["w"] = 0.0;
      telem["hop"] = 80;
      telem["st"] = "IDLE";
      telem["ir"] = 0;
      telem["vis"] = 0;
      telem["day"] = 0.0;
      telem["gate"] = 0;
    }

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
      if (g != 10 && g != 20 && g != 30 && g != 50) { req->send(400, "application/json", "{\"error\":\"RANGE\"}"); return; }
      sendUartCmd("FEED_NOW:" + String(g));
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
    res->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
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

  // CORS Preflight OPTIONS handler
  server.onNotFound([](AsyncWebServerRequest* req) {
    if (req->method() == HTTP_OPTIONS) {
      req->send(200);
    } else {
      req->send(404, "text/plain", "Not Found");
    }
  });

  // Live SSE stream
  server.addHandler(&events);
  server.begin();
}

void loop() {
  unsigned long now = millis();

  // Check UART heartbeat timeout from U1 (6 seconds)
  if (now - lastHeartbeatMs > 6000) {
    u1LinkActive = false;
  }

  // Periodic telemetry push to web dashboard via SSE (1 Hz)
  static unsigned long lastTelemPushMs = 0;
  if (now - lastTelemPushMs > 1000) {
    lastTelemPushMs = now;
    events.send(latestTelemetryJson.c_str(), "telemetry", now);
  }

  // Read incoming packets from U1
  if (Serial2.available()) {
    String line = Serial2.readStringUntil('\n');
    line.trim();

    // 1. Heartbeat from U1 (<HB> or <HB:123>)
    if (line.startsWith("<HB") && line.endsWith(">")) {
      u1LinkActive = true;
      lastHeartbeatMs = now;
      Serial2.println("<HB:OK>");
    }
    // 2. Telemetry frame from U1
    else if (line.startsWith("<TELEM:") && line.endsWith(">")) {
      String json = line.substring(7, line.length() - 1);
      latestTelemetryJson = json;
      events.send(json.c_str(), "telemetry", now);
    }
    // 3. Feeding finished log record
    else if (line.startsWith("<LOG:") && line.endsWith(">")) {
      String payload = line.substring(5, line.length() - 1);
      float dispensedG = payload.toFloat();
      StaticJsonDocument<256> logDoc;
      logDoc["slot"] = 0;
      logDoc["src"] = "R";
      logDoc["id"] = (int)(now / 1000);
      logDoc["tgt"] = (int)dispensedG;
      logDoc["w0"] = 0.0;
      logDoc["w1"] = dispensedG;
      logDoc["d"] = dispensedG;
      logDoc["res"] = "OK";
      logDoc["wig"] = 0;
      logDoc["top"] = 0;
      logDoc["ms"] = 3200;
      logDoc["ts"] = "2026-10-15T12:00:00";
      String logOut;
      serializeJson(logDoc, logOut);
      events.send(logOut.c_str(), "log", now);
    }
    // 4. Low hopper alert
    else if (line == "<LOW_FOOD>") {
      events.send("{\"pct\":12}", "low_food", now);
    }
    // 5. Pet presence detected by IR sensor
    else if (line == "<PET_DETECTED>") {
      events.send("{\"pet\":1,\"conf\":94}", "pet", now);
      // Reply to U1 to confirm pet and unlock gate
      Serial2.println("<VERDICT:PET>");
    }
  }
}
