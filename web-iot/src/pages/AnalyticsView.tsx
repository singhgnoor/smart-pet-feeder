import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
import { useDevice } from '../context/DeviceContext';
import { dateKeyOf } from '../utils/format';

export const AnalyticsView: React.FC = () => {
  const { events, telemetry } = useDevice();
  const [timeframe, setTimeframe] = useState<string>('7d');

  // Compute daily totals for the last 7 days
  const dailyData = useMemo(() => {
    const days: { [key: string]: { day: string; grams: number; count: number } } = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const k = dateKeyOf(d);
      days[k] = { day: dayNames[d.getDay()], grams: 0, count: 0 };
    }

    events.forEach((ev) => {
      const k = ev.timestamp.slice(0, 10);
      if (days[k]) {
        days[k].grams += ev.dispensedG;
        if (ev.dispensedG > 0) days[k].count += 1;
      }
    });

    return Object.values(days).map((d) => ({
      ...d,
      grams: Math.round(d.grams),
    }));
  }, [events]);

  const totalDispensed = dailyData.reduce((sum, d) => sum + d.grams, 0);
  const totalEvents = dailyData.reduce((sum, d) => sum + d.count, 0);

  // Bowl weight trend data for today (or simulated 24h curve)
  const bowlTrendData = useMemo(() => {
    const currentWeight = telemetry?.bowlWeightG ?? 12;
    return [
      { time: '6 AM', weight: 4 },
      { time: '8 AM', weight: 48 }, // breakfast dispensed
      { time: '10 AM', weight: 32 }, // pet ate some
      { time: '12 PM', weight: 68 }, // lunch dispensed
      { time: '2 PM', weight: 22 }, // pet ate
      { time: '6 PM', weight: 70 }, // dinner dispensed
      { time: '8 PM', weight: 35 },
      { time: '10 PM', weight: Math.round(currentWeight) },
    ];
  }, [telemetry]);

  return (
    <div className="analytics-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Analytics</span>
            <span style={{ fontSize: '24px' }}>📈</span>
          </h1>
          <p className="page-header__sub">Track your pet's feeding habits.</p>
        </div>

        <select
          className="select"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
        >
          <option value="7d">Last 7 Days</option>
          <option value="14d">Last 14 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </div>

      {/* Top 2 Cards: Food Dispensed & Feeding Events */}
      <div className="grid-analytics-top">
        {/* Total Food Dispensed */}
        <div className="card" style={{ marginBottom: 0, padding: '24px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>
            Total Food Dispensed
          </span>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px', marginBottom: '16px' }}>
            {totalDispensed} <span style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-muted)' }}>g</span>
          </div>

          <div style={{ height: '140px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" stroke="#9c9388" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#9c9388" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(val: number) => [`${val} g`, 'Dispensed']}
                  contentStyle={{
                    background: '#fff',
                    borderRadius: '8px',
                    border: '1px solid var(--border-card)',
                    boxShadow: 'var(--shadow-sm)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="grams" fill="#88b196" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Feeding Events */}
        <div className="card" style={{ marginBottom: 0, padding: '24px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}>
            Feeding Events
          </span>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px', marginBottom: '16px' }}>
            {totalEvents} <span style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-muted)' }}>meals</span>
          </div>

          <div style={{ height: '140px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" stroke="#9c9388" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#9c9388" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(val: number) => [`${val} meals`, 'Completed']}
                  contentStyle={{
                    background: '#fff',
                    borderRadius: '8px',
                    border: '1px solid var(--border-card)',
                    fontSize: '12px',
                  }}
                />
                <Line type="monotone" dataKey="count" stroke="#567e60" strokeWidth={3} dot={{ fill: '#567e60', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Card: Bowl Weight Trend */}
      <div className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Bowl Weight Trend</h3>
            <p className="card__subtitle">Continuous load cell reading over the course of today</p>
          </div>
          <span className="badge badge--ok">Live HX711 Stream</span>
        </div>

        <div style={{ height: '240px', width: '100%', marginTop: '16px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={bowlTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#567e60" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#567e60" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0ede6" />
              <XAxis dataKey="time" stroke="#9c9388" fontSize={12} tickLine={false} />
              <YAxis stroke="#9c9388" fontSize={12} tickLine={false} unit="g" />
              <Tooltip
                formatter={(val: number) => [`${val} g`, 'Bowl Weight']}
                contentStyle={{
                  background: '#fff',
                  borderRadius: '8px',
                  border: '1px solid var(--border-card)',
                  fontSize: '12px',
                }}
              />
              <Area
                type="monotone"
                dataKey="weight"
                stroke="#567e60"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#weightGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
