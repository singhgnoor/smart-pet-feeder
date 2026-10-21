import React, { useState, useMemo } from 'react';
import { Play, Square, AlertCircle, Loader2 } from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { useConfirm } from '../components/ConfirmDialog';
import { dateTime, grams, duration } from '../utils/format';
import { RESULT_INFO, STATE_INFO } from '../utils/labels';

export const FeedNowView: React.FC = () => {
  const { telemetry, activeFeed, canOperate, actions, pending, events } = useDevice();
  const confirm = useConfirm();

  const [selectedPortion, setSelectedPortion] = useState<number>(20);
  const chips = [10, 20, 30, 50];
  const portionToFeed = selectedPortion;

  const isDispensing =
    telemetry?.state === 'DISPENSING' ||
    telemetry?.state === 'PRECHECK' ||
    telemetry?.state === 'SETTLING' ||
    telemetry?.state === 'TOPUP' ||
    telemetry?.state === 'WIGGLE' ||
    telemetry?.state === 'REPORT';

  const isFault = telemetry?.state === 'FAULT';

  const handleFeed = async () => {
    if (!canOperate || isDispensing || isFault) return;

    const ok = await confirm({
      title: `Dispense ${portionToFeed} g of food? 🥣`,
      body: `This will dispense a ${portionToFeed} g meal into the bowl. Make sure the bowl is clean and ready.`,
      confirmLabel: 'Feed Now 🥣',
      cancelLabel: 'Cancel',
      emoji: '🐾',
      tone: 'primary',
    });

    if (ok) {
      await actions.feed(portionToFeed);
    }
  };

  const handleAbort = async () => {
    const ok = await confirm({
      title: 'Abort feeding operation? ✋',
      body: 'The gate will close immediately and any food already dispensed will be logged.',
      confirmLabel: 'Abort Feed',
      cancelLabel: 'Keep Feeding',
      tone: 'danger',
      emoji: '⚠️',
    });

    if (ok) {
      await actions.abort();
    }
  };

  // Filter state for comprehensive logs
  const [filter, setFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Result filter
      if (filter === 'completed' && !(ev.result === 'OK' || ev.result === 'OVER' || ev.result === 'SHORT')) return false;
      if (filter === 'aborted' && ev.result !== 'ABORTED' && ev.result !== 'TIMEOUT') return false;
      if (filter === 'skipped' && !ev.result.startsWith('SKIP')) return false;
      if (filter === 'fault' && ev.result !== 'JAM' && ev.result !== 'SENSOR') return false;

      // Source filter
      if (sourceFilter === 'manual' && ev.source !== 'manual') return false;
      if (sourceFilter === 'scheduled' && ev.source !== 'scheduled') return false;

      return true;
    });
  }, [events, filter, sourceFilter]);

  // Overall totals for feeding logs
  const totalG = useMemo(() => events.reduce((sum, e) => sum + e.dispensedG, 0), [events]);
  const successCount = useMemo(
    () => events.filter((e) => e.result === 'OK' || e.result === 'SHORT' || e.result === 'OVER').length,
    [events]
  );

  const stateDetails = telemetry ? STATE_INFO[telemetry.state] : null;

  return (
    <div className="feed-now-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Feed Now & History</span>
            <span style={{ fontSize: '24px' }}>🥣</span>
          </h1>
          <p className="page-header__sub">Manual dispensing controls and complete feeding logs.</p>
        </div>
      </div>

      {/* Main Dispense Card */}
      <div className="card" style={{ padding: '24px' }}>
        <div className="grid-feed">
          {/* Controls */}
          <div>
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '12px',
                }}
              >
                Portion Size
              </label>

              <div className="chip-group" style={{ marginBottom: '16px' }}>
                {chips.map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`chip ${selectedPortion === val ? 'chip--active' : ''}`}
                    onClick={() => setSelectedPortion(val)}
                    disabled={isDispensing}
                  >
                    {val} g
                  </button>
                ))}
              </div>
            </div>

            {/* Live Dispense Indicator or Feed Button */}
            {isDispensing ? (
              <div
                style={{
                  background: 'var(--status-info-bg)',
                  border: '1px solid var(--status-info-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '20px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Loader2 size={18} className="spin" color="#096dd9" />
                    <strong style={{ color: '#096dd9', fontSize: '15px' }}>
                      {stateDetails?.label ?? 'Dispensing in progress...'}
                    </strong>
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#096dd9' }}>
                    Target: {activeFeed?.targetG ?? portionToFeed} g
                  </span>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                  {stateDetails?.hint ?? 'Please wait while the feeder dispenses the food.'}
                </p>

                <button
                  className="btn btn--danger btn--sm"
                  onClick={handleAbort}
                  disabled={pending.abort}
                  style={{ width: '100%' }}
                >
                  <Square size={14} />
                  <span>Abort Feeding</span>
                </button>
              </div>
            ) : (
              <button
                className="btn btn--primary btn--lg"
                onClick={handleFeed}
                disabled={!canOperate || isFault || pending.feed}
                style={{ width: '100%', maxWidth: '280px' }}
              >
                {pending.feed ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    <span>Sending command...</span>
                  </>
                ) : (
                  <>
                    <Play size={18} fill="currentColor" />
                    <span>Feed Now ({portionToFeed} g) 🥣</span>
                  </>
                )}
              </button>
            )}

            {isFault && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#cf1322',
                  fontSize: '13px',
                  marginTop: '12px',
                }}
              >
                <AlertCircle size={16} />
                <span>The feeder is in a fault state ({telemetry?.fault}). Clear fault in Settings to dispense.</span>
              </div>
            )}
          </div>

          {/* Right Image: Cute Puppy */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <img
              src="/assets/puppy-paw.jpg"
              alt="Cute puppy waving paw"
              style={{
                maxHeight: '220px',
                maxWidth: '100%',
                objectFit: 'contain',
                borderRadius: 'var(--radius-lg)',
              }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid-kpi-3" style={{ marginBottom: '20px' }}>
        <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>
            Total Recorded Dispensed
          </span>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--primary-green)', marginTop: '4px' }}>
            {totalG.toFixed(1)} g
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>
            Successful Operations
          </span>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
            {successCount} / {events.length}
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>
            Showing Filtered
          </span>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--accent-amber)', marginTop: '4px' }}>
            {filteredEvents.length} events
          </div>
        </div>
      </div>

      {/* Complete Feeding History & Logs Card */}
      <div className="card">
        <div
          className="card__header"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div>
            <h3 className="card__title">Feeding History & Logs</h3>
            <p className="card__subtitle">Complete record of manual and scheduled feedings</p>
          </div>

          {/* Filter Dropdowns */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <select
              className="select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter events by status"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed Meals</option>
              <option value="skipped">Skipped Feeds</option>
              <option value="aborted">Aborted / Timeouts</option>
              <option value="fault">Fault Events</option>
            </select>

            <select
              className="select"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              aria-label="Filter events by source"
            >
              <option value="all">All Sources</option>
              <option value="manual">Manual Feeds Only</option>
              <option value="scheduled">Scheduled Only</option>
            </select>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Event Type</th>
                <th>Target</th>
                <th>Dispensed</th>
                <th>Bowl (Before → After)</th>
                <th>Duration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    No feeding events match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredEvents.map((evt) => {
                  const info = RESULT_INFO[evt.result];
                  const isScheduled = evt.source === 'scheduled';

                  return (
                    <tr key={evt.id}>
                      <td style={{ fontWeight: 600 }}>{dateTime(evt.timestamp)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '16px' }}>{info.emoji}</span>
                          <div>
                            <span style={{ fontWeight: 700 }}>
                              {isScheduled
                                ? `Meal ${evt.slot !== null ? evt.slot + 1 : 'Sched'}`
                                : 'Manual Feed'}
                            </span>
                            {evt.wiggles > 0 && (
                              <span style={{ fontSize: '11px', color: 'var(--text-light)', display: 'block' }}>
                                {evt.wiggles} wiggle(s) to clear kibble
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{evt.targetG} g</td>
                      <td style={{ fontWeight: 800, color: evt.dispensedG > 0 ? 'var(--primary-green)' : 'var(--text-light)' }}>
                        {grams(evt.dispensedG)}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {grams(evt.initialWeightG)} → {grams(evt.finalWeightG)}
                      </td>
                      <td style={{ color: 'var(--text-light)', fontSize: '12px' }}>
                        {duration(evt.durationMs)}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            info.tone === 'ok'
                              ? 'badge--ok'
                              : info.tone === 'danger'
                              ? 'badge--danger'
                              : 'badge--warn'
                          }`}
                        >
                          {info.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
