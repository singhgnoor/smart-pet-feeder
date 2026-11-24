import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Scale,
  Wifi,
  Clock,
  AlertTriangle,
  RotateCcw,
  Check,
  WifiOff,
} from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { useConfirm } from '../components/ConfirmDialog';
import { FAULT_INFO } from '../utils/labels';

type SettingsTab = 'general' | 'device' | 'network';

export const SettingsView: React.FC = () => {
  const { config, actions, pending, demo, telemetry, connection, link, rssi, mode, setMode } = useDevice();
  const confirm = useConfirm();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const [cooldownMin, setCooldownMin] = useState<number>(10);
  const [leftoverThreshold, setLeftoverThreshold] = useState<number>(200);
  const [dailyLimit, setDailyLimit] = useState<number>(300);
  const [overshootMargin, setOvershootMargin] = useState<number>(3);
  const [requirePet, setRequirePet] = useState<boolean>(false);
  const [knownMass, setKnownMass] = useState<number>(200);

  useEffect(() => {
    if (config) {
      setCooldownMin(config.cooldownMin ?? 10);
      setLeftoverThreshold(config.leftoverThresholdG ?? 200);
      setDailyLimit(config.dailyLimitG ?? 300);
      setOvershootMargin(config.overshootMarginG ?? 3);
      setRequirePet(config.requirePetDetection ?? false);
    }
  }, [config]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    await actions.saveConfig({
      cooldownMin,
      leftoverThresholdG: leftoverThreshold,
      dailyLimitG: dailyLimit,
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
      body: `Place a known weight of exactly ${knownMass} g onto the bowl before confirming.`,
      confirmLabel: 'Calibrate',
      cancelLabel: 'Cancel',
      emoji: '🎯',
    });
    if (ok) await actions.calibrate(knownMass);
  };

  const handleResetDemo = async () => {
    const ok = await confirm({
      title: 'Reset Demo Data to Default? 🔄',
      body: 'This will restore the original demo telemetry, schedules, and settings.',
      confirmLabel: 'Reset Data',
      cancelLabel: 'Cancel',
      tone: 'danger',
      emoji: '⚠️',
    });
    if (ok && demo) await demo.resetDemo();
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Settings</span>
            <span style={{ fontSize: '24px' }}>⚙️</span>
          </h1>
          <p className="page-header__sub">Configure cooldown barrier T, 200 g bowl guard, HX711 scale, and RTC.</p>
        </div>
      </div>

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
        <button className={`chip ${activeTab === 'general' ? 'chip--active' : ''}`} onClick={() => setActiveTab('general')} style={{ border: 'none' }}>
          Dispensing Rules
        </button>
        <button className={`chip ${activeTab === 'device' ? 'chip--active' : ''}`} onClick={() => setActiveTab('device')} style={{ border: 'none' }}>
          Scale & RTC
        </button>
        <button className={`chip ${activeTab === 'network' ? 'chip--active' : ''}`} onClick={() => setActiveTab('network')} style={{ border: 'none' }}>
          Network & UART Link
        </button>
      </div>

      {activeTab === 'general' && (
        <div className="card">
          <div className="card__header">
            <div>
              <h3 className="card__title">Dispensing & Cooldown Parameters</h3>
              <p className="card__subtitle">Saved directly to ESP32-S NVS memory over UART</p>
            </div>
            <Sliders size={20} color="#567e60" />
          </div>

          <form onSubmit={handleSaveGeneral}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Cooldown Timing Barrier (T)
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Minimum wait time between dispenses based on RTC logs (default 10 minutes).
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min="0"
                    max="1440"
                    step="1"
                    className="input"
                    value={cooldownMin}
                    onChange={(e) => setCooldownMin(Number(e.target.value))}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>min</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Max Bowl Weight Guard
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    No food is dispensed if the bowl already exceeds this weight (default 200 g).
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min="20"
                    max="500"
                    step="10"
                    className="input"
                    value={leftoverThreshold}
                    onChange={(e) => setLeftoverThreshold(Number(e.target.value))}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Daily Feeding Limit
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Maximum total food allowed to dispense per day.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min="20"
                    max="2000"
                    step="10"
                    className="input"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Overshoot Margin
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Closes the servo gate early by this margin to account for falling kibble.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="0.5"
                    className="input"
                    value={overshootMargin}
                    onChange={(e) => setOvershootMargin(Number(e.target.value))}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '14px', marginBottom: '2px' }}>
                    Require Pet Detection for Scheduled Meals
                  </label>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    When enabled, scheduled meals wait for IR/pet presence before dispensing.
                  </p>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={requirePet} onChange={(e) => setRequirePet(e.target.checked)} />
                  <span className="switch__slider" />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button type="submit" className="btn btn--primary" disabled={pending.config}>
                  <Check size={16} />
                  <span>Save Settings</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'device' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {telemetry?.fault && (
            <div className="card" style={{ background: 'var(--status-err-bg)', borderColor: 'var(--status-err-border)', marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <AlertTriangle size={24} color="#cf1322" />
                  <div>
                    <h4 style={{ color: '#cf1322', fontWeight: 800 }}>Active Fault: {telemetry.fault}</h4>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{FAULT_INFO[telemetry.fault].description}</p>
                  </div>
                </div>
                <button className="btn btn--danger" onClick={() => actions.clearFault()} disabled={pending.clear}>
                  Clear Fault
                </button>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">HX711 Load Cell Calibration</h3>
                <p className="card__subtitle">Zero empty bowl and calibrate grams factor</p>
              </div>
              <Scale size={20} color="#567e60" />
            </div>

            <div className="grid-2-col">
              <div style={{ background: 'var(--bg-app)', padding: '20px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontWeight: 700, marginBottom: '6px' }}>Tare Scale</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Zeroes out the empty bowl weight offset in the HX711 register.
                  </p>
                </div>
                <button className="btn btn--secondary" onClick={handleTare} disabled={pending.tare}>
                  Zero / Tare Scale (0 g)
                </button>
              </div>

              <div style={{ background: 'var(--bg-app)', padding: '20px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontWeight: 700, marginBottom: '6px' }}>Calibrate Known Mass</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Place a known mass on the bowl and click Calibrate (saved to NVS).
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Known mass:</span>
                    <input
                      type="number"
                      min="10"
                      max="1000"
                      className="input"
                      value={knownMass}
                      onChange={(e) => setKnownMass(Number(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>g</span>
                  </div>
                </div>
                <button className="btn btn--primary" onClick={handleCalibrate} disabled={pending.calibrate}>
                  Calibrate Scale Factor
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">DS3231 Real-Time Clock</h3>
                <p className="card__subtitle">Current device time: {telemetry?.deviceTime ?? '--:--:--'}</p>
              </div>
              <Clock size={20} color="#567e60" />
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={() => actions.syncTime()} disabled={pending.time || mode === 'mock'}>
                Sync DS3231 RTC from Browser
              </button>
              {demo && (
                <button className="btn btn--danger" onClick={handleResetDemo} disabled={pending.reset} style={{ marginLeft: 'auto' }}>
                  <RotateCcw size={14} />
                  <span>Reset Demo Data</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'network' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">Connection Mode</h3>
                <p className="card__subtitle">Switch between physical ESP32-CAM AP and Demo Simulator</p>
              </div>
              <Wifi size={20} color="#567e60" />
            </div>

            <div className="grid-2-col" style={{ gap: '16px' }}>
              <div
                style={{
                  border: mode === 'hardware' ? '2px solid var(--primary-green)' : '1px solid var(--border-light)',
                  background: mode === 'hardware' ? '#f6ffed' : 'var(--bg-app)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  cursor: 'pointer',
                }}
                onClick={() => setMode('hardware')}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '15px' }}>⚡ Hardware Mode</strong>
                  <input type="radio" name="deviceMode" checked={mode === 'hardware'} onChange={() => setMode('hardware')} />
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Connects to ESP32-CAM AP (PetFeeder @ 192.168.4.1) via REST + SSE.
                </p>
              </div>

              <div
                style={{
                  border: mode === 'mock' ? '2px solid var(--accent-amber)' : '1px solid var(--border-light)',
                  background: mode === 'mock' ? '#fefbe6' : 'var(--bg-app)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  cursor: 'pointer',
                }}
                onClick={() => setMode('mock')}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '15px' }}>🐾 Demo Simulation</strong>
                  <input type="radio" name="deviceMode" checked={mode === 'mock'} onChange={() => setMode('mock')} />
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  In-browser simulation for testing without hardware attached.
                </p>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">Link Status & Diagnostics</h3>
                <p className="card__subtitle">Browser ↔ ESP32-CAM HTTP/SSE and ESP32-CAM ↔ ESP32-S UART (9600 8N1)</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '14px', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <strong style={{ fontSize: '14px', display: 'block' }}>Web App ↔ ESP32-CAM (HTTP / SSE)</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>AP: PetFeeder (http://192.168.4.1)</p>
                </div>
                <span className={`badge ${connection === 'connected' ? 'badge--ok' : 'badge--danger'}`}>
                  {connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting...' : 'Offline'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '14px', borderBottom: '1px solid var(--border-light)' }}>
                <div>
                  <strong style={{ fontSize: '14px', display: 'block' }}>ESP32-CAM ↔ ESP32-S (UART Link)</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>9600 8N1 · ESP32-S IO17→CAM IO13, CAM IO14→ESP32-S IO16</p>
                </div>
                <span className={`badge ${link ? 'badge--ok' : 'badge--danger'}`}>
                  {link ? 'LINK ACTIVE' : 'LINK OFF'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '14px', display: 'block' }}>Target Hardware Address</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Configured in .env / vite.config.ts</p>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--bg-app)', padding: '4px 10px', borderRadius: '4px' }}>
                  http://{import.meta.env.VITE_ESP32_HOST || '192.168.4.1'}:{import.meta.env.VITE_ESP32_PORT || '80'}
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={() => actions.reconnect()} disabled={pending.reconnect}>
                <Wifi size={14} />
                <span>Reconnect</span>
              </button>
              <button className="btn btn--secondary" onClick={() => actions.refreshSnapshot(true)} disabled={pending.snapshot}>
                <span>Test Camera Snapshot</span>
              </button>
              {mode === 'mock' && (
                <button className="btn btn--secondary" onClick={() => demo?.simulateDisconnect()}>
                  <WifiOff size={14} />
                  <span>Simulate Disconnect</span>
                </button>
              )}
              {rssi !== null && (
                <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  RSSI: {rssi} dBm
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
