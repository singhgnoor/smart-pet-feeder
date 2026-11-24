/*
 * Smart Pet Feeder V2.1 - ESP32-S Sensor Hub (Offline Controller)
 * Pinout matches TL_CIRCUIT_V2.1.pdf (unchanged).
 */

#include <Wire.h>
#include <SPI.h>
#include <U8g2lib.h>
#include <HX711.h>
#include <ESP32Servo.h>
#include <RTClib.h>
#include <Preferences.h>
#include <ArduinoJson.h>

// SPI OLED (7-Pin)
const int PIN_OLED_DIN = 23;
const int PIN_OLED_CLK = 19;
const int PIN_OLED_DC  = 4;
const int PIN_OLED_RES = 32;
const int PIN_OLED_CS  = 13;

// I2C RTC (DS3231)
const int PIN_I2C_SDA = 21;
const int PIN_I2C_SCL = 22;

// Load Cell (XFW-HX711)
const int PIN_HX_DT  = 25;
const int PIN_HX_SCK = 26;

// Ultrasonic (HC-SR04)
const int PIN_US_TRIG = 27;
const int PIN_US_ECHO = 34;

// IR Sensor & Servo
const int PIN_IR_OUT = 33;
const int PIN_SERVO  = 18;

// UART2 to ESP32-CAM (TX2 -> CAM RX1 IO13, RX2 <- CAM TX1 IO14)
const int PIN_TX2 = 17;
const int PIN_RX2 = 16;
const uint32_t UART_BAUD = 9600;

// Servo angles: moves by 10 degrees from closed to open
const int SERVO_CLOSED_DEG = 10;
const int SERVO_OPEN_DEG   = 20;

const int MAX_LOGS = 20;

U8G2_SSD1306_128X64_NONAME_F_4W_SW_SPI oled(
  U8G2_R0, PIN_OLED_CLK, PIN_OLED_DIN, PIN_OLED_CS, PIN_OLED_DC, PIN_OLED_RES
);
RTC_DS3231 rtc;
HX711 scale;
Servo gate;
Preferences prefs;

enum FeederState {
  ST_IDLE,
  ST_PRECHECK,
  ST_WAIT_PET,
  ST_DISPENSE,
  ST_WIGGLE,
  ST_SETTLE,
  ST_TOPUP,
  ST_REPORT,
  ST_FAULT
};

struct ScheduleSlot {
  int hh;
  int mm;
  int grams;
  bool enabled;
  int lastDayRun;
};

FeederState currentState = ST_IDLE;
bool rtcReady = false;
bool hxReady  = false;

// Live sensor state
float currentWeightGrams = 0.0f;
float targetGrams        = 0.0f;
float bowlStartWeight    = 0.0f;
int   hopperPercent      = 100;
bool  irDetected         = false;
bool  isLinked           = false;
int   petVisitsToday     = 0;

// Active feed metadata
char          activeSrc        = 'I'; // 'I' = IR, 'R' = Remote/Manual, 'S' = Scheduled
int           activeSlot       = -1;
bool          activeForce      = false;
uint32_t      feedSeqId        = 0;
unsigned long feedStartMs      = 0;
int           activeWiggles    = 0;
int           activeTopups     = 0;
String        activeResult     = "OK";

// Persistent counters & cooldown tracking
float    dayGramsDispensed = 0.0f;
int      currentDayKey     = 0;
uint32_t lastDispenseEpoch = 0;   // DS3231 unixtime of last successful dispense
unsigned long lastDispenseMs = 0; // Fallback timer when RTC is absent
bool     hasDispensedSinceBoot = false;

// Configurable settings (persisted in NVS)
float cfg_leftover    = 200.0f; // Block dispense if bowl > 200g
float cfg_daily       = 300.0f;
float cfg_ovs         = 3.0f;
float cfg_irPortion   = 20.0f;
int   cfg_cooldownMin = 10;     // Timing barrier T in minutes (default 10)
bool  cfg_reqPet      = false;
float cfg_calFactor   = 2280.0f;

