# PawBite · Smart Pet Feeder Control Hub

A responsive, polished, fully functional web application that serves as the IoT control hub for the **Smart Pet Feeder** (ESP32-CAM + ESP32-WROOM-32).

The frontend design is inspired by the **PawBite** design reference with a warm cream/beige aesthetic, soft rounded cards, storybook pet illustrations, real-time telemetry, and mock IoT simulation.

---

## 🐾 Key Features

1. **Overview Dashboard (Home)**:
   - Live greeting with auto-updating clock and pet profile avatar.
   - 4 Quick Stat Cards: System Status, Hopper Level (%), Bowl Weight (g), Next Scheduled Meal.
   - Featured Pet Banner with adorable Golden Retriever puppy and kitten storybook artwork.
   - Today's Telemetry summary (Total Dispensed today, Pet visits detected today, Gate status, Hopper progress bar).
   - Recent activity list with status badges.

2. **Manual Feed (Feed Now)**:
   - Quick portion chips (`10 g`, `20 g`, `30 g`, `50 g`, `Custom` with 5–250 g slider).
   - Prominent `Feed Now 🥣` button with confirmation dialog.
   - Closed-loop simulated feeding state machine (`PRECHECK` → `DISPENSING` → `WIGGLE` → `SETTLING` → `TOPUP` → `REPORT` → `IDLE`).
   - Live Dispense Indicator with real-time grams counter and `Abort Feeding ✋` button.
   - Cute puppy paw-waving illustration.
   - Recent Manual Feeds log table.

3. **Feeding Schedule**:
   - Master `Enable Schedule` toggle.
   - 4 independent meal slots (Meal 1 Breakfast, Meal 2 Lunch, Meal 3 Dinner, Meal 4 Late Snack).
   - Editable hours, minutes, and portions (5–250 g) with persistent storage in localStorage.
   - Live countdown timer to next automatic feed.
   - Prevents duplicate feedings on the same day via daily token tracking.

4. **Live Pet Camera & TinyML Vision**:
   - Camera snapshot view with low-angle point of view showing a golden retriever dog.
   - Simulated watermark overlay with timestamp and resolution.
   - `[ Snapshot ]` button to trigger fresh camera capture.
   - `[ Start AI Check ]` button to trigger edge TinyML classification.
   - AI Detection panel showing Pet Detected status, 94% confidence meter, and recent visit timeline.
   - 3-frame 250 ms temporal voting implementation (≥2 frames ≥75% confidence).

5. **Feeding Logs**:
   - Complete history table with filtering: All Events, Completed Meals, Skipped, Aborted/Timeouts, Faults.
   - Source filter (All Sources, Manual Feeds Only, Scheduled Only).
   - Detailed event metrics: Target grams, dispensed grams, bowl weight change (w0 → w1), duration, and wiggles.

6. **Analytics & Trends**:
   - Total food dispensed with Recharts daily bar chart (Mon–Sun).
   - Feeding events count sparkline.
   - Bowl weight continuous trend line/area chart showing consumption and refills throughout the day.

7. **Device Status**:
   - 4 Graphical Sensor cards:
     - Hopper level graphic with kibble silo (~1.2 kg remaining).
     - Bowl weight graphic with live HX711 ADC reading.
     - IR motion sensor graphic (SSR1017 debounced).
     - Gate servo status graphic (MG996R 10° closed / 80° open).
   - System Health Status banner with Clear Fault action.

8. **Settings & Diagnostics**:
   - General feeding parameters: Daily Feeding Limit (g), Leftover Food Threshold (g), Overshoot Margin (ovs), Require Pet Detection toggle.
   - Device controls: Tare Scale (0 g), Calibrate Scale with known mass (e.g. 200 g), Clear Latched Fault, Reset Demo Data.
   - Camera & AI parameters.
   - Network simulation: Simulate Connection Loss, Reconnect Feeder, Refill Hopper, Empty Bowl.

---

## 🛠️ Technology Stack

- **Framework**: React 18 with TypeScript
- **Bundler**: Vite 6
- **Styling**: Custom modern CSS modules/variables (warm cream palette, no heavy external CSS frameworks)
- **Icons**: Lucide React
- **Charts**: Recharts
- **Storage**: `localStorage` (persists schedules, configuration, calibration, and feeding history)
- **Device Service**: Typed Mock IoT Service architecture mirroring ESP32-CAM REST API & Server-Sent Events

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
Open your browser at `http://localhost:5173`.

### 3. Production Build
```bash
npm run build
```

---

## 📁 Project Structure

