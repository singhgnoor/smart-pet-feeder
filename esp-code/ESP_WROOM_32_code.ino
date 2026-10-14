/*
 * Smart Pet Feeder V2.1 - Sensor Hub (ESP32-WROOM-32D)
 * 
 * This is the main real-time controller. It handles all the time-critical
 * stuff: weighing the food (HX711), moving the servo, reading the ultrasonic 
 * sensor, checking the RTC, and updating the OLED.
 * 
 * It talks to the ESP32-CAM (Vision/Web Hub) over Serial2.
 * Strictly non-blocking! No delay() in loop() allowed.
 */

#include <Wire.h>
#include <SPI.h>
#include <U8g2lib.h>
#include <HX711.h>
#include <ESP32Servo.h>
#include <RTClib.h>
#include <Preferences.h>

// --- PIN DEFINITIONS ---
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
const int PIN_US_ECHO = 34; // Needs 1k/2k voltage divider!

// IR Sensor & Servo
const int PIN_IR_OUT = 33;
const int PIN_SERVO  = 18;

// UART2 to ESP32-CAM
const int PIN_TX2 = 17;
const int PIN_RX2 = 16;

// --- OBJECTS ---
U8G2_SSD1306_128X64_NONAME_F_4W_SW_SPI oled(U8G2_R0, PIN_OLED_CLK, PIN_OLED_DIN, PIN_OLED_CS, PIN_OLED_DC, PIN_OLED_RES);
RTC_DS3231 rtc;
HX711 scale;
Servo gate;
Preferences prefs;

// --- STATE MACHINE ENUMS ---
enum FeederState {
  ST_IDLE, ST_PRECHECK, ST_WAIT_PET, ST_DISPENSE, 
  ST_WIGGLE, ST_SETTLE, ST_TOPUP, ST_REPORT, ST_FAULT
};
FeederState currentState = ST_IDLE;

// --- GLOBALS & CONFIG ---
float currentWeightGrams = 0.0;
float targetGrams = 0.0;
float bowlStartWeight = 0.0;
int hopperPercent = 100;
bool irDetected = false;
bool isLinked = false;

// NVS tracking to prevent double feeds after a power cut
uint32_t lastFedToken = 0; 
float dayGramsDispensed = 0.0;
int currentDayKey = 0; // YYYYMMDD

// Config settings (normally set via UART from the CAM's web dashboard)
float cfg_leftover = 30.0;
float cfg_daily = 300.0;
float cfg_ovs = 3.0; // Overshoot compensation (close gate 3g early)
bool cfg_reqPet = false; // Require AI confirmation?

// Timers for non-blocking loop
unsigned long lastDisplayMs = 0;
unsigned long lastRtcMs = 0;
unsigned long stateTimer = 0;
unsigned long lastHbMs = 0;
unsigned long lastIrMs = 0;

// Hardware interrupt vars for Ultrasonic
volatile unsigned long echoStart = 0;
volatile unsigned long echoTime = 0;
volatile bool newEcho = false;

// --- INTERRUPT SERVICE ROUTINE ---
void IRAM_ATTR echoISR() {
  if (digitalRead(PIN_US_ECHO) == HIGH) {
    echoStart = micros();
  } else {
    echoTime = micros() - echoStart;
    newEcho = true;
  }
}

void setup() {
  Serial.begin(115200); // USB Debug
  Serial2.begin(115200, SERIAL_8N1, PIN_RX2, PIN_TX2); // Link to ESP32-CAM
  
  Serial.println("Starting Sensor Hub...");

  // Init NVS (Preferences)
  prefs.begin("feeder", false);
  lastFedToken = prefs.getUInt("lastToken", 0);
  dayGramsDispensed = prefs.getFloat("dayGrams", 0.0);
  currentDayKey = prefs.getInt("dayKey", 0);

  // Init SPI OLED
  if (!oled.begin()) {
    Serial.println("OLED failed!");
  } else {
    oled.setFont(u8g2_font_6x10_tf);
    oled.setFontPosTop();
    oled.clearBuffer();
    oled.drawStr(0, 0, "Booting V2.1...");
    oled.sendBuffer();
  }

  // Init I2C for RTC
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!rtc.begin()) {
    Serial.println("RTC missing!");
  }

  // Init HX711
  scale.begin(PIN_HX_DT, PIN_HX_SCK);
  // NOTE: You need to calibrate this value for your specific load cell!
  scale.set_scale(2280.f); 
  scale.tare(); // assume bowl is empty on boot

  // Init Ultrasonic
  pinMode(PIN_US_TRIG, OUTPUT);
  pinMode(PIN_US_ECHO, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_US_ECHO), echoISR, CHANGE);

  // Init IR
  pinMode(PIN_IR_OUT, INPUT_PULLUP); // Active LOW

  // Init Servo
  ESP32PWM::allocateTimer(0);
  gate.setPeriodHertz(50);
  gate.attach(PIN_SERVO, 500, 2400);
  gate.write(10); // 10 degrees is CLOSED
  delay(500);     // Let it reach position
  gate.detach();  // Detach to save power and prevent jitter/heat
  
  Serial.println("Setup complete.");
}