ScheduleSlot schedules[4] = {
  { 8,  0, 30, false, 0 },
  { 13, 0, 30, false, 0 },
  { 18, 30, 30, false, 0 },
  { 21, 0, 20, false, 0 }
};

String logRing[MAX_LOGS];
int    logCount = 0;
int    logHead  = 0;

// Timers
unsigned long lastDisplayMs  = 0;
unsigned long lastRtcMs      = 0;
unsigned long stateEntryMs   = 0;
unsigned long lastTelemMs    = 0;
unsigned long lastCamRxMs    = 0;
unsigned long lastIrMs       = 0;
unsigned long lastLowFoodMs  = 0;
unsigned long lastSchedMs    = 0;

String camRxBuffer = "";

// Ultrasonic echo ISR state
volatile unsigned long echoStart = 0;
volatile unsigned long echoTime  = 0;
volatile bool          newEcho   = false;

void IRAM_ATTR echoISR() {
  if (digitalRead(PIN_US_ECHO) == HIGH) {
    echoStart = micros();
  } else {
    echoTime = micros() - echoStart;
    newEcho = true;
  }
}

void attachAndMoveServo(int angle) {
  if (!gate.attached()) {
    gate.setPeriodHertz(50);
    gate.attach(PIN_SERVO, 500, 2400);
  }
  gate.write(angle);
}

DateTime getCurrentTime() {
  if (rtcReady) {
    return rtc.now();
  }
  unsigned long s = millis() / 1000;
  return DateTime(2026, 11, 24, (s / 3600) % 24, (s / 60) % 60, s % 60);
}

uint32_t getCurrentEpoch() {
  if (rtcReady) {
    return rtc.now().unixtime();
  }
  return millis() / 1000;
}

String formatIsoTime(const DateTime& t) {
  char buf[24];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d",
           t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second());
  return String(buf);
}

String formatClockTime(const DateTime& t) {
  char buf[12];
  snprintf(buf, sizeof(buf), "%02d:%02d:%02d", t.hour(), t.minute(), t.second());
  return String(buf);
}

uint32_t getCooldownRemainingSec() {
  if (cfg_cooldownMin <= 0) return 0;
  uint32_t barrierSec = (uint32_t)cfg_cooldownMin * 60UL;

  if (rtcReady) {
    if (lastDispenseEpoch == 0) return 0;
    uint32_t nowEp = getCurrentEpoch();
    if (nowEp < lastDispenseEpoch) return 0;
    uint32_t elapsed = nowEp - lastDispenseEpoch;
    return (elapsed < barrierSec) ? (barrierSec - elapsed) : 0;
  }

  if (!hasDispensedSinceBoot) return 0;
  uint32_t elapsed = (millis() - lastDispenseMs) / 1000UL;
  return (elapsed < barrierSec) ? (barrierSec - elapsed) : 0;
}

void pushLogRecord(const String& jsonLine) {
  logRing[logHead] = jsonLine;
  logHead = (logHead + 1) % MAX_LOGS;
  if (logCount < MAX_LOGS) logCount++;
}

void sendConfigSync() {
  StaticJsonDocument<256> doc;
  doc["leftover_g"]   = cfg_leftover;
  doc["overshoot_g"]  = cfg_ovs;
  doc["daily_g"]      = cfg_daily;
  doc["require_pet"]  = cfg_reqPet;
  doc["cooldown_min"] = cfg_cooldownMin;
  doc["ir_portion_g"] = cfg_irPortion;
  String out;
  serializeJson(doc, out);
  Serial2.print("<CFG_SYNC:" + out + ">\n");
}

void sendScheduleSync() {
  StaticJsonDocument<512> doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < 4; i++) {
    JsonObject obj = arr.createNestedObject();
    obj["i"]  = i;
    obj["hh"] = schedules[i].hh;
    obj["mm"] = schedules[i].mm;
    obj["g"]  = schedules[i].grams;
    obj["en"] = schedules[i].enabled ? 1 : 0;
  }
  String out;
  serializeJson(doc, out);
  Serial2.print("<SCHED_SYNC:" + out + ">\n");
}

