import React, { useState } from 'react';
import { Play, Square, AlertCircle, Loader2 } from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { useConfirm } from '../components/ConfirmDialog';
import { dateTime, grams } from '../utils/format';
import { RESULT_INFO, STATE_INFO } from '../utils/labels';

export const FeedNowView: React.FC = () => {
  const { telemetry, activeFeed, canOperate, actions, pending, events } = useDevice();
  const confirm = useConfirm();

  const [selectedPortion, setSelectedPortion] = useState<number>(20);
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [customValue, setCustomValue] = useState<number>(50);

  const chips = [10, 20, 30, 50];

  const portionToFeed = isCustom ? customValue : selectedPortion;

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

  // Filter manual feeds
  const manualFeeds = events.filter((e) => e.source === 'manual').slice(0, 5);

  const stateDetails = telemetry ? STATE_INFO[telemetry.state] : null;

  return (
    <div className="feed-now-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Feed Now</span>
            <span style={{ fontSize: '24px' }}>🥣</span>
          </h1>
          <p className="page-header__sub">Give a quick treat or a full meal.</p>
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
                    className={`chip ${!isCustom && selectedPortion === val ? 'chip--active' : ''}`}
                    onClick={() => {
                      setSelectedPortion(val);
                      setIsCustom(false);
                    }}
                    disabled={isDispensing}
                  >
                    {val} g
                  </button>
                ))}
                <button
                  type="button"
                  className={`chip ${isCustom ? 'chip--active' : ''}`}
                  onClick={() => setIsCustom(true)}
                  disabled={isDispensing}
                >
                  Custom
                </button>
              </div>

              {isCustom && (
                <div style={{ background: 'var(--bg-app)', padding: '16px', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                    <span>Selected: {customValue} g</span>
                    <span style={{ color: 'var(--text-light)' }}>Range: 5–250 g</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="250"
                    step="5"
                    value={customValue}
                    onChange={(e) => setCustomValue(Number(e.target.value))}
                    disabled={isDispensing}
                    style={{ width: '100%', accentColor: 'var(--primary-green)' }}
                  />
                </div>
              )}
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

      {/* Recent Manual Feeds Card */}
      <div className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Recent Manual Feeds</h3>
            <p className="card__subtitle">History of treats and on-demand meals</p>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Portion</th>
                <th>Bowl Weight</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {manualFeeds.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    No manual feeds recorded yet. Treat your pet with the button above! 🐾
                  </td>
                </tr>
              ) : (
                manualFeeds.map((feed) => {
                  const info = RESULT_INFO[feed.result];
                  return (
                    <tr key={feed.id}>
                      <td style={{ fontWeight: 600 }}>{dateTime(feed.timestamp)}</td>
                      <td style={{ fontWeight: 700 }}>{grams(feed.dispensedG)}</td>
                      <td>
                        {grams(feed.initialWeightG)} → {grams(feed.finalWeightG)}
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