```
web-iot/
├── public/
│   └── assets/
│       ├── camera-dog.jpg       # Low-angle realistic pet feeder snapshot
│       ├── pet-duo.jpg          # Golden retriever puppy & kitten storybook banner
│       └── puppy-paw.jpg        # Friendly puppy waving paw illustration
├── src/
│   ├── components/
│   │   ├── ConfirmDialog.tsx    # Accessible modal confirmation
│   │   ├── Sidebar.tsx          # Navigation sidebar with status pill
│   │   ├── ToastProvider.tsx    # Toast notification manager
│   │   └── TopBar.tsx           # Header bar with live clock & Wi-Fi RSSI
│   ├── context/
│   │   └── DeviceContext.tsx    # React state & action store for feeder
│   ├── data/
│   │   └── demoData.ts          # Deterministic demo seed data generator
│   ├── pages/
│   │   ├── AnalyticsView.tsx    # Consumption charts & trends
│   │   ├── DeviceStatusView.tsx # 4 sensor graphics & system health
│   │   ├── FeedingLogsView.tsx  # History table with filtering
│   │   ├── FeedNowView.tsx      # Manual dispensing & live progress
│   │   ├── HomeOverview.tsx     # Overview dashboard & 4 stat cards
│   │   ├── LiveCameraView.tsx   # Pet camera & TinyML detection panel
│   │   ├── ScheduleView.tsx     # 4 meal slots & schedule editor
│   │   └── SettingsView.tsx     # Feeding tunables & device controls
│   ├── services/
│   │   ├── deviceService.ts     # Transport-agnostic DeviceService interface
│   │   ├── mockDevice.ts        # Simulated U1 (WROOM) & U2 (CAM) firmware
│   │   ├── mockSnapshot.ts      # Fallback dynamic SVG scene generator
│   │   └── protocol.ts          # Wire JSON ↔ UI data model mappers
│   ├── styles/
│   │   └── app.css              # Warm cream, rounded PawBite theme CSS
│   ├── types/
│   │   └── device.ts            # Wire types & UI data models
│   ├── utils/
│   │   ├── format.ts            # Formatting helpers (grams, duration, clock)
│   │   ├── labels.ts            # Friendly state, fault, and result labels
│   │   └── schedule.ts          # Next-feed calculator
│   ├── App.tsx                  # Root component & tab router
│   └── main.tsx                 # Entry mount point
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🔌 Hardware Integration & Real ESP32 API

The frontend service layer connects to both real physical hardware and the in-browser simulator via the `DeviceService` contract in [`src/services/deviceService.ts`](src/services/deviceService.ts).

### Dual Operating Modes
1. **Physical Hardware (`hardware`)**:
   Communicates with the real ESP32-CAM REST API & Server-Sent Events (`/events`) stream via the non-buffering Vite proxy.
   - Configured in `web-iot/.env` (the API key is read by the local Vite proxy and is not included in the browser bundle):
     ```bash
     VITE_DEVICE_MODE=hardware
     VITE_ESP32_HOST=192.168.1.100
     VITE_ESP32_PORT=80
     DEVICE_API_KEY=replace-with-a-unique-device-key
     ```
   - In Settings ➔ "Network & Hardware", users can view connection diagnostics, test snapshots, and reconnect.
2. **Demo Simulation (`mock`)**:
   Runs an in-browser simulation of the closed-loop state machine, load cell ADC, servo gate, and TinyML vision.

### Protocol Endpoints
- `GET /api/status` → `getStatus()`
- `POST /api/feed` with `{"grams": 50}` → `feed(grams)` (requires `X-API-Key`)
- `POST /api/abort` → `abort()` (requires `X-API-Key`)
- `POST /api/clear` → `clearFault()` (requires `X-API-Key`)
- `GET /api/schedule` → `getSchedule()`
- `PUT /api/schedule` → `putSchedule(slots)` (requires `X-API-Key`)
- `GET /api/log` → `getLog()`
- `GET /api/snapshot.jpg` → `getSnapshot()`
- `POST /api/tare` → `tare()` (requires `X-API-Key`)
- `POST /api/calibrate` with `{"known_g": 200}` → `calibrate(knownG)` (requires `X-API-Key`)
- `POST /api/config` → `setConfig(config)` (requires `X-API-Key`)
- `GET /events` (SSE stream) → `subscribe(listener)`

For complete architectural details, firmware audit findings, and hardware verification steps, refer to [**HARDWARE_INTEGRATION_REPORT.md**](../HARDWARE_INTEGRATION_REPORT.md).