void sendAllLogsSync() {
  int start = (logHead - logCount + MAX_LOGS) % MAX_LOGS;
  for (int i = 0; i < logCount; i++) {
    int idx = (start + i) % MAX_LOGS;
    Serial2.print("<LOG_SYNC:" + logRing[idx] + ">\n");
  }
}

void emitFeedLog(const String& resCode, float w0, float w1, float dispensed, unsigned long durMs) {
  feedSeqId++;
  DateTime t = getCurrentTime();

  StaticJsonDocument<256> doc;
  doc["slot"] = activeSlot;
  char srcStr[2] = { activeSrc, '\0' };
  doc["src"]  = srcStr;
  doc["id"]   = feedSeqId;
  doc["tgt"]  = (int)targetGrams;
  doc["w0"]   = roundf(w0 * 10.0f) / 10.0f;
  doc["w1"]   = roundf(w1 * 10.0f) / 10.0f;
  doc["d"]    = roundf(dispensed * 10.0f) / 10.0f;
  doc["res"]  = resCode;
  doc["wig"]  = activeWiggles;
  doc["top"]  = activeTopups;
  doc["ms"]   = durMs;
  doc["ts"]   = formatIsoTime(t);

  String jsonOut;
  serializeJson(doc, jsonOut);
  pushLogRecord(jsonOut);
  Serial2.print("<LOG:" + jsonOut + ">\n");
  Serial.println("LOG: " + jsonOut);
}

void loadSettingsFromNvs() {
  prefs.begin("feeder", false);
  dayGramsDispensed = prefs.getFloat("dayGrams", 0.0f);
  currentDayKey     = prefs.getInt("dayKey", 0);
  lastDispenseEpoch = prefs.getUInt("lastEp", 0);
  cfg_leftover      = prefs.getFloat("leftover", 200.0f);
  cfg_daily         = prefs.getFloat("daily", 300.0f);
  cfg_ovs           = prefs.getFloat("ovs", 3.0f);
  cfg_irPortion     = prefs.getFloat("irPortion", 20.0f);
  cfg_cooldownMin   = prefs.getInt("cooldown", 10);
  cfg_reqPet        = prefs.getBool("reqPet", false);
  cfg_calFactor     = prefs.getFloat("calFactor", 2280.0f);
  if (cfg_calFactor == 0.0f) cfg_calFactor = 2280.0f;

  String schedSaved = prefs.getString("sched", "");
  if (schedSaved.length() > 0) {
    StaticJsonDocument<512> doc;
    if (!deserializeJson(doc, schedSaved) && doc.is<JsonArray>()) {
      for (JsonObject obj : doc.as<JsonArray>()) {
        int idx = obj["i"] | -1;
        if (idx >= 0 && idx < 4) {
          schedules[idx].hh      = constrain((int)(obj["hh"] | 8), 0, 23);
          schedules[idx].mm      = constrain((int)(obj["mm"] | 0), 0, 59);
          schedules[idx].grams   = constrain((int)(obj["g"] | 30), 5, 200);
          schedules[idx].enabled = (obj["en"] | 0) == 1;
        }
      }
    }
  }
}

void saveConfigToNvs() {
  prefs.putFloat("leftover", cfg_leftover);
  prefs.putFloat("daily", cfg_daily);
  prefs.putFloat("ovs", cfg_ovs);
  prefs.putFloat("irPortion", cfg_irPortion);
  prefs.putInt("cooldown", cfg_cooldownMin);
  prefs.putBool("reqPet", cfg_reqPet);
}

void saveSchedulesToNvs() {
  StaticJsonDocument<512> doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < 4; i++) {
    JsonObject obj = arr.createNestedObject();
    obj["i"]  = i;
    obj["hh"] = schedules[i].hh;
    obj["mm"] = schedules[i].mm;
    obj["g"]  = schedules[i].grams;
    obj["en"] = schedules[i].enabled ? 1 : 0;
  }
  String out;
  serializeJson(doc, out);
  prefs.putString("sched", out);
}

