/*
 * Smart Pet Feeder V2.1 - ESP32-CAM Wi-Fi AP, Camera & IoT Web Platform
 * Hosts embedded dashboard at http://192.168.4.1/ and full REST/SSE API.
 */

#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>

const char* WIFI_SSID = "PetFeeder";
const char* WIFI_PASS = "petfeeder123";
const char* API_KEY   = "change-me";

// Set true to enforce X-API-Key header on POST/PUT endpoints
#define REQUIRE_API_KEY false

#define FLASH_LED_PIN 4

// AI-Thinker ESP32-CAM pin map
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

#ifndef pin_sscb_sda
#define pin_sscb_sda pin_sccb_sda
#endif
#ifndef pin_sscb_scl
#define pin_sscb_scl pin_sccb_scl
#endif

// UART1 to ESP32-S (matches TL_CIRCUIT_V2.1.pdf: ESP32S TX2 IO17 -> CAM RX1 IO13, CAM TX1 IO14 -> ESP32S RX2 IO16)
// Only ESP32-CAM pins may be reassigned if needed (e.g. RX=15, TX=14).
#define U1_RX_PIN 13
#define U1_TX_PIN 14
const uint32_t UART_BAUD = 9600;

const int MAX_LOGS = 25;
const unsigned long CAM_AUTO_OFF_MS = 60000;

HardwareSerial U1Serial(1);
AsyncWebServer server(80);
AsyncEventSource events("/events");

bool camJpeg          = false;
bool cameraActive     = false;
bool cameraManualHold = false;
bool flashState       = false;
unsigned long cameraOffAtMs = 0;

bool u1LinkActive      = false;
bool prevU1LinkActive  = false;
unsigned long lastU1RxMs = 0;
unsigned long lastHbTxMs = 0;
String uartRxBuffer    = "";

String latestTelemetryJson = "{\"t\":\"00:00:00\",\"w\":0.0,\"hop\":100,\"st\":\"IDLE\",\"ir\":0,\"vis\":0,\"day\":0.0,\"gate\":0,\"cd\":0,\"cam\":0}";
String configJson          = "{\"leftover_g\":200,\"overshoot_g\":3,\"daily_g\":300,\"require_pet\":false,\"cooldown_min\":10,\"ir_portion_g\":20}";
String scheduleJson        = "[{\"i\":0,\"hh\":8,\"mm\":0,\"g\":30,\"en\":0},{\"i\":1,\"hh\":13,\"mm\":0,\"g\":30,\"en\":0},{\"i\":2,\"hh\":18,\"mm\":30,\"g\":30,\"en\":0},{\"i\":3,\"hh\":21,\"mm\":0,\"g\":20,\"en\":0}]";

