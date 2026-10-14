/*
 * Smart Pet Feeder V2.1 - Vision & Web Hub (ESP32-CAM)
 * 
 * This is the "brain" for the cloud and AI side. It runs on the ESP32-CAM (U2).
 * It handles Wi-Fi, serves the web dashboard via LittleFS, and runs a TinyML 
 * (Edge Impulse) model to detect the pet. 
 * 
 * It communicates with the Sensor Hub (U1) via UART1 on Pins 13 & 14.
 * Uses FreeRTOS to offload heavy AI camera processing to Core 1 so the 
 * web server and UART bridge never freeze.
 */

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <esp_camera.h>
#include <ArduinoJson.h>

// Uncomment when you export your Edge Impulse Arduino library:
// #include <pet_classifier_inferencing.h>

// --- UART & CAMERA PINS (AI-Thinker Model) ---
const int PIN_RX1 = 13;
const int PIN_TX1 = 14;

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

// --- GLOBALS ---
AsyncWebServer server(80);
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// System State
bool apOn = false;
bool timeSynced = false;
bool linkUp = false;
uint32_t lastWifiTry = 0;
uint32_t lastSync = 0;
uint32_t lastHbRx = 0;
uint32_t lastHbTx = 0;

// FreeRTOS Queue to trigger AI Task without blocking the main loop
QueueHandle_t qAiReq;

// Global JPEG double buffer for the web dashboard stream
camera_fb_t* latest_fb = NULL;

// --- FREERTOS AI TASK (Runs on Core 1) ---
void aiTask(void *pvParameters) {
  while (true) {
    int triggerCommand;
    // Block until a <PET_DETECTED> UART command sends a trigger to this queue
    if (xQueueReceive(qAiReq, &triggerCommand, portMAX_DELAY)) {
      Serial.println("AI Task: Pet suspected by IR. Capturing frames...");
      
      int petVotes = 0;
      float highestConf = 0.0;
      
      // 2-of-3 Temporal Voting Algorithm
      // Take 3 photos, 250ms apart. At least 2 must confidently have a pet.
      for (int i = 0; i < 3; i++) {
        camera_fb_t *fb = esp_camera_fb_get();
        if (!fb) {
          Serial.println("Camera capture failed");
          continue;
        }

        // Update the global JPEG for the Web UI (free the old one)
        if (latest_fb) esp_camera_fb_return(latest_fb);
        latest_fb = fb; // Keep hold of this for /api/snapshot.jpg
        
        // =========================================================
        // TINYML INFERENCE BLOCK (Pseudocode for Edge Impulse)
        // 1. Resize/Crop fb->buf (320x240 JPEG) to 96x96 RGB888 array
        // 2. Run signal_t through run_classifier(&signal, &result)
        // 3. if (result.classification[PET_INDEX].value > 0.75) petVotes++;
        // =========================================================
        
        // For right now, we simulate a positive AI detection:
        petVotes++; 
        highestConf = 0.85;

        vTaskDelay(250 / portTICK_PERIOD_MS); // Wait 250ms before next frame
      }

      // Send the verdict back to U1
      if (petVotes >= 2) {
        Serial.printf("AI Verdict: PET CONFIRMED (Conf: %.2f). Unlocking gate.\n", highestConf);
        Serial1.println("<VERDICT:PET,0.85>");
      } else {
        Serial.println("AI Verdict: FALSE ALARM. Ignoring.");
        Serial1.println("<VERDICT:NONE,0.0>");
      }
    }
  }
}