void startFeedJob(float grams, char src, int slot, bool force, unsigned long now) {
  targetGrams   = grams;
  activeSrc     = src;
  activeSlot    = slot;
  activeForce   = force;
  feedStartMs   = now;
  activeWiggles = 0;
  activeTopups  = 0;
  activeResult  = "OK";
  stateEntryMs  = now;
  currentState  = ST_PRECHECK;
}

void setup() {
  Serial.begin(115200);

  Serial2.setRxBufferSize(1024);
  Serial2.begin(UART_BAUD, SERIAL_8N1, PIN_RX2, PIN_TX2);
  Serial.printf("Sensor Hub starting (UART2 %lu baud on RX:%d TX:%d)\n",
                (unsigned long)UART_BAUD, PIN_RX2, PIN_TX2);

  loadSettingsFromNvs();

  if (oled.begin()) {
    oled.setFont(u8g2_font_6x10_tf);
    oled.setFontPosTop();
    oled.clearBuffer();
    oled.drawStr(0, 0, "Smart Pet Feeder");
    oled.drawStr(0, 16, "Booting V2.1...");
    oled.sendBuffer();
  } else {
    Serial.println("OLED init failed");
  }

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  rtcReady = rtc.begin();
  if (!rtcReady) {
    Serial.println("RTC DS3231 not found");
  } else if (rtc.lostPower()) {
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  // Non-blocking HX711 startup so missing/slow load cell never hangs boot
  scale.begin(PIN_HX_DT, PIN_HX_SCK);
  scale.set_scale(cfg_calFactor);
  if (scale.wait_ready_timeout(1200)) {
    scale.tare(5);
    hxReady = true;
    Serial.println("HX711 ready & tared");
  } else {
    Serial.println("HX711 not ready at boot (continuing)");
  }

  pinMode(PIN_US_TRIG, OUTPUT);
  digitalWrite(PIN_US_TRIG, LOW);
  pinMode(PIN_US_ECHO, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_US_ECHO), echoISR, CHANGE);

  pinMode(PIN_IR_OUT, INPUT_PULLUP);

  ESP32PWM::allocateTimer(0);
  attachAndMoveServo(SERVO_CLOSED_DEG);
  delay(400);
  gate.detach();

  Serial2.print("<HB>\n");
  Serial.println("Setup complete.");
}

void loop() {
  unsigned long now = millis();

  hxService();
  usService(now);
  irService(now);
  clockService(now);
  scheduleService(now);
  commService(now);
  feederTask(now);
  displayService(now);
}

void hxService() {
  if (scale.is_ready()) {
    hxReady = true;
    float w = scale.get_units(1);
    if (isfinite(w)) {
      if (w < 0.0f && w > -2.0f) w = 0.0f;
      currentWeightGrams = w;
    }
  }
}

void usService(unsigned long now) {
  static unsigned long lastTrigger = 0;

  if (now - lastTrigger >= 1000) {
    lastTrigger = now;
    digitalWrite(PIN_US_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_US_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_US_TRIG, LOW);
  }

  if (newEcho) {
    newEcho = false;
    if (echoTime > 100 && echoTime < 25000) {
      float cm = echoTime / 58.0f;
      int pct = map((int)cm, 22, 4, 0, 100);
      hopperPercent = constrain(pct, 0, 100);

      if (hopperPercent < 15 && (now - lastLowFoodMs > 30000 || lastLowFoodMs == 0)) {
        lastLowFoodMs = now;
        Serial2.printf("<LOW_FOOD:%d>\n", hopperPercent);
      }
    }
  }
}

void irService(unsigned long now) {
  bool irLow = (digitalRead(PIN_IR_OUT) == LOW);
  irDetected = irLow;

  if (irLow && (now - lastIrMs > 10000 || lastIrMs == 0)) {
    lastIrMs = now;
    petVisitsToday++;

    // Always notify ESP32-CAM so it switches the camera ON for live feed
    Serial2.print("<PET_DETECTED>\n");
    Serial.println("IR triggered -> camera ON");

    if (currentState == ST_IDLE) {
      startFeedJob(cfg_irPortion, 'I', -1, false, now);
    } else if (currentState == ST_WAIT_PET) {
      stateEntryMs = now;
      currentState = ST_DISPENSE;
    }
  }
}

