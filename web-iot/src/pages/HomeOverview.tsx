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
import { countdown, dateTime, grams } from '../utils/format';
import { STATE_INFO, RESULT_INFO } from '../utils/labels';
import type { NavTab } from '../components/Sidebar';

interface HomeOverviewProps {
  onNavigate: (tab: NavTab) => void;
}

export const HomeOverview: React.FC<HomeOverviewProps> = ({ onNavigate }) => {
  const { telemetry, schedule, events, activeFeed, connection } = useDevice();

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

  // Recent 4 events
  const recentEvents = events.slice(0, 4);

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

        {/* Card: Recent Activity */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card__header">
            <div>
              <h3 className="card__title">Recent Activity</h3>
              <p className="card__subtitle">Latest feeding events</p>
            </div>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => onNavigate('logs')}
              style={{ gap: '4px' }}
            >
              <span>View all</span>
              <ArrowRight size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recentEvents.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '30px 10px',
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                }}
              >
                No feeding events logged yet.
              </div>
            ) : (
              recentEvents.map((evt) => {
                const info = RESULT_INFO[evt.result];
                return (
                  <div
                    key={evt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: 'var(--bg-app)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '18px' }}>{info.emoji}</span>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                          {evt.source === 'scheduled' ? 'Scheduled Meal' : 'Manual Feed'}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-light)' }}>
                          {dateTime(evt.timestamp)}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                        {grams(evt.dispensedG)}
                      </div>
                      <span
                        className={`badge ${
                          info.tone === 'ok'
                            ? 'badge--ok'
                            : info.tone === 'danger'
                            ? 'badge--danger'
                            : 'badge--warn'
                        }`}
                        style={{ fontSize: '10px', padding: '2px 8px' }}
                      >
                        {info.label}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
