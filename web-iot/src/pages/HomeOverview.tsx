import React from 'react';
import {
  CheckCircle2,
  Package,
  Clock,
  AlertTriangle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { nextFeeding } from '../utils/schedule';
import { countdown } from '../utils/format';
import { STATE_INFO } from '../utils/labels';
import type { NavTab } from '../components/Sidebar';

interface HomeOverviewProps {
  onNavigate: (tab: NavTab) => void;
}

export const HomeOverview: React.FC<HomeOverviewProps> = ({ onNavigate }) => {
  const { telemetry, schedule, activeFeed, connection } = useDevice();

  const nextFeed = schedule.length > 0 ? nextFeeding(schedule) : null;
  const isOnline = connection === 'connected';

  // Determine greeting based on current local hour
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good Morning!' : hour < 17 ? 'Good Afternoon!' : 'Good Evening!';

  // State info
  const stateDetails = telemetry ? STATE_INFO[telemetry.state] : null;
  const isFault = telemetry?.state === 'FAULT';
  const isDispensing =
    telemetry?.state === 'DISPENSING' ||
    telemetry?.state === 'PRECHECK' ||
    telemetry?.state === 'SETTLING' ||
    telemetry?.state === 'TOPUP' ||
    telemetry?.state === 'WIGGLE';

  const systemStatusLabel = !isOnline
    ? 'Offline'
    : isFault
    ? `${telemetry?.fault ?? 'System'} Fault`
    : isDispensing
    ? stateDetails?.label ?? 'Dispensing...'
    : telemetry ? 'All Good' : 'Feeder data unavailable';

  const hopperPercent = telemetry?.hopperPct ?? null;
  const bowlWeight = telemetry?.bowlWeightG ?? null;

  return (
    <div className="home-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>{greeting}</span>
            <span style={{ fontSize: '24px' }}>🐾</span>
          </h1>
          <p className="page-header__sub">Here's what's happening with your pet feeder.</p>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="stat-grid">
        {/* 1. System Status */}
        <div className="stat-card">
          <div
            className={`stat-card__icon-box ${
              !isOnline || isFault
                ? 'stat-card__icon-box--amber'
                : 'stat-card__icon-box--green'
            }`}
          >
            {isFault ? (
              <AlertTriangle size={22} color="#cf1322" />
            ) : (
              <CheckCircle2 size={22} color="#237844" />
            )}
          </div>
          <div>
            <div className="stat-card__label">System Status</div>
            <div className="stat-card__value" style={{ fontSize: '18px' }}>
              {systemStatusLabel}
            </div>
          </div>
        </div>

        {/* 2. Hopper Level */}
        <div className="stat-card">
          <div className="stat-card__icon-box stat-card__icon-box--amber">
            <Package size={22} color="#e6982b" />
          </div>
          <div>
            <div className="stat-card__label">Hopper Level</div>
            <div className="stat-card__value">
              {hopperPercent ?? '—'}
              {hopperPercent !== null && <span className="stat-card__unit">%</span>}
            </div>
          </div>
        </div>

        {/* 3. Bowl Weight */}
        <div className="stat-card">
          <div className="stat-card__icon-box stat-card__icon-box--blue">
            <span style={{ fontSize: '20px' }}>🥣</span>
          </div>
          <div>
            <div className="stat-card__label">Bowl Weight</div>
            <div className="stat-card__value">
              {bowlWeight === null ? '—' : bowlWeight.toFixed(0)}
              {bowlWeight !== null && <span className="stat-card__unit">g</span>}
            </div>
          </div>
        </div>

        {/* 4. Next Feed */}
        <div className="stat-card">
          <div className="stat-card__icon-box stat-card__icon-box--purple">
            <Clock size={22} color="#8738d4" />
          </div>
          <div>
            <div className="stat-card__label">Next Feed</div>
            <div className="stat-card__value" style={{ fontSize: '18px' }}>
              {nextFeed
                ? `${String(nextFeed.slot.hour).padStart(2, '0')}:${String(
                    nextFeed.slot.minute
                  ).padStart(2, '0')}`
                : 'None set'}
            </div>
          </div>
        </div>
      </div>

      {/* Feature Pet Duo Banner */}
      <div className="feature-banner">
        <div className="feature-banner__content">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '999px',
              background: 'var(--primary-green-light)',
              color: 'var(--primary-green)',
              fontSize: '12px',
              fontWeight: 700,
              marginBottom: '12px',
            }}
          >
            <Sparkles size={14} /> {telemetry ? 'Feeder Station Ready' : 'Feeder Data Unavailable'}
          </span>
          <h2 className="feature-banner__title">{telemetry ? 'Your pets are doing great! 🐾' : 'Feeder readings are unavailable'}</h2>
          <p className="feature-banner__desc">
            {activeFeed
              ? `Currently dispensing ${activeFeed.targetG} g of kibble. Gate is ${
                  telemetry?.gateOpen ? 'OPEN' : 'CLOSED'
                }.`
              : nextFeed && bowlWeight !== null
              ? `The bowl has ${bowlWeight.toFixed(
                  0
                )} g of dry kibble. Next automatic meal is scheduled for ${String(
                  nextFeed.slot.hour
                ).padStart(2, '0')}:${String(nextFeed.slot.minute).padStart(
                  2,
                  '0'
                )} (${countdown(nextFeed.msUntil)} left).`
              : bowlWeight !== null ? `The bowl has ${bowlWeight.toFixed(
                  0
                )} g of dry kibble. Set up feeding schedules or treat your pet anytime!`
              : 'No verified WROOM sensor readings are available.'}
          </p>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              className="btn btn--primary"
              onClick={() => onNavigate('feed')}
            >
              <span>Feed Now</span> 🥣
            </button>
            <button
              className="btn btn--secondary"
              onClick={() => onNavigate('camera')}
            >
              <span>Live Camera</span> 📷
            </button>
          </div>
        </div>

        <div className="feature-banner__image-wrap">
          <img
            src="/assets/pet-duo.jpg"
            alt="Cute puppy and kitten with pet food bowl"
            className="feature-banner__img"
            onError={(e) => {
              // Fallback if image fails
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      </div>

      {/* Two Column Layout: Quick Highlights & Recent Activity */}
      <div className="grid-2-col">
        {/* Card: Today's Summary */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card__header">
            <div>
              <h3 className="card__title">Today's Feeding Stats</h3>
              <p className="card__subtitle">Daily telemetry tracking</p>
            </div>
            <span style={{ fontSize: '20px' }}>📊</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 500 }}>
                Total Food Dispensed Today
              </span>
              <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary-green)' }}>
                {telemetry ? `${telemetry.dispensedTodayG} g` : '—'}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 500 }}>
                Pet Visits Detected Today
              </span>
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>
                {telemetry ? `${telemetry.petVisitsToday} visits 🐕` : '—'}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 500 }}>
                Dispenser Gate Status
              </span>
              <span
                className={`badge ${
                telemetry ? (telemetry.gateOpen ? 'badge--warn' : 'badge--ok') : 'badge--muted'
                }`}
              >
                {telemetry ? (telemetry.gateOpen ? 'Open 🔓' : 'Closed 🔒') : 'Unknown'}
              </span>
            </div>

            <div style={{ marginTop: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                }}
              >
                <span>Hopper Capacity (~1.8 kg)</span>
                <span>{hopperPercent === null ? '—' : `${hopperPercent}%`}</span>
              </div>
              <div
                style={{
                  height: '8px',
                  width: '100%',
                  background: '#f0ede6',
                  borderRadius: '999px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${hopperPercent ?? 0}%`,
                    background:
                      (hopperPercent ?? 100) < 15
                        ? '#e5484d'
                        : (hopperPercent ?? 100) < 35
                        ? '#e6982b'
                        : 'var(--primary-green)',
                    borderRadius: '999px',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card: Station & Pet Status (Non-repetitive station summary) */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card__header">
            <div>
              <h3 className="card__title">Station & Pet Status</h3>
              <p className="card__subtitle">Hardware overview & quick controls</p>
            </div>
            <span style={{ fontSize: '20px' }}>🐾</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Next Scheduled Meal */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '14px' }}>
                  Next Automated Meal
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {nextFeed
                    ? `Slot ${nextFeed.slot.hour.toString().padStart(2, '0')}:${nextFeed.slot.minute.toString().padStart(2, '0')} (${nextFeed.slot.portionG} g)`
                    : 'No automatic schedule active'}
                </div>
              </div>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => onNavigate('schedule')}
                style={{ gap: '4px' }}
              >
                <span>Schedule</span>
                <ArrowRight size={14} />
              </button>
            </div>

            {/* Pet Detection / Camera */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '14px' }}>
                  Pet Presence & Camera
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {telemetry?.petPresent
                    ? 'Pet detected at the station 🐕'
                    : 'No pet currently at the bowl'}
                </div>
              </div>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => onNavigate('camera')}
                style={{ gap: '4px' }}
              >
                <span>Camera</span>
                <ArrowRight size={14} />
              </button>
            </div>

            {/* Feeder Link */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '14px' }}>
                  Feeder Link & Diagnostics
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {isOnline ? 'ESP32 connected & ready' : 'Hardware offline'}
                </div>
              </div>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => onNavigate('settings')}
                style={{ gap: '4px' }}
              >
                <span>Diagnostics</span>
                <ArrowRight size={14} />
              </button>
            </div>

            {/* Consolidated Logs & History Notice */}
            <div
              style={{
                marginTop: '4px',
                padding: '12px 14px',
                background: 'var(--bg-app)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)' }}>
                  Feeding History & Logs
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  All feeding records & dispense history are in Feed Now.
                </div>
              </div>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => onNavigate('feed')}
                style={{ gap: '4px', whiteSpace: 'nowrap' }}
              >
                <span>Feed Now</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