void clockService(unsigned long now) {
  if (now - lastRtcMs >= 1000) {
    lastRtcMs = now;
    DateTime t = getCurrentTime();
    int today = t.year() * 10000 + t.month() * 100 + t.day();
    if (today != currentDayKey) {
      currentDayKey = today;
      dayGramsDispensed = 0.0f;
      petVisitsToday = 0;
      prefs.putInt("dayKey", currentDayKey);
      prefs.putFloat("dayGrams", dayGramsDispensed);
    }
  }
}

void scheduleService(unsigned long now) {
  if (now - lastSchedMs < 5000 || currentState != ST_IDLE) return;
  lastSchedMs = now;

  DateTime t = getCurrentTime();
  int today = t.year() * 10000 + t.month() * 100 + t.day();

  for (int i = 0; i < 4; i++) {
    if (!schedules[i].enabled) continue;
    if (schedules[i].lastDayRun == today) continue;
    if (t.hour() == schedules[i].hh && t.minute() == schedules[i].mm) {
      schedules[i].lastDayRun = today;
      startFeedJob((float)schedules[i].grams, 'S', i, false, now);
      break;
    }
  }
}

void handleCamMessage(const String& rawMsg, unsigned long now) {
  int startIdx = rawMsg.indexOf('<');
  int endIdx   = rawMsg.lastIndexOf('>');
  if (startIdx == -1 || endIdx == -1 || endIdx <= startIdx) return;

  String msg = rawMsg.substring(startIdx + 1, endIdx);
  lastCamRxMs = now;
  isLinked = true;

  if (msg.startsWith("HB")) {
    if (!msg.equals("HB:OK")) {
      Serial2.print("<HB:OK>\n");
    }
    return;
  }

  if (msg.equals("REQ_SYNC")) {
    sendConfigSync();
    sendScheduleSync();
    sendAllLogsSync();
    return;
  }

  if (msg.startsWith("FEED_NOW:")) {
    String params = msg.substring(9);
    int comma = params.indexOf(',');
    int g = (comma == -1) ? params.toInt() : params.substring(0, comma).toInt();
    bool force = (comma != -1) ? (params.substring(comma + 1).toInt() == 1) : false;

    if (g >= 5 && g <= 200) {
      if (currentState == ST_IDLE) {
        startFeedJob((float)g, 'R', -1, force, now);
        Serial2.printf("<ACK:FEED:%d>\n", g);
      } else {
        Serial2.print("<ERR:BUSY>\n");
      }
    } else {
      Serial2.printf("<ERR:INVALID_PORTION:%d>\n", g);
    }
    return;
  }

  if (msg.equals("ABORT")) {
    if (currentState != ST_IDLE && currentState != ST_FAULT) {
      attachAndMoveServo(SERVO_CLOSED_DEG);
      delay(150);
      gate.detach();
      activeResult = "ABORTED";
      currentState = ST_REPORT;
      Serial2.print("<ACK:ABORT>\n");
    }
    return;
  }

  if (msg.equals("CLEAR")) {
    if (currentState == ST_FAULT) {
      currentState = ST_IDLE;
      Serial2.print("<ACK:CLEAR>\n");
    }
    return;
  }

  if (msg.equals("TARE")) {
    if (scale.wait_ready_timeout(500)) {
      scale.tare(5);
      currentWeightGrams = 0.0f;
      Serial2.print("<ACK:TARE>\n");
    } else {
      Serial2.print("<ERR:SENSOR>\n");
    }
    return;
  }

  if (msg.startsWith("CAL:")) {
    float knownG = msg.substring(4).toFloat();
    if (knownG > 0.0f && scale.wait_ready_timeout(500)) {
      float raw = scale.get_units(5);
      if (fabs(raw) > 0.01f) {
        cfg_calFactor = scale.get_scale() * (raw / knownG);
        scale.set_scale(cfg_calFactor);
        prefs.putFloat("calFactor", cfg_calFactor);
      }
      Serial2.printf("<ACK:CAL:%.2f>\n", cfg_calFactor);
    } else {
      Serial2.print("<ERR:CAL>\n");
    }
    return;
  }

  if (msg.startsWith("CFG:")) {
    String jsonStr = msg.substring(4);
    StaticJsonDocument<256> doc;
    if (!deserializeJson(doc, jsonStr)) {
      if (doc.containsKey("leftover_g"))   cfg_leftover    = constrain((float)doc["leftover_g"], 20.0f, 500.0f);
      if (doc.containsKey("daily_g"))      cfg_daily       = constrain((float)doc["daily_g"], 20.0f, 2000.0f);
      if (doc.containsKey("overshoot_g"))  cfg_ovs         = constrain((float)doc["overshoot_g"], 0.0f, 20.0f);
      if (doc.containsKey("require_pet"))  cfg_reqPet      = (bool)doc["require_pet"];
      if (doc.containsKey("cooldown_min")) cfg_cooldownMin = constrain((int)doc["cooldown_min"], 0, 1440);
      if (doc.containsKey("ir_portion_g")) cfg_irPortion   = constrain((float)doc["ir_portion_g"], 5.0f, 200.0f);
      saveConfigToNvs();
      sendConfigSync();
      Serial2.print("<ACK:CFG>\n");
    }
    return;
  }

  if (msg.startsWith("SCHED:")) {
    String jsonStr = msg.substring(6);
    StaticJsonDocument<512> doc;
    if (!deserializeJson(doc, jsonStr) && doc.is<JsonArray>()) {
      for (JsonObject obj : doc.as<JsonArray>()) {
        int idx = obj["i"] | -1;
        if (idx >= 0 && idx < 4) {
          schedules[idx].hh      = constrain((int)(obj["hh"] | 8), 0, 23);
          schedules[idx].mm      = constrain((int)(obj["mm"] | 0), 0, 59);
          schedules[idx].grams   = constrain((int)(obj["g"] | 30), 5, 200);
          schedules[idx].enabled = (obj["en"] | 0) == 1;
        }
      }
      saveSchedulesToNvs();
      sendScheduleSync();
      Serial2.print("<ACK:SCHED>\n");
    }
    return;
  }

  if (msg.startsWith("SET_TIME:")) {
    int yr, mo, dy, hh, mm, ss;
    if (sscanf(msg.substring(9).c_str(), "%d,%d,%d,%d,%d,%d", &yr, &mo, &dy, &hh, &mm, &ss) == 6) {
      if (rtcReady) {
        rtc.adjust(DateTime(yr, mo, dy, hh, mm, ss));
      }
      Serial2.print("<ACK:TIME>\n");
    }
    return;
  }

  if (msg.startsWith("VERDICT:PET")) {
    if (currentState == ST_WAIT_PET) {
      stateEntryMs = now;
      currentState = ST_DISPENSE;
    }
    return;
  }
}