void loop() {
  unsigned long now = millis();

  hxService();
  usService(now);
  irService(now);
  clockService(now);
  commService(now);
  feederTask(now);
  displayService(now);
}

// --- NON-BLOCKING SERVICES ---

void hxService() {
  // Read scale without blocking the loop
  if (scale.is_ready()) {
    // In a real build, you'd want a 5-sample median filter here
    // Keeping it simple for readability
    currentWeightGrams = scale.get_units(1);
  }
}

void usService(unsigned long now) {
  static unsigned long lastTrigger = 0;
  
  // Fire trigger every 1 second
  if (now - lastTrigger > 1000) {
    lastTrigger = now;
    digitalWrite(PIN_US_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_US_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_US_TRIG, LOW);
  }

  // Process hardware interrupt result
  if (newEcho) {
    newEcho = false;
    float cm = echoTime / 58.0;
    
    // Map distance to percentage (adjust 4.0 and 22.0 based on your hopper)
    int pct = map((int)cm, 22, 4, 0, 100);
    hopperPercent = constrain(pct, 0, 100);
    
    // Alert CAM if food is low
    if (hopperPercent < 15) {
      Serial2.println("<LOW_FOOD>"); 
    }
  }
}

void irService(unsigned long now) {
  // IR is active LOW. Use a cooldown so we don't spam the CAM
  if (digitalRead(PIN_IR_OUT) == LOW) {
    if (now - lastIrMs > 10000) { // 10 sec cooldown
      lastIrMs = now;
      irDetected = true;
      Serial2.println("<PET_DETECTED>");
      Serial.println("IR: Pet detected!");
    }
  }
}

void clockService(unsigned long now) {
  if (now - lastRtcMs > 1000) {
    lastRtcMs = now;
    DateTime t = rtc.now();
    
    // Check midnight rollover for daily limit
    int today = t.year() * 10000 + t.month() * 100 + t.day();
    if (today != currentDayKey) {
      currentDayKey = today;
      dayGramsDispensed = 0.0;
      prefs.putInt("dayKey", currentDayKey);
      prefs.putFloat("dayGrams", dayGramsDispensed);
    }
    
    // In full implementation, loop over 4 schedule arrays here.
    // If current time matches a slot, generate a token, compare to lastFedToken.
    // If different, call requestFeed(grams) and save new token to NVS.
  }
}

void commService(unsigned long now) {
  // 1. Send Heartbeat to CAM
  if (now - lastHbMs > 2000) {
    lastHbMs = now;
    Serial2.printf("<HB:%lu>\n", millis() / 1000);
  }
  
  // 2. Read incoming commands from CAM
  while (Serial2.available()) {
    String msg = Serial2.readStringUntil('\n');
    msg.trim();
    if (msg.startsWith("<") && msg.endsWith(">")) {
      msg = msg.substring(1, msg.length() - 1);
      
      // Parse manual feed command e.g., FEED_NOW:50
      if (msg.startsWith("FEED_NOW:")) {
        int g = msg.substring(9).toInt();
        if (currentState == ST_IDLE) {
          targetGrams = (float)g;
          currentState = ST_PRECHECK; // Kick off the state machine
          Serial.printf("Manual feed requested: %dg\n", g);
        }
      } 
      // Parse AI verdict
      else if (msg.startsWith("VERDICT:PET")) {
        if (currentState == ST_WAIT_PET) {
          currentState = ST_DISPENSE; // AI confirmed pet, open gate!
        }
      }
      else if (msg.startsWith("HB:")) {
        isLinked = true;
      }
    }
  }
}