String logRing[MAX_LOGS];
int logCount = 0;
int logHead  = 0;

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Pet Feeder</title>
<style>
:root{--bg:#f6f3ec;--card:#fff;--ink:#23201c;--muted:#6e665c;--accent:#2f7d4e;--warn:#d97706;--err:#dc2626;--line:#e7e1d6;}
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
body{background:var(--bg);color:var(--ink);padding:16px;max-width:1040px;margin:0 auto;}
header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px;}
h1{font-size:22px;font-weight:800;}
.badges{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.badge{padding:5px 11px;border-radius:999px;font-size:12px;font-weight:700;background:#e5e7eb;color:#374151;}
.ok{background:#dcfce7;color:#166534;}.bad{background:#fee2e2;color:#991b1b;}.warn{background:#fef3c7;color:#92400e;}
.alert{display:none;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:12px 14px;border-radius:10px;margin-bottom:14px;font-weight:600;font-size:14px;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px;margin-bottom:16px;}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-weight:700;}
.v{font-size:26px;font-weight:800;margin-top:4px;}
.sub{font-size:12px;color:var(--muted);margin-top:4px;}
.bar{height:8px;background:#ece7dd;border-radius:999px;overflow:hidden;margin-top:8px;}
.bar>div{height:100%;background:var(--accent);transition:width .3s;}
.cambox{background:#181614;border-radius:10px;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;color:#a8a29e;font-size:13px;}
.cambox img{width:100%;height:100%;object-fit:cover;display:none;}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;}
button{border:none;border-radius:9px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#ede9e0;color:var(--ink);}
button.pri{background:var(--accent);color:#fff;}
button.dan{background:var(--err);color:#fff;}
button.act{background:#23201c;color:#fff;}
button:disabled{opacity:.5;cursor:not-allowed;}
input[type=number]{width:90px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-size:14px;font-weight:600;}
.field{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);gap:10px;}
.field:last-child{border-bottom:none;}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);}
th{color:var(--muted);font-size:11px;text-transform:uppercase;}
.toast{position:fixed;bottom:16px;right:16px;background:#23201c;color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;display:none;z-index:99;max-width:320px;}
</style>
</head>
<body>
<header>
  <h1>Smart Pet Feeder</h1>
  <div class="badges">
    <span id="bLink" class="badge bad">UART: OFF</span>
    <span id="bTime" class="badge">--:--:--</span>
    <button onclick="syncTime()">Sync RTC</button>
  </div>
</header>

<div id="lowAlert" class="alert">Low Food Warning: Hopper level is below 15%. Please refill the container.</div>

<div class="grid">
  <div class="card">
    <div class="k">Bowl Weight (HX711)</div>
    <div class="v" id="vWeight">-- g</div>
    <div class="sub" id="vBowlGuard">Limit: 200 g</div>
  </div>
  <div class="card">
    <div class="k">Hopper Level (Ultrasonic)</div>
    <div class="v" id="vHop">-- %</div>
    <div class="bar"><div id="hopBar" style="width:0%"></div></div>
  </div>
  <div class="card">
    <div class="k">Cooldown Barrier (T)</div>
    <div class="v" id="vCd">READY</div>
    <div class="sub" id="vCdSub">Default: 10 min</div>
  </div>
  <div class="card">
    <div class="k">Feeder State & IR</div>
    <div class="v" id="vState">--</div>
    <div class="sub" id="vIr">IR: Clear | Today: 0 g</div>
  </div>
</div>

<div class="two">
  <div class="card">
    <div class="k" style="margin-bottom:8px;">Live Camera Feed (Auto-ON on IR)</div>
    <div class="cambox">
      <img id="camImg" alt="Live camera feed">
      <span id="camPlaceholder">Camera Standby (turns ON when IR triggers)</span>
    </div>
    <div class="row">
      <button id="btnCam" class="pri" onclick="toggleCam()">Camera ON</button>
      <button id="btnFlash" onclick="toggleFlash()">Flash OFF</button>
      <button onclick="snapOnce()">Snapshot</button>
    </div>
  </div>

  <div class="card">
    <div class="k" style="margin-bottom:8px;">Manual Dispense & Controls</div>
    <div class="row" id="portionRow">
      <button onclick="setPortion(10)" data-g="10">10 g</button>
      <button class="act" onclick="setPortion(20)" data-g="20">20 g</button>
      <button onclick="setPortion(30)" data-g="30">30 g</button>
      <button onclick="setPortion(50)" data-g="50">50 g</button>
    </div>
    <div class="row">
      <label style="font-size:13px;display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="chkForce"> Override T-min cooldown
      </label>
    </div>
    <div class="row">
      <button class="pri" onclick="feedNow()">Dispense Now</button>
      <button class="dan" onclick="postApi('/api/abort')">Abort</button>
      <button onclick="postApi('/api/tare')">Tare (0 g)</button>
      <button onclick="postApi('/api/clear')">Clear Fault</button>
    </div>

    <div class="k" style="margin-top:18px;margin-bottom:4px;">Dispensing Rules</div>
    <div class="field">
      <div><strong>Cooldown T (minutes)</strong><div class="sub">No food dispensed again within T min</div></div>
      <input type="number" id="inCd" min="0" max="1440" value="10">
    </div>
    <div class="field">
      <div><strong>Max Bowl Weight (g)</strong><div class="sub">Blocks dispense if bowl exceeds this</div></div>
      <input type="number" id="inBowl" min="20" max="500" value="200">
    </div>
    <div class="field">
      <div><strong>Daily Limit (g)</strong><div class="sub">Total max grams per day</div></div>
      <input type="number" id="inDaily" min="20" max="2000" value="300">
    </div>
    <div class="row">
      <button class="pri" onclick="saveCfg()">Save Rules</button>
    </div>
  </div>
</div>

<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div class="k">Feeding Time Logs (RTC DS3231)</div>
    <button onclick="loadLogs()">Refresh</button>
  </div>
  <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>RTC Time</th><th>Source</th><th>Bowl (Before -> After)</th><th>Dispensed</th><th>Result</th></tr></thead>
      <tbody id="logBody"><tr><td colspan="5" style="color:var(--muted)">No logs yet.</td></tr></tbody>
    </table>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
let portion=20, camOn=false, flashOn=false, maxBowl=200, cdMin=10, camTimer=null;
function msg(t){const el=document.getElementById('toast');el.textContent=t;el.style.display='block';clearTimeout(el._t);el._t=setTimeout(()=>el.style.display='none',3200);}
function setPortion(g){portion=g;document.querySelectorAll('#portionRow button').forEach(b=>b.classList.toggle('act',Number(b.dataset.g)===g));}
async function postApi(url,body){
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) msg(d.error||'Request failed ('+r.status+')');
    else msg('Sent: '+url.replace('/api/',''));
    return r.ok?d:null;
  }catch(e){msg('Connection error');return null;}
}
function feedNow(){postApi('/api/feed',{grams:portion,force:document.getElementById('chkForce').checked});}
async function saveCfg(){
  const payload={cooldown_min:Number(document.getElementById('inCd').value),leftover_g:Number(document.getElementById('inBowl').value),daily_g:Number(document.getElementById('inDaily').value),overshoot_g:3,require_pet:false};
  const ok=await postApi('/api/config',payload);
  if(ok){cdMin=payload.cooldown_min;maxBowl=payload.leftover_g;msg('Rules saved');}
}
async function syncTime(){
  const n=new Date();
  await postApi('/api/time',{year:n.getFullYear(),month:n.getMonth()+1,day:n.getDate(),hour:n.getHours(),minute:n.getMinutes(),second:n.getSeconds()});
}
function setCamUi(on){
  camOn=on;
  const img=document.getElementById('camImg'), ph=document.getElementById('camPlaceholder'), btn=document.getElementById('btnCam');
  btn.textContent=on?'Camera OFF':'Camera ON';
  if(on){
    img.style.display='block'; ph.style.display='none';
    if(!camTimer){snapOnce(); camTimer=setInterval(snapOnce,450);}
  }else{
    clearInterval(camTimer); camTimer=null;
    img.style.display='none'; ph.style.display='block';
  }
}
async function toggleCam(){const d=await postApi('/api/camera',{on:!camOn}); if(d) setCamUi(!!d.on);}
async function toggleFlash(){const d=await postApi('/api/flash',{on:!flashOn}); if(d){flashOn=d.flash==='ON'; document.getElementById('btnFlash').textContent=flashOn?'Flash ON':'Flash OFF';}}
function snapOnce(){const img=document.getElementById('camImg'); img.src='/api/snapshot.jpg?t='+Date.now();}

function applyTelem(t,link){
  const bl=document.getElementById('bLink');
  if(link!==undefined){bl.textContent=link?'UART: LINK':'UART: OFF'; bl.className='badge '+(link?'ok':'bad');}
  if(!t) return;
  document.getElementById('bTime').textContent=t.t||'--:--:--';
  document.getElementById('vWeight').textContent=(Number(t.w)||0).toFixed(1)+' g';
  document.getElementById('vBowlGuard').textContent=(t.w>maxBowl)?('BLOCKED (> '+maxBowl+' g)'):('Limit: '+maxBowl+' g');
  const hop=Number(t.hop)||0;
  document.getElementById('vHop').textContent=hop+' %';
  const bar=document.getElementById('hopBar');
  bar.style.width=hop+'%'; bar.style.background=hop<15?'#dc2626':hop<35?'#d97706':'#2f7d4e';
  document.getElementById('lowAlert').style.display=hop<15?'block':'none';
  const cd=Number(t.cd)||0;
  document.getElementById('vCd').textContent=cd>0?(Math.floor(cd/60)+'m '+String(cd%60).padStart(2,'0')+'s'):'READY';
  document.getElementById('vCdSub').textContent='Barrier T = '+cdMin+' min';
  document.getElementById('vState').textContent=t.st||'IDLE';
  document.getElementById('vIr').textContent='IR: '+(t.ir?'PET DETECTED':'Clear')+' | Today: '+(Number(t.day)||0).toFixed(1)+' g';
  if(typeof t.cam==='number' && Boolean(t.cam)!==camOn) setCamUi(Boolean(t.cam));
}

function renderLogs(arr){
  const tb=document.getElementById('logBody');
  if(!arr||!arr.length){tb.innerHTML='<tr><td colspan="5" style="color:var(--muted)">No logs yet.</td></tr>';return;}
  tb.innerHTML=arr.map(r=>{
    const src=r.src==='I'?'IR Auto':r.src==='S'?'Scheduled':'Manual';
    return `<tr><td>${r.ts||''}</td><td>${src}</td><td>${r.w0} g -> ${r.w1} g</td><td><b>${r.d} g</b></td><td>${r.res}</td></tr>`;
  }).join('');
}

async function loadInitial(){
  try{
    const st=await (await fetch('/api/status')).json();
    applyTelem(st.telem, st.link);
    if(typeof st.cam==='boolean') setCamUi(st.cam);
  }catch(e){}
  try{
    const cfg=await (await fetch('/api/config')).json();
    if(cfg.cooldown_min!==undefined){cdMin=cfg.cooldown_min;document.getElementById('inCd').value=cdMin;}
    if(cfg.leftover_g!==undefined){maxBowl=cfg.leftover_g;document.getElementById('inBowl').value=maxBowl;}
    if(cfg.daily_g!==undefined){document.getElementById('inDaily').value=cfg.daily_g;}
  }catch(e){}
  loadLogs();
}
async function loadLogs(){
  try{const arr=await (await fetch('/api/log')).json(); renderLogs(arr);}catch(e){}
}

function connectSse(){
  const es=new EventSource('/events');
  es.addEventListener('telemetry',e=>{try{applyTelem(JSON.parse(e.data),true);}catch(_){}});
  es.addEventListener('pet',()=>{msg('IR triggered: Camera ON'); setCamUi(true);});
  es.addEventListener('camera',e=>{try{const d=JSON.parse(e.data); setCamUi(!!d.on);}catch(_){}});
  es.addEventListener('log',()=>{loadLogs();});
  es.addEventListener('low_food',e=>{try{const d=JSON.parse(e.data); msg('Low Food Warning: '+d.pct+'%'); document.getElementById('lowAlert').style.display='block';}catch(_){}});
  es.addEventListener('error',e=>{if(e.data){try{const d=JSON.parse(e.data); msg(d.err||d.nak||'Device alert');}catch(_){}}});
}
loadInitial();
connectSse();
setInterval(async()=>{try{const st=await(await fetch('/api/status')).json();applyTelem(st.telem,st.link);}catch(_){}},4000);
</script>
</body>
</html>
)rawliteral";

bool authed(AsyncWebServerRequest* req) {
  if (!REQUIRE_API_KEY) return true;
  if (req->hasHeader("X-API-Key")) {
    return req->header("X-API-Key") == API_KEY;
  }
  return false;
}

void sendUartCmd(const String& cmd) {
  U1Serial.print("<" + cmd + ">\n");
}

void pushLog(const String& jsonLine) {
  logRing[logHead] = jsonLine;
  logHead = (logHead + 1) % MAX_LOGS;
  if (logCount < MAX_LOGS) logCount++;
}

String buildLogArrayJson() {
  String out = "[";
  for (int i = 0; i < logCount; i++) {
    int idx = (logHead - 1 - i + MAX_LOGS) % MAX_LOGS; // newest first
    if (i > 0) out += ",";
    out += logRing[idx];
  }
  out += "]";
  return out;
}

bool startCamera(bool manualHold) {
  if (manualHold) cameraManualHold = true;
  cameraOffAtMs = millis() + CAM_AUTO_OFF_MS;

  if (cameraActive) {
    events.send("{\"on\":true}", "camera", millis());
    return true;
  }

  pinMode(PWDN_GPIO_NUM, OUTPUT);
  digitalWrite(PWDN_GPIO_NUM, LOW);
  delay(20);

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
  config.xclk_freq_hz = 16000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_QVGA;
  config.jpeg_quality = 14;
  config.fb_count     = 1;

  if (esp_camera_init(&config) == ESP_OK) {
    camJpeg = true;
    cameraActive = true;
  } else {
    esp_camera_deinit();
    config.pixel_format = PIXFORMAT_RGB565;
    if (esp_camera_init(&config) == ESP_OK) {
      camJpeg = false;
      cameraActive = true;
    } else {
      cameraActive = false;
      Serial.println("Camera init failed");
      return false;
    }
  }

  events.send("{\"on\":true}", "camera", millis());
  Serial.println("Camera ON");
  return true;
}

void stopCamera() {
  cameraManualHold = false;
  if (!cameraActive) return;
  esp_camera_deinit();
  pinMode(PWDN_GPIO_NUM, OUTPUT);
  digitalWrite(PWDN_GPIO_NUM, HIGH);
  cameraActive = false;
  events.send("{\"on\":false}", "camera", millis());
  Serial.println("Camera OFF (standby)");
}

String parseCsvTelemToJson(const String& payload) {
  if (payload.startsWith("{")) return payload;

  // Format: HH:MM:SS,w,hop,st,ir,vis,day,gate,cdSec
  String parts[9];
  int idx = 0, start = 0;
  while (idx < 9) {
    int comma = payload.indexOf(',', start);
    if (comma == -1) {
      parts[idx++] = payload.substring(start);
      break;
    }
    parts[idx++] = payload.substring(start, comma);
    start = comma + 1;
  }
  if (idx < 8) return latestTelemetryJson;

  StaticJsonDocument<320> doc;
  doc["t"]    = parts[0];
  doc["w"]    = parts[1].toFloat();
  doc["hop"]  = parts[2].toInt();
  doc["st"]   = parts[3];
  doc["ir"]   = parts[4].toInt();
  doc["vis"]  = parts[5].toInt();
  doc["day"]  = parts[6].toFloat();
  doc["gate"] = parts[7].toInt();
  doc["cd"]   = (idx >= 9) ? parts[8].toInt() : 0;
  doc["cam"]  = cameraActive ? 1 : 0;

  String out;
  serializeJson(doc, out);
  return out;
}

void handleUartPacket(const String& rawLine, unsigned long now) {
  int startIdx = rawLine.indexOf('<');
  int endIdx   = rawLine.lastIndexOf('>');
  if (startIdx == -1 || endIdx == -1 || endIdx <= startIdx) return;

  String line = rawLine.substring(startIdx, endIdx + 1);

  u1LinkActive = true;
  lastU1RxMs = now;

  if (!prevU1LinkActive) {
    prevU1LinkActive = true;
    sendUartCmd("REQ_SYNC");
  }

  if (line.startsWith("<HB")) {
    if (line != "<HB:OK>") {
      U1Serial.print("<HB:OK>\n");
    }
  } else if (line.startsWith("<TELEM:")) {
    String payload = line.substring(7, line.length() - 1);
    latestTelemetryJson = parseCsvTelemToJson(payload);
    events.send(latestTelemetryJson.c_str(), "telemetry", now);
    U1Serial.print("<HB:OK>\n");
  } else if (line.startsWith("<LOG:")) {
    String payload = line.substring(5, line.length() - 1);
    if (payload.startsWith("{")) {
      pushLog(payload);
      events.send(payload.c_str(), "log", now);
    }
  } else if (line.startsWith("<LOG_SYNC:")) {
    String payload = line.substring(10, line.length() - 1);
    if (payload.startsWith("{")) {
      pushLog(payload);
    }
  } else if (line.startsWith("<CFG_SYNC:")) {
    configJson = line.substring(10, line.length() - 1);
  } else if (line.startsWith("<SCHED_SYNC:")) {
    scheduleJson = line.substring(12, line.length() - 1);
  } else if (line.startsWith("<LOW_FOOD")) {
    int pct = 10;
    int colon = line.indexOf(':');
    if (colon != -1) pct = line.substring(colon + 1, line.length() - 1).toInt();
    String p = "{\"pct\":" + String(pct) + "}";
    events.send(p.c_str(), "low_food", now);
  } else if (line == "<PET_DETECTED>") {
    // Switch camera ON when IR triggers and stream live feed to website
    startCamera(false);
    events.send("{\"pet\":1,\"conf\":100}", "pet", now);
    U1Serial.print("<VERDICT:PET>\n");
  } else if (line.startsWith("<ERR:")) {
    String errCode = line.substring(5, line.length() - 1);
    String errJson = "{\"err\":\"" + errCode + "\"}";
    events.send(errJson.c_str(), "error", now);
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // Start camera in standby (PWDN HIGH) until IR triggers or user toggles ON
  pinMode(PWDN_GPIO_NUM, OUTPUT);
  digitalWrite(PWDN_GPIO_NUM, HIGH);
  cameraActive = false;

  // Start UART1 cleanly at 9600 baud (matches ESP32-S UART2)
  U1Serial.setRxBufferSize(1024);
  U1Serial.begin(UART_BAUD, SERIAL_8N1, U1_RX_PIN, U1_TX_PIN);
  Serial.printf("U1Serial started at %lu baud on RX:%d TX:%d\n",
                (unsigned long)UART_BAUD, U1_RX_PIN, U1_TX_PIN);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASS);
  Serial.printf("ESP32-CAM AP '%s' up at http://%s\n", WIFI_SSID, WiFi.softAPIP().toString().c_str());

  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Accept");

  // Embedded IoT Website at http://192.168.4.1/
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send_P(200, "text/html", INDEX_HTML);
  });

  // GET /api/status
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    StaticJsonDocument<512> doc;
    doc["link"]  = u1LinkActive;
    doc["rssi"]  = WiFi.RSSI();
    doc["state"] = "IDLE";
    doc["cam"]   = cameraActive;
    doc["flash"] = flashState;

    StaticJsonDocument<320> telemDoc;
    if (!deserializeJson(telemDoc, latestTelemetryJson)) {
      telemDoc["cam"] = cameraActive ? 1 : 0;
      doc["telem"] = telemDoc;
      if (telemDoc.containsKey("st")) doc["state"] = telemDoc["st"];
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
      int g = doc["grams"] | 20;
      bool force = doc["force"] | false;
      if (g < 5 || g > 200) { req->send(400, "application/json", "{\"error\":\"RANGE\"}"); return; }
      sendUartCmd("FEED_NOW:" + String(g) + "," + String(force ? 1 : 0));
      req->send(202, "application/json", "{\"accepted\":true,\"id\":1}");
    });

  // POST /api/camera
  server.on("/api/camera", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
      StaticJsonDocument<128> doc;
      deserializeJson(doc, data, len);
      bool on = doc["on"] | false;
      if (on) startCamera(true);
      else stopCamera();
      req->send(200, "application/json", cameraActive ? "{\"on\":true}" : "{\"on\":false}");
    });

  // POST /api/flash
  server.on("/api/flash", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
      StaticJsonDocument<128> doc;
      deserializeJson(doc, data, len);
      flashState = doc["on"] | false;
      digitalWrite(FLASH_LED_PIN, flashState ? HIGH : LOW);
      req->send(200, "application/json", flashState ? "{\"flash\":\"ON\"}" : "{\"flash\":\"OFF\"}");
    });

  // POST /api/abort
  server.on("/api/abort", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
    sendUartCmd("ABORT");
    req->send(202, "application/json", "{\"accepted\":true}");
  });

  // POST /api/clear
  server.on("/api/clear", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
    sendUartCmd("CLEAR");
    req->send(202, "application/json", "{\"accepted\":true}");
  });

  // GET & PUT /api/schedule
  server.on("/api/schedule", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", scheduleJson);
  });
  server.on("/api/schedule", HTTP_PUT, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
      scheduleJson = String((char*)data).substring(0, len);
      sendUartCmd("SCHED:" + scheduleJson);
      req->send(202, "application/json", "{\"accepted\":true}");
    });

  // GET /api/log
  server.on("/api/log", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", buildLogArrayJson());
  });

  // GET /api/config & POST /api/config
  server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", configJson);
  });
  server.on("/api/config", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
      String body = String((char*)data).substring(0, len);
      configJson = body;
      sendUartCmd("CFG:" + body);
      req->send(202, "application/json", "{\"accepted\":true}");
    });

  // POST /api/time (Sync DS3231 RTC from browser)
  server.on("/api/time", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
      StaticJsonDocument<192> doc;
      if (deserializeJson(doc, data, len)) {
        req->send(400, "application/json", "{\"error\":\"JSON\"}");
        return;
      }
      int yr = doc["year"] | 2026;
      int mo = doc["month"] | 1;
      int dy = doc["day"] | 1;
      int hh = doc["hour"] | 0;
      int mm = doc["minute"] | 0;
      int ss = doc["second"] | 0;
      char buf[40];
      snprintf(buf, sizeof(buf), "SET_TIME:%d,%d,%d,%d,%d,%d", yr, mo, dy, hh, mm, ss);
      sendUartCmd(String(buf));
      req->send(202, "application/json", "{\"accepted\":true}");
    });

  // GET /api/snapshot.jpg
  server.on("/api/snapshot.jpg", HTTP_GET, [](AsyncWebServerRequest* req) {
    if (!cameraActive) {
      if (req->hasParam("wake")) {
        if (!startCamera(false)) {
          req->send(503, "text/plain", "Camera Init Failed");
          return;
        }
      } else {
        req->send(503, "text/plain", "Camera Standby");
        return;
      }
    }
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      req->send(503, "text/plain", "Camera Frame Busy");
      return;
    }
    AsyncResponseStream* res = req->beginResponseStream("image/jpeg");
    if (camJpeg) {
      res->write(fb->buf, fb->len);
    } else {
      uint8_t* jpg = NULL;
      size_t jpgLen = 0;
      if (!frame2jpg(fb, 80, &jpg, &jpgLen)) {
        esp_camera_fb_return(fb);
        delete res;
        req->send(500, "text/plain", "JPEG Encode Failed");
        return;
      }
      res->write(jpg, jpgLen);
      free(jpg);
    }
    esp_camera_fb_return(fb);
    res->addHeader("Content-Disposition", "inline; filename=capture.jpg");
    res->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    req->send(res);
  });

  // POST /api/tare
  server.on("/api/tare", HTTP_POST, [](AsyncWebServerRequest* req) {
    if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
    sendUartCmd("TARE");
    req->send(202, "application/json", "{\"accepted\":true}");
  });

  // POST /api/calibrate
  server.on("/api/calibrate", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"AUTH\"}"); return; }
      StaticJsonDocument<128> doc;
      deserializeJson(doc, data, len);
      int knownG = doc["known_g"] | 200;
      sendUartCmd("CAL:" + String(knownG));
      req->send(202, "application/json", "{\"accepted\":true}");
    });

  server.onNotFound([](AsyncWebServerRequest* req) {
    if (req->method() == HTTP_OPTIONS) {
      req->send(200);
    } else {
      req->send(404, "text/plain", "Not Found");
    }
  });

  server.addHandler(&events);
  server.begin();

  U1Serial.print("<HB>\n");
}

void loop() {
  unsigned long now = millis();

  if (u1LinkActive && (now - lastU1RxMs > 6000)) {
    u1LinkActive = false;
    prevU1LinkActive = false;
  }

  // Proactive heartbeat so ESP32-S always sees LINK even before telemetry starts
  if (now - lastHbTxMs >= 2000) {
    lastHbTxMs = now;
    U1Serial.print("<HB>\n");
  }

  // Auto-standby camera 60s after IR trigger unless manually held ON
  if (cameraActive && !cameraManualHold && (long)(now - cameraOffAtMs) >= 0) {
    stopCamera();
  }

  while (U1Serial.available()) {
    char c = (char)U1Serial.read();
    if (c == '\n') {
      uartRxBuffer.trim();
      if (uartRxBuffer.length() > 0) {
        handleUartPacket(uartRxBuffer, now);
      }
      uartRxBuffer = "";
    } else if (c != '\r') {
      uartRxBuffer += c;
      if (uartRxBuffer.length() > 768) {
        uartRxBuffer = "";
      }
    }
  }
}