void commService(unsigned long now) {
  if (isLinked && (now - lastCamRxMs > 6000)) {
    isLinked = false;
  }

  bool isActiveDispense = (currentState == ST_DISPENSE || currentState == ST_TOPUP || currentState == ST_WIGGLE);
  unsigned long telemInterval = isActiveDispense ? 300 : 1000;

  if (now - lastTelemMs >= telemInterval) {
    lastTelemMs = now;

    const char* stStr = "IDLE";
    switch (currentState) {
      case ST_IDLE:     stStr = "IDLE"; break;
      case ST_PRECHECK: stStr = "PRECHECK"; break;
      case ST_WAIT_PET: stStr = "WAIT_PET"; break;
      case ST_DISPENSE: stStr = "DISPENSING"; break;
      case ST_WIGGLE:   stStr = "WIGGLE"; break;
      case ST_SETTLE:   stStr = "SETTLING"; break;
      case ST_TOPUP:    stStr = "TOPUP"; break;
      case ST_REPORT:   stStr = "REPORT"; break;
      case ST_FAULT:    stStr = "JAM"; break;
    }

    int isGateOpen = isActiveDispense ? 1 : 0;
    int isIrTripped = (digitalRead(PIN_IR_OUT) == LOW) ? 1 : 0;
    uint32_t cdRem = getCooldownRemainingSec();
    String clk = formatClockTime(getCurrentTime());

    Serial2.printf("<TELEM:%s,%.1f,%d,%s,%d,%d,%.1f,%d,%lu>\n",
                   clk.c_str(), currentWeightGrams, hopperPercent, stStr,
                   isIrTripped, petVisitsToday, dayGramsDispensed, isGateOpen,
                   (unsigned long)cdRem);
  }

  while (Serial2.available()) {
    char c = (char)Serial2.read();
    if (c == '\n') {
      camRxBuffer.trim();
      if (camRxBuffer.length() > 0) {
        handleCamMessage(camRxBuffer, now);
      }
      camRxBuffer = "";
    } else if (c != '\r') {
      camRxBuffer += c;
      if (camRxBuffer.length() > 768) {
        camRxBuffer = "";
      }
    }
  }
}

