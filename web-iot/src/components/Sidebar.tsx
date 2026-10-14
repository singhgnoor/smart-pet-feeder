import React from 'react';
import {
  LayoutDashboard,
  UtensilsCrossed,
  CalendarClock,
  Camera,
  FileText,
  TrendingUp,
  Activity,
  Settings,
} from 'lucide-react';
import { useDevice } from '../context/DeviceContext';

export type NavTab =
  | 'home'
  | 'feed'
  | 'schedule'
  | 'camera'
  | 'logs'
  | 'analytics'
  | 'status'
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpen,
  onCloseMobile,
}) => {
  const { connection, isDemo } = useDevice();
  const isOnline = connection === 'connected';

  const navItems = [
    { id: 'home' as NavTab, label: 'Home', icon: LayoutDashboard },
    { id: 'feed' as NavTab, label: 'Feed Now', icon: UtensilsCrossed },
    { id: 'schedule' as NavTab, label: 'Schedule', icon: CalendarClock },
    { id: 'camera' as NavTab, label: 'Live Camera', icon: Camera },
    { id: 'logs' as NavTab, label: 'Logs', icon: FileText },
    { id: 'analytics' as NavTab, label: 'Analytics', icon: TrendingUp },
    { id: 'status' as NavTab, label: 'Device Status', icon: Activity },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  return (
    <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
      <div className="sidebar__brand">
        <div className="sidebar__brand-logo" aria-hidden="true">
          🐾
        </div>
        <div style={{ flex: 1 }}>
          <h1 className="sidebar__brand-title">PawBite</h1>
          <p className="sidebar__brand-subtitle">Smart Pet Feeder</p>
        </div>
        <button
          className="sidebar__close-mobile"
          onClick={onCloseMobile}
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              className={`sidebar__nav-item ${isActive ? 'sidebar__nav-item--active' : ''}`}
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="sidebar__nav-icon" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="status-pill" title={isOnline ? 'ESP32 connected' : 'Link offline'}>
          <span
            className={`status-dot ${isOnline ? 'status-dot--pulse' : 'status-dot--offline'}`}
          />
          <span>{isOnline ? 'Feeder Online' : 'Feeder Offline'}</span>
          {isDemo && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '10px',
                padding: '2px 6px',
                background: '#fef5e6',
                color: '#e6982b',
                borderRadius: '4px',
                fontWeight: 700,
              }}
            >
              DEMO
            </span>
          )}
        </div>
      </div>
    </aside>
  );
};
