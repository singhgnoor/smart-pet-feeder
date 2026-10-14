# Smart Pet Feeder V2.1 - Sensor Hub Architecture

Hey guys! This is the main brain for the **ESP32-WROOM-32D** (U1). We completely rewrote this from the V1 concept because trying to do Wi-Fi, Camera AI, and real-time hardware on a single chip was causing huge pin conflicts and hardware crashes.

This chip is now entirely dedicated to **real-time operations**. It doesn't know about Wi-Fi, web servers, or image processing. It just reads sensors, handles the math, moves the servo, and keeps the pet alive.

## The Asynchronous "Non-Blocking" Design
If you look at the `loop()`, you'll notice there are absolutely no `delay()` calls (with the exception of a couple tiny hardware pulses). 

**Why did we do this?**
If we use `delay(8000)` while the servo is pouring food, the MCU completely freezes. It wouldn't be able to read the weight scale (HX711) to know when to stop, it wouldn't update the OLED screen, and it wouldn't catch incoming UART messages from the ESP32-CAM. 

Instead, we use a **timer-based polling architecture**:
*   Every time the `loop()` runs, it grabs `now = millis()`.
*   It checks 6 independent "services" (e.g., `hxService`, `usService`, `displayService`).
*   Each service checks if enough time has passed since it last ran (e.g., `now - lastDisplayMs > 500`). If yes, it does its quick task and exits. 
*   **Result:** The loop runs thousands of times a second. The scale is weighed continuously, the UI feels snappy, and the ultrasonic sensor triggers in the background.

## The 9-State Dispensing Machine
The actual feeding logic is wrapped in `feederTask()`. It operates as a strict State Machine. This prevents spaghetti code and weird edge cases (like the machine trying to pour food while it's already pouring).

1.  **IDLE:** Normal resting state. Servo is detached so it doesn't hum, heat up, or draw power.
2.  **PRECHECK:** When a feed is requested, it checks safety rules: Is the bowl already full? Did we hit the daily limit? Is the hopper empty? 
3.  **WAIT_PET:** (Optional) If enabled, it waits for the ESP32-CAM to reply `<VERDICT:PET>` before opening the gate.
4.  **DISPENSE:** Gate opens to 80°. It constantly checks the scale. **Crucial detail:** It closes early by `cfg_ovs` (default 3g) because a few grams of kibble are usually falling through the air when the gate shuts!
5.  **WIGGLE:** If the weight stops rising (jammed kibble), it flutters the gate rapidly to break the bridge.
6.  **SETTLE:** Gate is closed. Waits 1.5 seconds for vibrations to die out before taking a final trusted weight.
7.  **TOPUP:** If the pour was a bit short, it opens the gate for a rapid 250ms pulse.
8.  **REPORT:** Logs the final amount to NVS (flash memory) and sends the telemetry over UART to the CAM.
9.  **FAULT:** Hard lock. Triggers if the scale unplugs or the motor jams 3 times. Requires human intervention.

## Power Loss Protection (NVS)
Nothing is worse than a brief power outage causing the machine to reboot and immediately feed your dog *again* because it thinks it missed the schedule. We use `Preferences.h` (ESP32 Non-Volatile Storage) to save `lastFedToken` and `dayGramsDispensed` directly to the flash memory *before* the gate ever opens. If power drops, it boots up, sees the token matches, and safely ignores the schedule slot.

## The UART Bridge
Because this chip doesn't have Wi-Fi, it relies on the ESP32-CAM (`U2`) to act as its router. They talk over pins `TX2` and `RX2` using a simple string protocol.
*   **Heartbeats:** They ping each other every 2 seconds (`<HB:uptime>`). If the CAM dies, the OLED changes from `LINK` to `OFF`.
*   **Telemetry:** When food is low, U1 shouts `<LOW_FOOD>`. When the IR sensor trips, it shouts `<PET_DETECTED>`.
