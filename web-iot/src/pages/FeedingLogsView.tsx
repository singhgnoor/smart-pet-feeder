import React, { useState, useMemo } from 'react';
import { useDevice } from '../context/DeviceContext';
import { dateTime, grams, duration } from '../utils/format';
import { RESULT_INFO } from '../utils/labels';

export const FeedingLogsView: React.FC = () => {
  const { events } = useDevice();
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

  // Daily totals
  const totalG = events.reduce((sum, e) => sum + e.dispensedG, 0);
  const successCount = events.filter((e) => e.result === 'OK' || e.result === 'SHORT' || e.result === 'OVER').length;

  return (
    <div className="logs-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Feeding Logs</span>
            <span style={{ fontSize: '24px' }}>📋</span>
          </h1>
          <p className="page-header__sub">History of all feeding events and system activities.</p>
        </div>

        {/* Filter Dropdown */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <select
            className="select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All Events</option>
            <option value="completed">Completed Meals</option>
            <option value="skipped">Skipped Feeds</option>
            <option value="aborted">Aborted / Timeouts</option>
            <option value="fault">Fault Events</option>
          </select>

          <select
            className="select"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All Sources</option>
            <option value="manual">Manual Feeds Only</option>
            <option value="scheduled">Scheduled Only</option>
          </select>
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid-kpi-3">
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

      {/* Main Events Table */}
      <div className="card">
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
                    No events match the selected filters.
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
