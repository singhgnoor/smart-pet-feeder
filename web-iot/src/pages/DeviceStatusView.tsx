import React from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Radio } from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { FAULT_INFO } from '../utils/labels';

export const DeviceStatusView: React.FC = () => {
  const { telemetry, connection, actions, pending, mode } = useDevice();

  const isOnline = connection === 'connected';
  const isFault = telemetry?.state === 'FAULT';

  const hopperPct = telemetry?.hopperPct ?? 0;
  const bowlWeight = telemetry?.bowlWeightG ?? 0;
  const isPetPresent = telemetry?.petPresent ?? false;
  const isGateOpen = telemetry?.gateOpen ?? false;

  const hopperKgRemaining = ((hopperPct / 100) * 1.8).toFixed(1);

  return (
    <div className="status-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Device Status</span>
            <span style={{ fontSize: '24px' }}>⚙️</span>
          </h1>
          <p className="page-header__sub">Live sensor readings and system health.</p>
        </div>

        <button
          className="btn btn--secondary btn--sm"
          onClick={() => actions.reconnect()}
          disabled={pending.reconnect}
        >
          <RefreshCw size={14} className={pending.reconnect ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* 4 Sensor Visual Cards */}
      <div className="grid-status-sensors">
        {/* 1. Hopper Level */}
        <div className="card" style={{ padding: '20px', textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: '8px' }}>
            Hopper Level
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-main)', marginBottom: '12px' }}>
            {telemetry ? `${hopperPct}%` : '—'}
          </div>

          {/* Visual Silo Graphic */}
          <div
            style={{
              width: '64px',
              height: '80px',
              margin: '0 auto 12px auto',
              border: '2px solid #d1c8b8',
              borderRadius: '8px 8px 16px 16px',
              background: '#faf7f1',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: `${hopperPct}%`,
                background:
                  hopperPct < 15
                    ? '#e5484d'
                    : hopperPct < 35
                    ? '#e6982b'
                    : 'var(--primary-green)',
                transition: 'height 0.4s ease',
              }}
            />
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            {telemetry ? `~${hopperKgRemaining} kg remaining` : 'No verified reading'}
          </div>
        </div>

        {/* 2. Bowl Weight */}
        <div className="card" style={{ padding: '20px', textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: '8px' }}>
            Bowl Weight
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-main)', marginBottom: '12px' }}>
            {telemetry ? `${bowlWeight.toFixed(0)} g` : '—'}
          </div>

          {/* Visual Bowl Graphic */}
          <div
            style={{
              width: '74px',
              height: '80px',
              margin: '0 auto 12px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '44px',
            }}
          >
            🥣
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            HX711 24-bit ADC
          </div>
        </div>

        {/* 3. IR Sensor */}
        <div className="card" style={{ padding: '20px', textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: '8px' }}>
            IR Sensor
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: isPetPresent ? 'var(--primary-green)' : 'var(--text-muted)',
              marginBottom: '12px',
            }}
          >
            {telemetry ? (isPetPresent ? 'Pet Detected' : 'No Pet') : 'Unknown'}
          </div>

          {/* Visual IR Beam Graphic */}
          <div
            style={{
              width: '74px',
              height: '80px',
              margin: '0 auto 12px auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: '#4a423a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Radio size={18} />
            </div>
            {isPetPresent && (
              <div
                style={{
                  width: '40px',
                  height: '24px',
                  background: 'rgba(86, 126, 96, 0.25)',
                  clipPath: 'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)',
                  marginTop: '4px',
                }}
              />
            )}
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            SSR1017 debounced
          </div>
        </div>

        {/* 4. Gate Servo */}
        <div className="card" style={{ padding: '20px', textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: '8px' }}>
            Gate Servo
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: isGateOpen ? 'var(--accent-amber)' : 'var(--primary-green)',
              marginBottom: '12px',
            }}
          >
            {telemetry ? (isGateOpen ? 'Open 🔓' : 'Closed 🔒') : 'Unknown'}
          </div>

          {/* Visual Gate Servo Graphic */}
          <div
            style={{
              width: '74px',
              height: '80px',
              margin: '0 auto 12px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '44px',
            }}
          >
            {telemetry ? (isGateOpen ? '🚪' : '🔒') : '❔'}
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            MG996R (10° detent)
          </div>
        </div>
      </div>

      {/* System Health Status Banner */}
      <div
        className="card"
        style={{
          borderLeft: isFault
            ? '6px solid #cf1322'
            : !isOnline
            ? '6px solid #ad6800'
            : telemetry ? '6px solid var(--primary-green)' : '6px solid #ad6800',
          background: isFault
            ? 'var(--status-err-bg)'
            : !isOnline
            ? 'var(--status-warn-bg)'
            : telemetry ? 'var(--status-ok-bg)' : 'var(--status-warn-bg)',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {isFault ? (
                <AlertTriangle size={24} color="#cf1322" />
              ) : telemetry ? (
                <CheckCircle2 size={24} color="#237844" />
              ) : (
                <AlertTriangle size={24} color="#ad6800" />
              )}
            </div>

            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-main)', marginBottom: '4px' }}>
                {isFault
                  ? `${telemetry?.fault ?? 'System'} Fault Latched`
                  : !isOnline
                  ? 'Device Offline'
                  : telemetry ? 'All systems nominal' : 'Feeder telemetry unavailable'}
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                {isFault
                  ? FAULT_INFO[telemetry?.fault ?? 'SENSOR'].description
                  : !isOnline
                  ? 'ESP32 link is disconnected. Check Wi-Fi or simulation link.'
                  : telemetry ? 'Feeder is running smoothly. Closed-loop load cell, servo gate, and RTC synchronized.' : 'The CAM is reachable, but this firmware does not provide verifiable WROOM telemetry.'}
              </p>
            </div>
          </div>

          {isFault && (
            <button
              className="btn btn--danger"
              onClick={() => actions.clearFault()}
              disabled={pending.clear || mode === 'hardware'}
            >
              Clear Fault
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