void feederTask(unsigned long now) {
  switch (currentState) {
    case ST_IDLE:
      break;

    case ST_PRECHECK: {
      bowlStartWeight = currentWeightGrams;
      uint32_t cdRem = getCooldownRemainingSec();

      if (bowlStartWeight > cfg_leftover) {
        Serial.printf("Blocked: bowl %.1fg > %.1fg limit\n", bowlStartWeight, cfg_leftover);
        Serial2.printf("<ERR:BOWL_FULL:%.1f>\n", bowlStartWeight);
        emitFeedLog("SKIP_LEFTOVER", bowlStartWeight, bowlStartWeight, 0.0f, 0);
        currentState = ST_IDLE;
      } else if (!activeForce && cdRem > 0) {
        Serial.printf("Blocked: cooldown active (%lus remaining)\n", (unsigned long)cdRem);
        Serial2.printf("<ERR:COOLDOWN:%lu>\n", (unsigned long)cdRem);
        emitFeedLog("SKIP_COOLDOWN", bowlStartWeight, bowlStartWeight, 0.0f, 0);
        currentState = ST_IDLE;
      } else if (dayGramsDispensed + targetGrams > cfg_daily) {
        Serial.printf("Blocked: daily limit %.1fg\n", cfg_daily);
        Serial2.print("<ERR:DAILY_LIMIT>\n");
        emitFeedLog("SKIP_DAILY", bowlStartWeight, bowlStartWeight, 0.0f, 0);
        currentState = ST_IDLE;
      } else if (cfg_reqPet && activeSrc == 'S') {
        stateEntryMs = now;
        currentState = ST_WAIT_PET;
      } else {
        stateEntryMs = now;
        currentState = ST_DISPENSE;
        attachAndMoveServo(SERVO_OPEN_DEG); // Move by 10 degrees
      }
      break;
    }

    case ST_WAIT_PET:
      if (now - stateEntryMs > 120000) {
        emitFeedLog("SKIP_NO_PET", bowlStartWeight, currentWeightGrams, 0.0f, now - feedStartMs);
        currentState = ST_IDLE;
      }
      break;

    case ST_DISPENSE:
      attachAndMoveServo(SERVO_OPEN_DEG); // 10-degree open shift
      if ((hxReady && currentWeightGrams >= (bowlStartWeight + targetGrams - cfg_ovs)) ||
          (now - stateEntryMs >= 2500)) {
        attachAndMoveServo(SERVO_CLOSED_DEG);
        stateEntryMs = now;
        currentState = ST_SETTLE;
      }
      break;

    case ST_WIGGLE:
      attachAndMoveServo(SERVO_OPEN_DEG);
      delay(150);
      attachAndMoveServo(SERVO_CLOSED_DEG);
      delay(150);
      activeWiggles++;
      if (activeWiggles > 2) {
        activeResult = "JAM";
        currentState = ST_FAULT;
      } else {
        stateEntryMs = now;
        currentState = ST_DISPENSE;
      }
      break;

    case ST_SETTLE:
      if (now - stateEntryMs > 1200) {
        gate.detach();
        float dispensed = currentWeightGrams - bowlStartWeight;
        if (hxReady && dispensed < targetGrams - 2.0f && activeTopups < 1 && currentWeightGrams <= cfg_leftover) {
          activeTopups++;
          currentState = ST_TOPUP;
        } else {
          currentState = ST_REPORT;
        }
      }
      break;

    case ST_TOPUP:
      attachAndMoveServo(SERVO_OPEN_DEG);
      delay(300);
      attachAndMoveServo(SERVO_CLOSED_DEG);
      stateEntryMs = now;
      currentState = ST_SETTLE;
      break;

    case ST_REPORT: {
      float netDispensed = currentWeightGrams - bowlStartWeight;
      if (netDispensed < 0.0f) netDispensed = 0.0f;

      if (activeResult == "OK") {
        dayGramsDispensed += netDispensed;
        prefs.putFloat("dayGrams", dayGramsDispensed);

        lastDispenseEpoch = getCurrentEpoch();
        lastDispenseMs = now;
        hasDispensedSinceBoot = true;
        prefs.putUInt("lastEp", lastDispenseEpoch);
      }

      emitFeedLog(activeResult, bowlStartWeight, currentWeightGrams, netDispensed, now - feedStartMs);

      if (gate.attached()) {
        gate.write(SERVO_CLOSED_DEG);
        delay(100);
        gate.detach();
      }
      currentState = ST_IDLE;
      break;
    }

    case ST_FAULT:
      if (gate.attached()) {
        gate.write(SERVO_CLOSED_DEG);
        delay(200);
        gate.detach();
      }
      break;
  }
}

