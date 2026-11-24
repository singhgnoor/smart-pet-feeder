import React, { useEffect } from 'react';
import { Camera, Power, Sun, Sparkles } from 'lucide-react';
import { useDevice } from '../context/DeviceContext';
import { relative, dateTime } from '../utils/format';

export const LiveCameraView: React.FC = () => {
  const { snapshot, visits, actions, pending, telemetry, isDemo, cameraOn, flashOn } = useDevice();

  const latestVisit = visits[0];
  const petDetected = telemetry?.petPresent ?? (latestVisit ? latestVisit.verdict === 'PET' : null);

  // Poll live frames while camera is active (switched ON by IR sensor or user toggle)
  useEffect(() => {
    if (isDemo || !cameraOn) return;
    void actions.refreshSnapshot(false);
    const id = window.setInterval(() => {
      void actions.refreshSnapshot(false);
    }, 500);
    return () => window.clearInterval(id);
  }, [isDemo, cameraOn, actions]);

  const cameraSrc = snapshot?.url || (isDemo ? '/assets/camera-dog.jpg' : null);

  return (
    <div className="camera-page">
      <div className="page-header">
        <div>
          <h1 className="page-header__greeting">
            <span>Live Camera</span>
            <span style={{ fontSize: '24px' }}>📷</span>
          </h1>
          <p className="page-header__sub">Camera activates automatically when the IR sensor triggers, or toggle manually below.</p>
        </div>
      </div>

      <div className="grid-camera">
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
            {(cameraOn || isDemo) && cameraSrc ? (
              <img
                src={cameraSrc}
                alt="Live feeder camera view"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  if (isDemo) (e.target as HTMLImageElement).src = '/assets/camera-dog.jpg';
                }}
              />
            ) : (
              <span style={{ color: '#fff', padding: '24px', textAlign: 'center', fontSize: '14px' }}>
                {cameraOn ? 'Loading live feed from ESP32-CAM...' : 'Camera in Standby — turns ON automatically when IR sensor triggers.'}
              </span>
            )}

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
                  background: cameraOn ? '#52c41a' : isDemo ? '#1890ff' : '#8c8c8c',
                }}
              />
              <span>{cameraOn ? 'LIVE · ESP32-CAM' : isDemo ? 'SIMULATED FEED' : 'CAMERA STANDBY'}</span>
            </div>

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
              }}
            >
              {snapshot?.capturedAt ? dateTime(snapshot.capturedAt) : 'Waiting for frame'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            <button
              className={`btn ${cameraOn ? 'btn--danger' : 'btn--primary'}`}
              onClick={() => actions.setCamera(!cameraOn)}
              disabled={pending.camera}
              style={{ flex: 1 }}
            >
              <Power size={16} />
              <span>{cameraOn ? 'Turn Camera OFF' : 'Turn Camera ON'}</span>
            </button>

            <button
              className={`btn ${flashOn ? 'btn--amber' : 'btn--secondary'}`}
              onClick={() => actions.setFlash(!flashOn)}
              disabled={pending.flash}
              style={{ flex: 1 }}
            >
              <Sun size={16} />
              <span>{flashOn ? 'Flash ON' : 'Flash OFF'}</span>
            </button>

            <button
              className="btn btn--secondary"
              onClick={() => actions.refreshSnapshot(true)}
              disabled={pending.snapshot}
            >
              <Camera size={16} />
              <span>Snapshot</span>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title">IR Sensor & Camera Trigger</h3>
                <p className="card__subtitle">ESP32-S IR → UART → ESP32-CAM</p>
              </div>
              <Sparkles size={20} color="#e6982b" />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div
                className={`badge ${petDetected ? 'badge--ok' : 'badge--muted'}`}
                style={{ fontSize: '14px', padding: '6px 16px' }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: petDetected ? '#237844' : '#8c8c8c',
                  }}
                />
                <span>{petDetected ? 'IR Triggered · Pet Present 🐶' : 'IR Clear · Standby'}</span>
              </div>
            </div>

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
              When the IR obstacle sensor on ESP32-S triggers, it immediately notifies ESP32-CAM over UART to power on the OV2640 camera and stream live frames here, while checking the bowl weight (&le; 200 g) and T-minute cooldown before dispensing.
            </div>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card__header">
              <div>
                <h3 className="card__title" style={{ fontSize: '15px' }}>Recent IR / Visit Triggers</h3>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                {visits.length} events
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {visits.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>
                  No IR detections recorded yet.
                </div>
              ) : (
                visits.slice(0, 6).map((v) => (
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
                      <span>🐾</span>
                      <span style={{ fontWeight: 600 }}>IR Pet Trigger</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-light)' }}>
                      {relative(new Date(v.timestamp).getTime())}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
