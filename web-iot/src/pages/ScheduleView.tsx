import React, { useState, useEffect } from 'react';
import { Sun, Sunset, Moon, Check, Clock, Edit2 } from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { nextFeeding } from '../utils/schedule';
import { countdown, pad2 } from '../utils/format';
import type { FeedingSchedule } from '../types/device';

export const ScheduleView: React.FC = () => {
  const { schedule, actions, pending, canOperate, mode } = useDevice();

  // Local draft of the 4 slots
  const [draft, setDraft] = useState<FeedingSchedule[]>(schedule);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [masterEnabled, setMasterEnabled] = useState<boolean>(true);

  useEffect(() => {
    if (schedule && schedule.length > 0) {
      setDraft(schedule);
      setMasterEnabled(schedule.some((s) => s.enabled));
    }
  }, [schedule]);

  const mealIcons = [
    { icon: Sun, color: '#e6982b', label: 'Meal 1 (Breakfast)' },
    { icon: Sun, color: '#f59e0b', label: 'Meal 2 (Lunch)' },
    { icon: Sunset, color: '#ea580c', label: 'Meal 3 (Dinner)' },
    { icon: Moon, color: '#4f46e5', label: 'Meal 4 (Late Snack)' },
  ];

  const handleToggleSlot = (index: number) => {
    const updated = draft.map((slot, i) =>
      i === index ? { ...slot, enabled: !slot.enabled } : slot
    );
    setDraft(updated);
    actions.saveSchedule(updated);
  };

  const handleMasterToggle = () => {
    const nextState = !masterEnabled;
    setMasterEnabled(nextState);
    const updated = draft.map((slot) => ({ ...slot, enabled: nextState }));
    setDraft(updated);
    actions.saveSchedule(updated);
  };

  const handleSaveSlotEdit = (index: number, hour: number, minute: number, portionG: number) => {
    const updated = draft.map((slot, i) =>
      i === index ? { ...slot, hour, minute, portionG } : slot
    );
    setDraft(updated);
    setEditingSlot(null);
    actions.saveSchedule(updated);
  };

  const next = draft.length > 0 ? nextFeeding(draft) : null;

  return (
    <div className="schedule-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Schedule</span>
            <span style={{ fontSize: '24px' }}>📅</span>
          </h1>
          <p className="page-header__sub">Set up automatic feeding times.</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
            Enable Schedule
          </span>
          <label className="switch">
            <input
              type="checkbox"
              checked={masterEnabled}
              onChange={handleMasterToggle}
              disabled={!canOperate || pending.schedule}
            />
            <span className="switch__slider" />
          </label>
        </div>
      </div>

      {mode === 'hardware' && schedule.length === 0 && (
        <p role="status" style={{ color: '#ad6800', marginBottom: '16px' }}>
          The current firmware cannot read or persist the WROOM schedule. No schedule values are being shown as device settings.
        </p>
      )}

      {/* Next Feeding Countdown Summary */}
      <div
        style={{
          background: 'var(--accent-amber-light)',
          border: '1px solid var(--accent-amber-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '16px 24px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <Clock size={20} color="#e6982b" />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-main)' }}>
              {next
                ? `Next automatic meal: Meal ${next.slot.slot + 1} at ${pad2(
                    next.slot.hour
                  )}:${pad2(next.slot.minute)} (${next.slot.portionG} g)`
                : 'No automatic feedings enabled'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {next
                ? `${countdown(next.msUntil)} remaining until dispense`
                : 'Enable a meal slot below to start scheduled dispensing'}
            </div>
          </div>
        </div>

        <span
          className="badge badge--ok"
          style={{ background: '#fff', borderColor: 'var(--accent-amber-border)' }}
        >
          {draft.filter((s) => s.enabled).length} of 4 Active
        </span>
      </div>

      {/* Schedule Slots List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {draft.map((slot, i) => {
          const meta = mealIcons[i] || { icon: Sun, color: '#e6982b', label: `Meal ${i + 1}` };
          const Icon = meta.icon;
          const isEditing = editingSlot === i;

          return (
            <div
              key={slot.slot}
              className="card schedule-slot-card"
              style={{
                borderLeft: slot.enabled ? `4px solid ${meta.color}` : '4px solid #d1c8b8',
              }}
            >
              <div className="schedule-slot-header">
                {/* Meal name & icon */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: 'var(--radius-md)',
                      background: slot.enabled ? 'var(--bg-app)' : '#f5f3ee',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: slot.enabled ? meta.color : '#9c9388',
                    }}
                  >
                    <Icon size={22} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>
                      Meal {slot.slot + 1}
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{meta.label}</p>
                  </div>
                </div>

                {/* Time & Portion badges */}
                <div className="schedule-slot-controls">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '15px',
                      fontWeight: 700,
                      color: slot.enabled ? 'var(--text-main)' : 'var(--text-light)',
                    }}
                  >
                    <Clock size={16} />
                    <span>
                      {pad2(slot.hour)}:{pad2(slot.minute)}{' '}
                      {slot.hour >= 12 ? 'PM' : 'AM'}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '14px',
                      fontWeight: 700,
                      color: slot.enabled ? 'var(--primary-green)' : 'var(--text-light)',
                    }}
                  >
                    <span>🥣</span>
                    <span>{slot.portionG} g</span>
                  </div>

                  {/* Edit button */}
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => setEditingSlot(isEditing ? null : i)}
                    style={{ padding: '6px 10px' }}
                    title="Edit meal time and portion"
                  >
                    <Edit2 size={13} />
                    <span>{isEditing ? 'Close' : 'Edit'}</span>
                  </button>

                  {/* Slot toggle switch */}
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={() => handleToggleSlot(i)}
                      disabled={!canOperate || pending.schedule}
                    />
                    <span className="switch__slider" />
                  </label>
                </div>
              </div>

              {/* Inline Edit Form */}
              {isEditing && (
                <SlotEditor
                  slot={slot}
                  onSave={(h, m, g) => handleSaveSlotEdit(i, h, m, g)}
                  onCancel={() => setEditingSlot(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface SlotEditorProps {
  slot: FeedingSchedule;
  onSave: (hour: number, minute: number, portion: number) => void;
  onCancel: () => void;
}

const SlotEditor: React.FC<SlotEditorProps> = ({ slot, onSave, onCancel }) => {
  const [hour, setHour] = useState<number>(slot.hour);
  const [minute, setMinute] = useState<number>(slot.minute);
  const [portion, setPortion] = useState<number>(slot.portionG);

  return (
    <div
      style={{
        padding: '16px',
        background: 'var(--bg-app)',
        borderRadius: 'var(--radius-md)',
        marginTop: '8px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '20px',
        alignItems: 'flex-end',
      }}
    >
      <div>
        <label
          style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text-muted)',
            marginBottom: '6px',
          }}
        >
          Feeding Time (24h)
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            className="select"
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          >
            {Array.from({ length: 24 }).map((_, h) => (
              <option key={h} value={h}>
                {pad2(h)}
              </option>
            ))}
          </select>
          <span style={{ fontWeight: 700 }}>:</span>
          <select
            className="select"
            value={minute}
            onChange={(e) => setMinute(Number(e.target.value))}
          >
            {Array.from({ length: 12 }).map((_, m) => {
              const val = m * 5;
              return (
                <option key={val} value={val}>
                  {pad2(val)}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      <div>
        <label
          style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text-muted)',
            marginBottom: '6px',
          }}
        >
          Portion Size (g)
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="number"
            min="5"
            max="250"
            step="5"
            value={portion}
            onChange={(e) => setPortion(Math.max(5, Math.min(250, Number(e.target.value))))}
            className="input"
            style={{ width: '100px' }}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>grams</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => onSave(hour, minute, portion)}
        >
          <Check size={14} />
          <span>Save Changes</span>
        </button>
      </div>
    </div>
  );
};
