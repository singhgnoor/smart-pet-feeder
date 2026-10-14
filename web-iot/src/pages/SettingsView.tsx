import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Scale,
  Wifi,
  Eye,
  AlertTriangle,
  RotateCcw,
  Check,
  WifiOff,
} from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { useConfirm } from '../components/ConfirmDialog';
import { FAULT_INFO } from '../utils/labels';

type SettingsTab = 'general' | 'device' | 'camera' | 'network';

export const SettingsView: React.FC = () => {
  const { config, actions, pending, demo, telemetry, connection, link, rssi, mode, setMode } = useDevice();
  const confirm = useConfirm();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Form states for general settings
  const [dailyLimit, setDailyLimit] = useState<number>(300);
  const [leftoverThreshold, setLeftoverThreshold] = useState<number>(30);
  const [overshootMargin, setOvershootMargin] = useState<number>(3);
  const [requirePet, setRequirePet] = useState<boolean>(false);

  // Calibration known mass state
  const [knownMass, setKnownMass] = useState<number>(200);

  useEffect(() => {
    if (config) {
      setDailyLimit(config.dailyLimitG);
      setLeftoverThreshold(config.leftoverThresholdG);
      setOvershootMargin(config.overshootMarginG);
      setRequirePet(config.requirePetDetection);
    }
  }, [config]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    await actions.saveConfig({
      dailyLimitG: dailyLimit,
      leftoverThresholdG: leftoverThreshold,
      overshootMarginG: overshootMargin,
      requirePetDetection: requirePet,
    });
  };

  const handleTare = async () => {
    const ok = await confirm({
      title: 'Tare the Scale? ⚖️',
      body: 'Make sure the food bowl is empty and resting cleanly on the scale platform.',
      confirmLabel: 'Tare (0 g)',
      cancelLabel: 'Cancel',
      emoji: '⚖️',
    });
    if (ok) await actions.tare();
  };

  const handleCalibrate = async () => {
    const ok = await confirm({
      title: `Calibrate with ${knownMass} g?`,
      body: `Place a verified reference calibration weight of exactly ${knownMass} g onto the center of the bowl before confirming.`,
      confirmLabel: 'Calibrate',
      cancelLabel: 'Cancel',
      emoji: '🎯',
    });
    if (ok) await actions.calibrate(knownMass);
  };

  const handleClearFault = async () => {
    await actions.clearFault();
  };

  const handleResetDemo = async () => {
    const ok = await confirm({
      title: 'Reset Demo Data to Default? 🔄',
      body: 'This will restore the original demo telemetry, feeding schedules, 7-day history, and settings.',
      confirmLabel: 'Reset Data',
      cancelLabel: 'Cancel',
      tone: 'danger',
      emoji: '⚠️',
    });
    if (ok && demo) await demo.resetDemo();
  };

  return (
    <div className="settings-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Settings</span>
            <span style={{ fontSize: '24px' }}>⚙️</span>
          </h1>
          <p className="page-header__sub">Configure feeder limits, sensors, and simulation parameters.</p>
        </div>
      </div>

      {/* Settings Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          background: 'var(--bg-sidebar)',
          padding: '6px',
          borderRadius: 'var(--radius-full)',
          width: 'fit-content',
          maxWidth: '100%',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          marginBottom: '24px',
        }}
      >
        <button
          className={`chip ${activeTab === 'general' ? 'chip--active' : ''}`}
          onClick={() => setActiveTab('general')}
          style={{ border: 'none' }}
        >
          General
        </button>
        <button
          className={`chip ${activeTab === 'device' ? 'chip--active' : ''}`}
          onClick={() => setActiveTab('device')}
          style={{ border: 'none' }}
        >
          Device Controls
        </button>
        <button
          className={`chip ${activeTab === 'camera' ? 'chip--active' : ''}`}
          onClick={() => setActiveTab('camera')}
          style={{ border: 'none' }}
        >
          Camera & AI
        </button>
        <button
          className={`chip ${activeTab === 'network' ? 'chip--active' : ''}`}
          onClick={() => setActiveTab('network')}
          style={{ border: 'none' }}
        >
          Network & Hardware
        </button>
      </div>

      {/* Tab: General Settings */}
      {activeTab === 'general' && (
        <div className="card">
          <div className="card__header">
            <div>
              <h3 className="card__title">Feeding Parameters</h3>
              <p className="card__subtitle">Hardware closed-loop dispensing tunables</p>
            </div>
            <Sliders size={20} color="#567e60" />
          </div>

          <form onSubmit={handleSaveGeneral}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Daily Feeding Limit */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Daily Feeding Limit
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Maximum total food allowed to dispense per day. Skips feeding if exceeded.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min="10"
                    max="1000"
                    step="10"
                    className="input"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                </div>
              </div>

              {/* Leftover Food Threshold */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Leftover Food Threshold
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Skip feeding if bowl already has more than this (prevents stale kibble overflow).
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min="5"
                    max="150"
                    step="5"
                    className="input"
                    value={leftoverThreshold}
                    onChange={(e) => setLeftoverThreshold(Number(e.target.value))}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                </div>
              </div>

              {/* Overshoot Margin */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Overshoot Margin (ovs)
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Closes the servo gate early by this amount to account for falling kibble.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    step="0.5"
                    className="input"
                    value={overshootMargin}
                    onChange={(e) => setOvershootMargin(Number(e.target.value))}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                </div>
              </div>

              {/* Require Pet Detection */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '16px',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Require Pet Detection Before Feeding
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    When enabled, scheduled feedings enter WAIT_PET and dispense only when pet is present.
                  </p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={requirePet}
                    onChange={(e) => setRequirePet(e.target.checked)}
                  />
                  <span className="switch__slider" />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={pending.config}
                >
                  <Check size={16} />
                  <span>Save Settings</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Tab: Device Controls & Calibration */}
      {activeTab === 'device' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Active Fault Alert if present */}
          {telemetry?.fault && (
            <div
              className="card"
              style={{
                background: 'var(--status-err-bg)',
                borderColor: 'var(--status-err-border)',
                marginBottom: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <AlertTriangle size={24} color="#cf1322" />
                  <div>
                    <h4 style={{ color: '#cf1322', fontWeight: 800 }}>
                      Active Fault: {telemetry.fault}
                    </h4>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      {FAULT_INFO[telemetry.fault].description}
                    </p>
                  </div>
                </div>
                <button className="btn btn--danger" onClick={handleClearFault} disabled={pending.clear}>
                  Clear Fault
                </button>
              </div>
            </div>
          )}

          {/* Scale Calibration Card */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">Load Cell Scale Calibration</h3>
                <p className="card__subtitle">HX711 24-bit ADC Tare and Calibration</p>
              </div>
              <Scale size={20} color="#567e60" />
            </div>

            <div className="grid-2-col">
              {/* Tare */}
              <div
                style={{
                  background: 'var(--bg-app)',
                  padding: '20px',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <h4 style={{ fontWeight: 700, marginBottom: '6px' }}>Tare Scale</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Zeroes out the empty bowl weight offset in the HX711 register.
                  </p>
                </div>
                <button
                  className="btn btn--secondary"
                  onClick={handleTare}
                  disabled={pending.tare}
                >
                  Zero / Tare Scale (0 g)
                </button>
              </div>

              {/* Known Mass Calibration */}
              <div
                style={{
                  background: 'var(--bg-app)',
                  padding: '20px',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <h4 style={{ fontWeight: 700, marginBottom: '6px' }}>Calibrate Known Mass</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Calculates counts-per-gram calibration factor using a known weight.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Known mass:</span>
                    <input
                      type="number"
                      min="50"
                      max="1000"
                      className="input"
                      value={knownMass}
                      onChange={(e) => setKnownMass(Number(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                  </div>
                </div>

                <button
                  className="btn btn--primary"
                  onClick={handleCalibrate}
                  disabled={pending.calibrate}
                >
                  Calibrate Scale Factor
                </button>
              </div>
            </div>
          </div>

          {/* Fault Simulation & Factory Reset Card */}
          <div className="card">
            <div className="card__header">
              <div>
                <h3 className="card__title">Diagnostics & Reset</h3>
                <p className="card__subtitle">Test fault handling or restore initial demo data</p>
              </div>
              <RotateCcw size={20} color="#e6982b" />
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                className="btn btn--secondary"
                onClick={() => demo?.injectFault('JAM')}
              >
                Simulate Kibble Jam (JAM)
              </button>
              <button
                className="btn btn--secondary"
                onClick={() => demo?.injectFault('SENSOR')}
              >
                Simulate Sensor Error (SENSOR)
              </button>
              <button
                className="btn btn--danger"
                onClick={handleResetDemo}
                disabled={pending.reset}
                style={{ marginLeft: 'auto' }}
              >
                <RotateCcw size={14} />
                <span>Reset Demo Data</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Camera & AI */}
      {activeTab === 'camera' && (
        <div className="card">
          <div className="card__header">
            <div>
              <h3 className="card__title">Edge AI Vision Parameters</h3>
              <p className="card__subtitle">ESP32-CAM TinyML model controls</p>
            </div>
            <Eye size={20} color="#567e60" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '16px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <div>
                <strong style={{ fontSize: '14px', display: 'block', marginBottom: '2px' }}>
                  Model Architecture
                </strong>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  MobileNetV1 0.25 96x96 INT8 quantized (Edge Impulse Arduino library).
                </p>
              </div>
              <span className="badge badge--ok">Active</span>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '16px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <div>
                <strong style={{ fontSize: '14px', display: 'block', marginBottom: '2px' }}>
                  Temporal Voting Policy
                </strong>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Captures 3 frames 250 ms apart. Requires ≥2 frames with ≥75% confidence to confirm pet.
                </p>
              </div>
              <span className="badge badge--ok">2 of 3 votes (75%)</span>
            </div>

            <div>
              <strong style={{ fontSize: '14px', display: 'block', marginBottom: '8px' }}>
                Test Simulated Detections
              </strong>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => demo?.triggerVisit('pet')}
                >
                  Trigger Pet (Dog 🐶)
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => demo?.triggerVisit('person')}
                >
                  Trigger Person (Owner 👤)
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => demo?.triggerVisit('other')}
                >
                  Trigger Shadow / Moving Object
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Network & Hardware */}
      {activeTab === 'network' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* 1. Mode Selector Card */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">Connection Mode</h3>
                <p className="card__subtitle">Choose between live hardware communication and demo simulator</p>
              </div>
              <Wifi size={20} color="#567e60" />
            </div>

            <div className="grid-2-col" style={{ gap: '16px' }}>
              {/* Option 1: Hardware Mode */}
              <div
                style={{
                  border: mode === 'hardware' ? '2px solid var(--primary-green)' : '1px solid var(--border-light)',
                  background: mode === 'hardware' ? '#f6ffed' : 'var(--bg-app)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => setMode('hardware')}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>⚡</span>
                    <strong style={{ fontSize: '15px', color: 'var(--text-main)' }}>Hardware Mode</strong>
                  </div>
                  <input
                    type="radio"
                    name="deviceMode"
                    checked={mode === 'hardware'}
                    onChange={() => setMode('hardware')}
                  />
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Connects to physical ESP32-CAM via REST API and Server-Sent Events (SSE) stream. Forwards requests through Vite dev proxy.
                </p>
              </div>

              {/* Option 2: Mock Demo Mode */}
              <div
                style={{
                  border: mode === 'mock' ? '2px solid var(--accent-amber)' : '1px solid var(--border-light)',
                  background: mode === 'mock' ? '#fefbe6' : 'var(--bg-app)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => setMode('mock')}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>🐾</span>
                    <strong style={{ fontSize: '15px', color: 'var(--text-main)' }}>Demo Simulation</strong>
                  </div>
                  <input
                    type="radio"
                    name="deviceMode"
                    checked={mode === 'mock'}
                    onChange={() => setMode('mock')}
                  />
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Runs a full in-browser IoT simulation of both U1 (WROOM sensor hub) and U2 (CAM web server) with synthetic sensor events.
                </p>
              </div>
            </div>
          </div>

          {/* 2. Network Diagnostics Card */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">Link Status & Telemetry Diagnostics</h3>
                <p className="card__subtitle">Independent status of browser HTTP/SSE link and microcontrollers UART bus</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Web App to ESP32-CAM HTTP/SSE Link */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '14px',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <div>
                  <strong style={{ fontSize: '14px', display: 'block', marginBottom: '2px' }}>
                    Web App ↔ ESP32-CAM (HTTP / SSE)
                  </strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Browser EventSource stream (`/events`) and REST endpoints (`/api/*`).
                  </p>
                </div>
                <span className={`badge ${connection === 'connected' ? 'badge--ok' : 'badge--danger'}`}>
                  {connection === 'connected' ? 'Connected (Online)' : connection === 'connecting' ? 'Connecting...' : 'Disconnected (Offline)'}
                </span>
              </div>

              {/* ESP32-CAM to ESP32-WROOM UART Bus Link */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '14px',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <div>
                  <strong style={{ fontSize: '14px', display: 'block', marginBottom: '2px' }}>
                    ESP32-CAM ↔ ESP32-WROOM (UART Bus Link)
                  </strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    115200 8N1 serial bus with 2s heartbeat &lt;HB&gt;. Times out after 6s.
                  </p>
                </div>
                <span className={`badge ${link ? 'badge--ok' : 'badge--danger'}`}>
                  {link ? 'Link Active (HB ok)' : 'Link Down (503)'}
                </span>
              </div>

              {/* Wi-Fi RSSI */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '14px',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <div>
                  <strong style={{ fontSize: '14px', display: 'block', marginBottom: '2px' }}>
                    Wi-Fi Signal (RSSI)
                  </strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Reported by ESP32 Wi-Fi station.
                  </p>
                </div>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
                  {rssi ? `${rssi} dBm` : 'N/A'}
                </span>
              </div>

              {/* Target Address Info */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '14px',
                }}
              >
                <div>
                  <strong style={{ fontSize: '14px', display: 'block', marginBottom: '2px' }}>
                    Target Hardware Address
                  </strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Configured in `.env` (proxied by Vite during development).
                  </p>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--bg-app)', padding: '4px 10px', borderRadius: '4px' }}>
                  http://{import.meta.env.VITE_ESP32_HOST || '192.168.1.100'}:{import.meta.env.VITE_ESP32_PORT || '80'}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Actions / Controls depending on Mode */}
          <div className="card">
            <div className="card__header">
              <div>
                <h3 className="card__title">
                  {mode === 'hardware' ? 'Hardware Diagnostics & Reconnect' : 'Simulation Test Controls'}
                </h3>
                <p className="card__subtitle">
                  {mode === 'hardware' ? 'Interact directly with physical hardware link' : 'Simulate edge cases in software'}
                </p>
              </div>
            </div>

            {mode === 'hardware' ? (
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn--primary"
                  onClick={() => actions.reconnect()}
                  disabled={pending.reconnect}
                >
                  <Wifi size={14} />
                  <span>Reconnect to ESP32</span>
                </button>
                <button
                  className="btn btn--secondary"
                  onClick={() => actions.refreshSnapshot()}
                  disabled={pending.snapshot}
                >
                  <span>Test Camera Snapshot</span>
                </button>
                {connection !== 'connected' && (
                  <p style={{ fontSize: '13px', color: '#cf1322', width: '100%', marginTop: '8px' }}>
                    ⚠️ Hardware device unreachable at {import.meta.env.VITE_ESP32_HOST || '192.168.1.100'}. Switch to "Demo Simulation" mode above if physical hardware is not powered on.
                  </p>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn--secondary"
                  onClick={() => demo?.simulateDisconnect()}
                >
                  <WifiOff size={14} />
                  <span>Simulate Connection Loss</span>
                </button>
                <button
                  className="btn btn--primary"
                  onClick={() => actions.reconnect()}
                  disabled={pending.reconnect}
                >
                  <Wifi size={14} />
                  <span>Reconnect Feeder</span>
                </button>
                <button
                  className="btn btn--amber"
                  onClick={() => demo?.refillHopper()}
                >
                  Refill Hopper (100%)
                </button>
                <button
                  className="btn btn--secondary"
                  onClick={() => demo?.emptyBowl()}
                >
                  Lick Bowl Clean (0 g)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