void displayService(unsigned long now) {
  if (now - lastDisplayMs < 500) return;
  lastDisplayMs = now;

  DateTime t = getCurrentTime();
  char buf[32];

  oled.clearBuffer();

  snprintf(buf, sizeof(buf), "%02d:%02d:%02d", t.hour(), t.minute(), t.second());
  oled.drawStr(0, 0, buf);
  oled.drawStr(96, 0, isLinked ? "LINK" : "OFF");

  snprintf(buf, sizeof(buf), "Bowl: %.1fg", currentWeightGrams);
  oled.drawStr(0, 16, buf);
  if (currentWeightGrams > cfg_leftover) {
    oled.drawStr(88, 16, "FULL");
  }

  snprintf(buf, sizeof(buf), "Hopper: %d%%", hopperPercent);
  oled.drawStr(0, 30, buf);
  if (hopperPercent < 15) {
    oled.drawStr(88, 30, "LOW!");
  }

  uint32_t cdRem = getCooldownRemainingSec();
  if (cdRem > 0) {
    snprintf(buf, sizeof(buf), "CD: %lum %02lus", (unsigned long)(cdRem / 60), (unsigned long)(cdRem % 60));
  } else {
    snprintf(buf, sizeof(buf), "CD: READY (%dm)", cfg_cooldownMin);
  }
  oled.drawStr(0, 44, buf);

  const char* stateTxt = "IDLE";
  switch (currentState) {
    case ST_IDLE:     stateTxt = "IDLE"; break;
    case ST_PRECHECK: stateTxt = "CHECK"; break;
    case ST_WAIT_PET: stateTxt = "WAIT PET"; break;
    case ST_DISPENSE: stateTxt = "POURING"; break;
    case ST_SETTLE:   stateTxt = "SETTLE"; break;
    case ST_TOPUP:    stateTxt = "TOPUP"; break;
    case ST_FAULT:    stateTxt = "FAULT"; break;
    default:          stateTxt = "BUSY"; break;
  }
  snprintf(buf, sizeof(buf), "State: %s", stateTxt);
  oled.drawStr(0, 54, buf);

  oled.sendBuffer();
}