// --- MAIN DISPENSING STATE MACHINE ---
void feederTask(unsigned long now) {
  static unsigned long stateEntryMs = 0;
  static int wiggles = 0;
  
  switch (currentState) {
    case ST_IDLE:
      // Just chilling. Gate is detached.
      break;

    case ST_PRECHECK:
      // Tare / baseline check
      bowlStartWeight = currentWeightGrams;
      
      // Policy checks
      if (bowlStartWeight > cfg_leftover) {
        Serial.println("Skip: Too much food in bowl.");
        currentState = ST_REPORT;
      } else if (dayGramsDispensed + targetGrams > cfg_daily) {
        Serial.println("Skip: Daily limit reached.");
        currentState = ST_REPORT;
      } else {
        if (cfg_reqPet) {
          stateEntryMs = now;
          currentState = ST_WAIT_PET;
          Serial.println("Waiting for AI pet confirmation...");
        } else {
          stateEntryMs = now;
          currentState = ST_DISPENSE;
        }
      }
      break;

    case ST_WAIT_PET:
      if (now - stateEntryMs > 120000) { // 2 minute timeout
        Serial.println("Skip: Pet never showed up.");
        currentState = ST_REPORT;
      }
      break;

    case ST_DISPENSE:
      if (!gate.attached()) gate.attach(PIN_SERVO);
      gate.write(80); // Open gate
      
      // Overshoot check (close slightly early because kibble falls through air)
      if (currentWeightGrams >= (bowlStartWeight + targetGrams - cfg_ovs)) {
        gate.write(10); // Close
        stateEntryMs = now;
        currentState = ST_SETTLE;
      }
      
      // Hard timeout check (8 seconds max to prevent burning servo)
      if (now - stateEntryMs > 8000) {
        gate.write(10);
        stateEntryMs = now;
        currentState = ST_SETTLE;
      }
      
      // (Jam detection logic would go here. If weight doesn't rise, go to ST_WIGGLE)
      break;

    case ST_WIGGLE:
      // Quickly flutter the gate to break kibble jams
      gate.write(80);
      delay(150); // okay, one tiny delay for the wiggle is forgivable
      gate.write(10);
      delay(150);
      wiggles++;
      if (wiggles > 2) {
        currentState = ST_FAULT; // Jammed completely
      } else {
        currentState = ST_DISPENSE;
      }
      break;

    case ST_SETTLE:
      // Wait 1.5s for vibrations to stop before reading final weight
      if (now - stateEntryMs > 1500) {
        gate.detach(); // Detach to save power!
        
        float dispensed = currentWeightGrams - bowlStartWeight;
        if (dispensed < targetGrams - 2.0) {
           // Short pour, do a top up pulse
           currentState = ST_TOPUP;
        } else {
           currentState = ST_REPORT;
        }
      }
      break;

    case ST_TOPUP:
      gate.attach(PIN_SERVO);
      gate.write(80);
      delay(250); // fast pulse
      gate.write(10);
      stateEntryMs = now;
      currentState = ST_SETTLE;
      break;

    case ST_REPORT:
      {
        float netDispensed = currentWeightGrams - bowlStartWeight;
        if (netDispensed < 0) netDispensed = 0;
        
        dayGramsDispensed += netDispensed;
        prefs.putFloat("dayGrams", dayGramsDispensed);
        
        Serial.printf("Feed complete. Dispensed: %.1fg\n", netDispensed);
        Serial2.printf("<LOG:%.1f>\n", netDispensed);
        
        currentState = ST_IDLE;
        wiggles = 0;
      }
      break;

    case ST_FAULT:
      // Latch in fault state. Requires manual <CLEAR> command from UI.
      if (gate.attached()) {
        gate.write(10);
        delay(500);
        gate.detach();
      }
      break;
  }
}

void displayService(unsigned long now) {
  // Update OLED every 500ms
  if (now - lastDisplayMs > 500) {
    lastDisplayMs = now;
    
    DateTime t = rtc.now();
    char buf[32];
    
    oled.clearBuffer();
    
    // Top Bar
    snprintf(buf, sizeof(buf), "%02d:%02d", t.hour(), t.minute());
    oled.drawStr(0, 0, buf);
    
    oled.drawStr(95, 0, isLinked ? "LINK" : "OFF");
    
    // Main stats
    snprintf(buf, sizeof(buf), "Bowl: %.1f g", currentWeightGrams);
    oled.drawStr(0, 20, buf);
    
    snprintf(buf, sizeof(buf), "Food: %d%%", hopperPercent);
    oled.drawStr(0, 35, buf);
    
    // State footer
    const char* stateTxt;
    switch (currentState) {
      case ST_IDLE: stateTxt = "IDLE"; break;
      case ST_PRECHECK: stateTxt = "CHECKING"; break;
      case ST_WAIT_PET: stateTxt = "WAIT PET"; break;
      case ST_DISPENSE: stateTxt = "POURING"; break;
      case ST_SETTLE: stateTxt = "SETTLING"; break;
      case ST_FAULT: stateTxt = "FAULT!"; break;
      default: stateTxt = "BUSY"; break;
    }
    snprintf(buf, sizeof(buf), "State: %s", stateTxt);
    oled.drawStr(0, 52, buf);
    
    oled.sendBuffer();
  }
}
