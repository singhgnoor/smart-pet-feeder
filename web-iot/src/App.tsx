import React, { useState } from 'react';
import { ToastProvider } from './components/ToastProvider';
import { ConfirmProvider } from './components/ConfirmDialog';
import { DeviceProvider } from './context/DeviceContext';
import { Sidebar, type NavTab } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';

import { HomeOverview } from './pages/HomeOverview';
import { FeedNowView } from './pages/FeedNowView';
import { ScheduleView } from './pages/ScheduleView';
import { LiveCameraView } from './pages/LiveCameraView';
import { AnalyticsView } from './pages/AnalyticsView';
import { SettingsView } from './pages/SettingsView';

import './styles/app.css';

const TAB_TITLES: Record<NavTab, string> = {
  home: 'PawBite · Overview',
  feed: 'Feed Now · Manual Dispenser & Logs',
  schedule: 'Feeding Schedule · Automatic Meals',
  camera: 'Pet Camera · Live Vision',
  analytics: 'Analytics & Consumption Trends',
  settings: 'System Configuration & Controls',
};

const DashboardContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  return (
    <div className="app-container">
      {/* Mobile Drawer Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content Area */}
      <div className="main-wrapper">
        <TopBar
          title={TAB_TITLES[currentTab]}
          onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        />

        <main className="content-body">
          {currentTab === 'home' && <HomeOverview onNavigate={setCurrentTab} />}
          {currentTab === 'feed' && <FeedNowView />}
          {currentTab === 'schedule' && <ScheduleView />}
          {currentTab === 'camera' && <LiveCameraView />}
          {currentTab === 'analytics' && <AnalyticsView />}
          {currentTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenMenu={() => setIsMobileMenuOpen(true)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <DeviceProvider>
          <DashboardContent />
        </DeviceProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
};

export default App;