// --- SETUP ---
void setup() {
  Serial.begin(115200); // Debug (USB)
  Serial1.begin(115200, SERIAL_8N1, PIN_RX1, PIN_TX1); // UART Bridge to U1
  
  Serial.println("Starting Vision Hub (U2)...");

  // Init LittleFS
  if(!LittleFS.begin(true)){
    Serial.println("LittleFS Mount Failed");
    return;
  }

  // Init Camera
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  // FRAMESIZE_QVGA (320x240) is perfect: low memory, good enough for AI & Web
  config.frame_size = FRAMESIZE_QVGA; 
  config.jpeg_quality = 12;
  config.fb_count = 2; // Double buffering for speed

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("Camera init failed!");
  }

  // Start Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  // Setup FreeRTOS Queue & Task for AI
  qAiReq = xQueueCreate(5, sizeof(int));
  xTaskCreatePinnedToCore(
    aiTask,         // Task function
    "AI_Task",      // Name
    8192,           // Stack size (Edge impulse needs ~8k-10k)
    NULL,           // Parameters
    1,              // Priority
    NULL,           // Handle
    1               // Pin to Core 1 (Core 0 handles WiFi/System)
  );

  // --- WEB SERVER ROUTES ---
  
  // 1. Serve frontend UI
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  // 2. Manual Feed API
  server.on("/api/feed", HTTP_POST, [](AsyncWebServerRequest *request){
    if (!linkUp) {
      request->send(503, "text/plain", "Error: Link to Sensor Hub is DOWN.");
      return;
    }
    // Generate an ID for idempotency, tell U1 to feed 50g
    uint32_t feedId = millis();
    Serial1.printf("<FEED_NOW:50,%lu>\n", feedId);
    request->send(200, "text/plain", "Feed requested");
  });

  // 3. Configuration API (Updated with daily_g fix)
  server.on("/api/config", HTTP_POST, [](AsyncWebServerRequest *request){}, NULL, 
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total){
      DynamicJsonDocument doc(512);
      deserializeJson(doc, (const char*)data);
      
      // Forward configs to U1 over UART
      if (doc["leftover_g"].is<float>())   Serial1.printf("<CFG:leftover=%.1f>\n", (float)doc["leftover_g"]);
      if (doc["daily_g"].is<float>())      Serial1.printf("<CFG:daily=%.1f>\n", (float)doc["daily_g"]);
      if (doc["require_pet"].is<bool>())   Serial1.printf("<CFG:reqPet=%d>\n", doc["require_pet"] ? 1 : 0);
      
      request->send(200, "text/plain", "Config updated");
  });

  // 4. JPEG Snapshot API
  server.on("/api/snapshot.jpg", HTTP_GET, [](AsyncWebServerRequest *request){
    if (latest_fb) {
      // Send the JPEG currently held in memory
      AsyncWebServerResponse *response = request->beginResponse_P(200, "image/jpeg", latest_fb->buf, latest_fb->len);
      request->send(response);
    } else {
      request->send(503, "text/plain", "No image available yet");
    }
  });

  server.begin();
  Serial.println("Web server started.");
}

// --- MAIN LOOP (Runs on Core 0) ---
void loop() {
  unsigned long now = millis();

  // 1. UART Bridge (Read from U1)
  while (Serial1.available()) {
    String msg = Serial1.readStringUntil('\n');
    msg.trim();
    if (msg.startsWith("<") && msg.endsWith(">")) {
      msg = msg.substring(1, msg.length() - 1);
      
      if (msg.startsWith("HB:")) {
        lastHbRx = now;
        linkUp = true;
      }
      else if (msg == "LOW_FOOD") {
        Serial.println("U1 reports: LOW FOOD!");
        // (Optional: send push notification via Pushbullet/Telegram here)
      }
      else if (msg == "PET_DETECTED") {
        // IR sensor tripped! Wake up the AI Task to check the camera
        int trigger = 1;
        xQueueSend(qAiReq, &trigger, 0); 
      }
      else if (msg.startsWith("LOG:")) {
        // U1 just finished a feed. Append to log file.
        String amount = msg.substring(4);
        appendLog(amount.toFloat());
      }
    }
  }

  // 2. Send UART Heartbeat
  if (now - lastHbTx > 2000) {
    lastHbTx = now;
    Serial1.printf("<HB:%lu>\n", millis() / 1000);
  }

  // 3. Link Failure Detection
  if (now - lastHbRx > 6000) {
    linkUp = false;
  }
}

// --- UTILITIES ---

void appendLog(float amountGrams) {
  // Fix: Log Rotation! Prevent filling up the 1MB LittleFS partition.
  File file = LittleFS.open("/log.ndjson", FILE_READ);
  if (file && file.size() > 100000) { // 100 KB limit
    file.close();
    Serial.println("Log file > 100kB. Rotating...");
    LittleFS.remove("/log.old");
    LittleFS.rename("/log.ndjson", "/log.old");
  } else if (file) {
    file.close();
  }

  // Append new record
  file = LittleFS.open("/log.ndjson", FILE_APPEND);
  if (!file) return;

  DynamicJsonDocument doc(128);
  doc["timestamp"] = millis(); // Usually sync this with NTP in prod
  doc["dispensed_g"] = amountGrams;
  
  String output;
  serializeJson(doc, output);
  file.println(output);
  file.close();
  
  Serial.println("Feed logged to LittleFS.");
}
