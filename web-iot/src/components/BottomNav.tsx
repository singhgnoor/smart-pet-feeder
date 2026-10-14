import React from 'react';
import {
  LayoutDashboard,
  UtensilsCrossed,
  CalendarClock,
  Camera,
  Menu,
} from 'lucide-react';
import type { NavTab } from './Sidebar';

interface BottomNavProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenMenu: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  onOpenMenu,
}) => {
  const isMoreActive =
    currentTab === 'logs' ||
    currentTab === 'analytics' ||
    currentTab === 'status' ||
    currentTab === 'settings';

  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      <button
        className={`bottom-nav__item ${currentTab === 'home' ? 'bottom-nav__item--active' : ''}`}
        onClick={() => onSelectTab('home')}
      >
        <LayoutDashboard size={20} />
        <span>Home</span>
      </button>

      <button
        className={`bottom-nav__item ${currentTab === 'feed' ? 'bottom-nav__item--active' : ''}`}
        onClick={() => onSelectTab('feed')}
      >
        <UtensilsCrossed size={20} />
        <span>Feed</span>
      </button>

      <button
        className={`bottom-nav__item ${currentTab === 'schedule' ? 'bottom-nav__item--active' : ''}`}
        onClick={() => onSelectTab('schedule')}
      >
        <CalendarClock size={20} />
        <span>Schedule</span>
      </button>

      <button
        className={`bottom-nav__item ${currentTab === 'camera' ? 'bottom-nav__item--active' : ''}`}
        onClick={() => onSelectTab('camera')}
      >
        <Camera size={20} />
        <span>Camera</span>
      </button>

      <button
        className={`bottom-nav__item ${isMoreActive ? 'bottom-nav__item--active' : ''}`}
        onClick={onOpenMenu}
        aria-label="More navigation options"
      >
        <Menu size={20} />
        <span>More</span>
      </button>
    </nav>
  );
};
