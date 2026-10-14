import React, { useState, useEffect } from 'react';
import { Menu, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { rssiQuality } from '../utils/format';

interface TopBarProps {
  onToggleMobileMenu: () => void;
  title: string;
}

export const TopBar: React.FC<TopBarProps> = ({ onToggleMobileMenu, title }) => {
  const { connection, rssi, isDemo, telemetry } = useDevice();
  const [timeStr, setTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatted = now.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }) + ' · ' + now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      setTimeStr(formatted);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const isOnline = connection === 'connected';
  const signal = rssi ? rssiQuality(rssi) : null;

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          className="topbar__mobile-menu"
          onClick={onToggleMobileMenu}
          aria-label="Toggle navigation menu"
        >
          <Menu size={20} />
        </button>
        <span className="topbar__title">{title}</span>
      </div>

      <div className="topbar__right">
        {isDemo && (
          <span className="topbar__badge topbar__badge--demo" title="Mock IoT Connection active">
            <span>🐾</span> Demo Mode
          </span>
        )}

        {isOnline && signal && (
          <span className="topbar__badge" title={`RSSI: ${rssi} dBm (${signal.label})`}>
            <Wifi size={14} color="#567e60" />
            <span>{signal.label}</span>
          </span>
        )}

        {!isOnline && (
          <span
            className="topbar__badge"
            style={{ background: '#fff1f0', borderColor: '#ffa39e', color: '#cf1322' }}
          >
            <WifiOff size={14} />
            <span>Disconnected</span>
          </span>
        )}

        {telemetry?.fault && (
          <span
            className="topbar__badge"
            style={{ background: '#fffbe6', borderColor: '#ffe58f', color: '#ad6800' }}
          >
            <AlertTriangle size={14} />
            <span>{telemetry.fault} Fault</span>
          </span>
        )}

        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
          {timeStr}
        </span>

        <div className="topbar__avatar" title="Pet profile: Buddy & Luna">
          🐶
        </div>
      </div>
    </header>
  );
};
