import React, { useState } from 'react';
import { Camera, Zap, Sparkles } from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { relative, dateTime } from '../utils/format';

export const LiveCameraView: React.FC = () => {
  const { snapshot, visits, actions, demo, pending, telemetry } = useDevice();
  const [testingAi, setTestingAi] = useState(false);

  const latestVisit = visits[0];
  const petDetected = telemetry?.petPresent || latestVisit?.verdict === 'PET';
  const confidence = latestVisit?.confidence ?? 94;

  const handleTakeSnapshot = async () => {
    await actions.refreshSnapshot();
  };

  const handleStartAiCheck = async () => {
    if (!demo) return;
    setTestingAi(true);
    demo.triggerVisit('pet');
    setTimeout(() => {
      setTestingAi(false);
    }, 1500);
  };

  // Display the generated realistic pet camera photo, or fallback to snapshot data URL
  const cameraSrc = snapshot?.url || '/assets/camera-dog.jpg';

  return (
    <div className="camera-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Live Camera</span>
            <span style={{ fontSize: '24px' }}>📷</span>
          </h1>
          <p className="page-header__sub">Check on your pet in real time.</p>
        </div>
      </div>

      <div className="grid-camera">
        {/* Left: Camera Feed Preview */}
        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              position: 'relative',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              background: '#2b2420',
              aspectRatio: '4 / 3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <img
              src={cameraSrc}
              alt="Live feeder camera view of pet"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                // If local file fails, fall back to default
                (e.target as HTMLImageElement).src = '/assets/camera-dog.jpg';
              }}
            />

            {/* Simulated Banner Overlay */}
            <div
              style={{
                position: 'absolute',
                top: '14px',
                left: '14px',
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(4px)',
                padding: '4px 12px',
                borderRadius: '999px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.5px',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#52c41a',
                  boxShadow: '0 0 6px #52c41a',
                }}
              />
              <span>SIMULATED FEED</span>
            </div>

            {/* Timestamp Watermark Overlay */}
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                right: '14px',
                background: 'rgba(0, 0, 0, 0.65)',
                padding: '3px 8px',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '11px',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
              }}
            >
              {snapshot?.capturedAt
                ? dateTime(snapshot.capturedAt)
                : 'Live · QVGA 320x240'}
            </div>
          </div>

          {/* Action buttons below camera */}
          <div style={{ display: 'flex', gap: '14px', marginTop: '16px' }}>
            <button
              className="btn btn--secondary"
              onClick={handleTakeSnapshot}
              disabled={pending.snapshot}
              style={{ flex: 1 }}
            >
              <Camera size={16} />
              <span>Snapshot</span>
            </button>

            <button
              className="btn btn--amber"
              onClick={handleStartAiCheck}
              disabled={testingAi}
              style={{ flex: 1 }}
            >
              <Zap size={16} />
              <span>{testingAi ? 'Classifying...' : 'Start AI Check'}</span>
            </button>
          </div>
        </div>

        {/* Right: AI Detection Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">AI Detection</h3>
                <p className="card__subtitle">Edge TinyML Vision Classifier</p>
              </div>
              <Sparkles size={20} color="#e6982b" />
            </div>

            {/* Detection status badge */}
            <div style={{ marginBottom: '20px' }}>
              <div
                className={`badge ${petDetected ? 'badge--ok' : 'badge--muted'}`}
                style={{ fontSize: '14px', padding: '6px 16px', marginBottom: '16px' }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: petDetected ? '#237844' : '#8c8c8c',
                  }}
                />
                <span>{petDetected ? 'Pet Detected 🐶' : 'No Pet Detected'}</span>
              </div>

              {/* Confidence progress bar */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    fontWeight: 700,
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>Confidence</span>
                  <span style={{ color: 'var(--primary-green)' }}>{confidence}%</span>
                </div>
                <div
                  style={{
                    height: '10px',
                    width: '100%',
                    background: '#f0ede6',
                    borderRadius: '999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${confidence}%`,
                      background: 'var(--primary-green)',
                      borderRadius: '999px',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Last detected info */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                background: 'var(--bg-app)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '24px' }}>🐶</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-main)' }}>
                  Last detected: {latestVisit?.topClass === 'pet' ? 'Dog' : latestVisit?.topClass ?? 'Dog'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-light)' }}>
                  {latestVisit ? relative(new Date(latestVisit.timestamp).getTime()) : '2 minutes ago'}
                </div>
              </div>
            </div>

            {/* TinyML Specs */}
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                lineHeight: 1.5,
                background: 'var(--bg-app)',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '4px' }}>
                🧠 TinyML Model Workflow
              </strong>
              IR motion trigger → 3 frames captured at 250 ms → MobileNetV1 INT8 quantized classification → Temporal voting (≥2 frames with ≥75% confidence confirmed as pet).
            </div>
          </div>

          {/* Recent Detection History */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title" style={{ fontSize: '15px' }}>
                  Recent Visit Log
                </h3>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                {visits.length} events
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {visits.slice(0, 4).map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-app)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{v.verdict === 'PET' ? '🐾' : '👤'}</span>
                    <span style={{ fontWeight: 600 }}>
                      {v.verdict === 'PET' ? 'Pet visit' : 'Other motion'}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, color: 'var(--primary-green)' }}>
                      {v.confidence}%
                    </span>
                    <div style={{ fontSize: '10px', color: 'var(--text-light)' }}>
                      {relative(new Date(v.timestamp).getTime())}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
