/**
 * DeviceContext — the single source of truth for device data in the UI.
 *
 * It owns the DeviceService instance (either real RestDeviceService or simulated MockDeviceService),
 * subscribes to its live event stream (GET /events), keeps telemetry / schedule / history / config /
 * visits in React state and exposes typed actions. Components never talk to the service directly.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createDeviceService,
  type DeviceMode,
  type DeviceService,
} from '../services/deviceService';
import { eventFromLog, parseState, telemetryFromRaw } from '../services/protocol';
import {
  DeviceError,
  type ActiveFeed,
  type CalibrationInfo,
  type DeviceConnectionState,
  type DeviceEvent,
  type DeviceTelemetry,
  type FaultCode,
  type FeederConfig,
  type FeederState,
  type FeedingEvent,
  type FeedingSchedule,
  type PetClass,
  type PetVisit,
  type Snapshot,
} from '../types/device';
import { useToast, type ToastInput } from '../components/ToastProvider';
import { FAULT_INFO, RESULT_INFO, isActiveState } from '../utils/labels';
import { grams } from '../utils/format';
import { DEFAULT_CAL_FACTOR } from '../data/demoData';

const CAL_KEY = 'pawpilot.calibration.v1';
const MODE_STORAGE_KEY = 'pawpilot.device_mode';
const HISTORY_LIMIT = 200;
const WEIGHT_WINDOW_MS = 5 * 60 * 1000;

export type CommandName =
  | 'feed'
  | 'abort'
  | 'clear'
  | 'schedule'
  | 'config'
  | 'tare'
  | 'calibrate'
  | 'snapshot'
  | 'reconnect'
  | 'reset';

export interface WeightPoint {
  t: number;
  w: number;
}

export interface DeviceContextValue {
  mode: DeviceMode;
  setMode: (mode: DeviceMode) => void;
  isDemo: boolean;
  integrationNotice: string | null;
  connection: DeviceConnectionState;
  link: boolean;
  rssi: number | null;
  telemetry: DeviceTelemetry | null;
  lastHeartbeat: number | null;
  weightHistory: WeightPoint[];
  activeFeed: ActiveFeed | null;
  schedule: FeedingSchedule[];
  events: FeedingEvent[];
  visits: PetVisit[];
  config: FeederConfig | null;
  snapshot: Snapshot | null;
  calibration: CalibrationInfo;
  pending: Partial<Record<CommandName, boolean>>;
  /** True when commands can be sent (connected and telemetry received, and link active). */
  canOperate: boolean;
  actions: {
    feed: (g: number) => Promise<boolean>;
    abort: () => Promise<boolean>;
    clearFault: () => Promise<boolean>;
    saveSchedule: (s: FeedingSchedule[]) => Promise<boolean>;
    saveConfig: (c: FeederConfig) => Promise<boolean>;
    tare: () => Promise<boolean>;
    calibrate: (knownG: number) => Promise<boolean>;
    refreshSnapshot: () => Promise<boolean>;
    reconnect: () => Promise<void>;
  };
  demo: {
    simulateDisconnect: () => void;
    injectFault: (c: FaultCode) => void;
    triggerVisit: (k: PetClass) => void;
    refillHopper: () => void;
    emptyBowl: () => void;
    resetDemo: () => Promise<boolean>;
  } | null;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

function getInitialMode(): DeviceMode {
  const saved = localStorage.getItem(MODE_STORAGE_KEY) as DeviceMode | null;
  if (saved === 'hardware' || saved === 'mock') return saved;
  return (import.meta.env.VITE_DEVICE_MODE as DeviceMode) === 'hardware' ? 'hardware' : 'mock';
}

function loadCalibration(): CalibrationInfo {
  const fallback: CalibrationInfo = {
    factor: DEFAULT_CAL_FACTOR,
    lastTaredAt: null,
    lastCalibratedAt: null,
    knownMassG: null,
  };
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (!raw) return fallback;
    const c = JSON.parse(raw) as Partial<CalibrationInfo>;
    return {
      factor: typeof c.factor === 'number' && Number.isFinite(c.factor) ? c.factor : fallback.factor,
      lastTaredAt: typeof c.lastTaredAt === 'string' ? c.lastTaredAt : null,
      lastCalibratedAt: typeof c.lastCalibratedAt === 'string' ? c.lastCalibratedAt : null,
      knownMassG: typeof c.knownMassG === 'number' ? c.knownMassG : null,
    };
  } catch {
    return fallback;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof DeviceError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Unexpected error';
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [mode, setModeState] = useState<DeviceMode>(getInitialMode);
  const [service, setService] = useState<DeviceService>(() => createDeviceService(getInitialMode()));
  const serviceRef = useRef(service);
  const refreshSequenceRef = useRef(0);

  const [connection, setConnection] = useState<DeviceConnectionState>('connecting');
  const [link, setLink] = useState(false);
  const [rssi, setRssi] = useState<number | null>(null);
  const [telemetry, setTelemetry] = useState<DeviceTelemetry | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);
  const [weightHistory, setWeightHistory] = useState<WeightPoint[]>([]);
  const [activeFeed, setActiveFeed] = useState<ActiveFeed | null>(null);
  const [schedule, setSchedule] = useState<FeedingSchedule[]>([]);
  const [events, setEvents] = useState<FeedingEvent[]>([]);
  const [visits, setVisits] = useState<PetVisit[]>([]);
  const [config, setConfig] = useState<FeederConfig | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [calibration, setCalibration] = useState<CalibrationInfo>(loadCalibration);
  const [pending, setPending] = useState<Partial<Record<CommandName, boolean>>>({});

  // Refs used by the event handler (avoids stale closures inside the subscription).
  const telemetryRef = useRef<DeviceTelemetry | null>(null);
  const scheduleRef = useRef<FeedingSchedule[]>([]);
  const prevStateRef = useRef<FeederState | null>(null);
  const prevFaultRef = useRef<FaultCode | null>(null);
  const pendingManualRef = useRef<{ grams: number; at: number } | null>(null);
  const wasLostRef = useRef(false);
  telemetryRef.current = telemetry;
  scheduleRef.current = schedule;

  useEffect(() => {
    try {
      localStorage.setItem(CAL_KEY, JSON.stringify(calibration));
    } catch {
      /* ignore */
    }
  }, [calibration]);

  const setMode = useCallback((newMode: DeviceMode) => {
    localStorage.setItem(MODE_STORAGE_KEY, newMode);
    setModeState(newMode);
    const newService = createDeviceService(newMode);
    serviceRef.current = newService;
    setService(newService);
    setConnection('connecting');
    setLink(false);
    setRssi(null);
    setTelemetry(null);
    setLastHeartbeat(null);
    setWeightHistory([]);
    setActiveFeed(null);
    setSchedule([]);
    setEvents([]);
    setVisits([]);
    setConfig(null);
    setSnapshot(null);
    pendingManualRef.current = null;
    toast.push({
      kind: 'info',
      title: newMode === 'hardware' ? 'Hardware Mode Active ⚡' : 'Demo Simulation Mode 🐾',
      message:
        newMode === 'hardware'
          ? 'Connecting to physical ESP32-CAM REST and SSE APIs via Vite proxy.'
          : 'Running realistic in-browser Smart Pet Feeder simulation.',
    });
  }, [toast]);

  /* ---------------- synchronisation ---------------- */

  const refreshAll = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    const [st, sc, lg, cf, vs, sn] = await Promise.allSettled([
      service.getStatus(),
      service.getSchedule(),
      service.getLog(),
      service.getConfig(),
      service.getPetVisits(),
      service.getSnapshot(),
    ]);

    // A slow prior-mode request must never overwrite the newly selected transport's state.
    if (serviceRef.current !== service || sequence !== refreshSequenceRef.current) return;

    if (st.status === 'fulfilled') {
      setConnection('connected');
      setLink(st.value.link);
      setRssi(st.value.rssi);
      setTelemetry(st.value.telemetry);
      setLastHeartbeat(null);
      prevStateRef.current = st.value.telemetry?.state ?? null;
      prevFaultRef.current = st.value.telemetry?.fault ?? null;
    } else if (service.mode === 'hardware') {
      setConnection('disconnected');
      setLink(false);
    }

    if (sc.status === 'fulfilled') setSchedule(sc.value);
    if (lg.status === 'fulfilled') setEvents(lg.value.slice(0, HISTORY_LIMIT));
    if (cf.status === 'fulfilled') setConfig(cf.value);
    if (vs.status === 'fulfilled') setVisits(vs.value);
    if (sn.status === 'fulfilled') setSnapshot(sn.value);
  }, [service]);

  /** Track transitions of the feeder state to derive the active job and fault notifications. */
  const onStateChange = useCallback(
    (state: FeederState, fault: FaultCode | null) => {
      const prev = prevStateRef.current;
      if (isActiveState(state) && (prev === null || !isActiveState(prev))) {
        if (service.mode === 'hardware') {
          // No WROOM telemetry or correlated operation IDs exist in this build.
          // State changes cannot safely be attributed to a dashboard request.
          setActiveFeed(null);
          prevStateRef.current = state;
          prevFaultRef.current = fault;
          return;
        }
        const manual = pendingManualRef.current;
        pendingManualRef.current = null;
        const now = new Date();
        let feed: ActiveFeed;
        if (manual && Date.now() - manual.at < 10_000) {
          feed = {
            targetG: manual.grams,
            source: 'manual',
            slot: null,
            startedAt: Date.now(),
            startWeightG: telemetryRef.current?.bowlWeightG ?? 0,
          };
        } else {
          const minNow = now.getHours() * 60 + now.getMinutes();
          const slot = scheduleRef.current.find(
            (s) =>
              s.enabled &&
              minNow - (s.hour * 60 + s.minute) >= 0 &&
              minNow - (s.hour * 60 + s.minute) <= 5
          );
          feed = {
            targetG: slot?.portionG ?? 0,
            source: 'scheduled',
            slot: slot?.slot ?? null,
            startedAt: Date.now(),
            startWeightG: telemetryRef.current?.bowlWeightG ?? 0,
          };
          toast.push({
            kind: 'info',
            title: 'Scheduled meal starting 🐕',
            message: slot ? `Slot ${slot.slot + 1} · ${slot.portionG} g` : undefined,
          });
        }
        setActiveFeed(feed);
      } else if (!isActiveState(state)) {
        setActiveFeed(null);
      }
      if (fault && fault !== prevFaultRef.current) {
        const info = FAULT_INFO[fault];
        toast.push({
          kind: fault === 'RTC' ? 'warning' : 'error',
          title: info.label,
          message: info.description,
        });
      }
      prevStateRef.current = state;
      prevFaultRef.current = fault;
    },
    [toast]
  );

  const handleEvent = useCallback(
    (evt: DeviceEvent) => {
      switch (evt.type) {
        case 'connection': {
          setConnection(evt.data.state);
          if (evt.data.state === 'disconnected') {
            if (!wasLostRef.current) {
              toast.push({
                kind: 'error',
                title: service.mode === 'hardware' ? 'ESP32 Unreachable' : 'Connection lost',
                message:
                  service.mode === 'hardware'
                    ? 'Cannot reach ESP32-CAM via HTTP/SSE. Check power and Wi-Fi.'
                    : 'Live data paused. Feeding controls are disabled until the feeder reconnects.',
              });
            }
            wasLostRef.current = true;
            setActiveFeed(null);
          } else if (evt.data.state === 'connected') {
            if (wasLostRef.current) {
              toast.push({
                kind: 'success',
                title: 'Connection restored 🐾',
                message: 'Live data is flowing again.',
              });
            }
            wasLostRef.current = false;
            void refreshAll();
          }
          return;
        }
        case 'telemetry': {
          const t = telemetryFromRaw(evt.data);
          setTelemetry(t);
          setLink(true);
          setLastHeartbeat(t.receivedAt);
          setWeightHistory((h) => {
            const last = h[h.length - 1];
            if (last && t.receivedAt - last.t < 900) return h;
            const cutoff = t.receivedAt - WEIGHT_WINDOW_MS;
            return [...h.filter((p) => p.t >= cutoff), { t: t.receivedAt, w: t.bowlWeightG }];
          });
          if (t.state !== prevStateRef.current || t.fault !== prevFaultRef.current) {
            onStateChange(t.state, t.fault);
          }
          return;
        }
        case 'status': {
          const { state, fault } = parseState(evt.data.st);
          setTelemetry((prev) => (prev ? { ...prev, state, fault } : prev));
          onStateChange(state, fault);
          return;
        }
        case 'log': {
          const ev = eventFromLog(evt.data, service.mode === 'mock');
          setEvents((prev) => [ev, ...prev.filter((p) => p.id !== ev.id)].slice(0, HISTORY_LIMIT));
          const info = RESULT_INFO[ev.result];
          const kind: ToastInput['kind'] =
            info.tone === 'ok' ? 'success' : info.tone === 'danger' ? 'error' : 'warning';
          const title =
            ev.result === 'OK'
              ? 'Feeding complete 🥣'
              : ev.result === 'ABORTED'
              ? 'Feeding aborted'
              : ev.result.startsWith('SKIP')
              ? 'Feeding skipped'
              : `Feeding finished: ${info.label}`;
          const amount =
            ev.result.startsWith('SKIP') || ev.result === 'LOW_FOOD'
              ? ''
              : ` ${grams(ev.dispensedG)} of ${ev.targetG} g dispensed.`;
          toast.push({ kind, title, message: `${info.explain}${amount}` });
          return;
        }
        case 'pet': {
          const v: PetVisit = {
            id: `v-${evt.data.ts}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: evt.data.ts,
            verdict: evt.data.pet ? 'PET' : 'NOPET',
            confidence: evt.data.conf,
            frames: evt.data.frames,
            topClass: evt.data.topClass,
            demo: service.mode === 'mock',
          };
          setVisits((prev) => [v, ...prev].slice(0, 60));
          service.getSnapshot().then(setSnapshot).catch(() => undefined);
          if (v.verdict === 'PET') {
            toast.push({
              kind: 'info',
              title: 'Pet detected 🐾',
              message: `TinyML verdict · ${v.confidence}% confidence`,
            });
          }
          return;
        }
        case 'low_food':
          toast.push({
            kind: 'warning',
            title: 'Hopper running low 🦴',
            message: evt.data.pct < 0
              ? 'The device reported a low hopper threshold; exact percentage is unavailable.'
              : `Only ${evt.data.pct}% left — time to refill the hopper.`,
          });
          return;
        case 'error':
          if (evt.data.err === 'JAM' || evt.data.err === 'SENSOR') return; // reported via status
          toast.push({
            kind: 'error',
            title: 'Device error',
            message: evt.data.nak ?? evt.data.err ?? 'Unknown error',
          });
          return;
      }
    },
    [onStateChange, refreshAll, service, toast]
  );

  const handlerRef = useRef(handleEvent);
  handlerRef.current = handleEvent;

  useEffect(() => {
    const unsub = service.subscribe((e) => {
      if (serviceRef.current === service) handlerRef.current(e);
    });
    void refreshAll();
    return () => unsub();
  }, [service, refreshAll]);

  // The CAM↔WROOM UART link can change while the browser stays connected (e.g. WROOM
  // boots after the CAM), and SSE telemetry is not forwarded, so re-poll /api/status.
  useEffect(() => {
    if (service.mode !== 'hardware') return;
    const id = window.setInterval(async () => {
      try {
        const st = await service.getStatus();
        if (serviceRef.current !== service) return;
        setLink(st.link);
        setRssi(st.rssi);
      } catch {
        /* connection loss is reported via the 'connection' event */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [service]);

  /* ---------------- command helper ---------------- */

  const run = useCallback(
    async <T,>(name: CommandName, fn: () => Promise<T>, errorTitle: string): Promise<T | null> => {
      setPending((p) => ({ ...p, [name]: true }));
      try {
        return await fn();
      } catch (e) {
        toast.push({ kind: 'error', title: errorTitle, message: errorMessage(e) });
        return null;
      } finally {
        setPending((p) => ({ ...p, [name]: false }));
      }
    },
    [toast]
  );

  const actions = useMemo<DeviceContextValue['actions']>(
    () => ({
      feed: async (g) => {
        if (service.mode === 'mock') pendingManualRef.current = { grams: g, at: Date.now() };
        const r = await run('feed', () => service.feed(g), 'Feed request rejected');
        if (!r) {
          pendingManualRef.current = null;
          return false;
        }
        toast.push({
          kind: 'success',
          title: 'Request accepted by CAM',
          message: service.mode === 'hardware'
            ? 'The CAM returned HTTP 202. WROOM acceptance, dispensing, and completion are not confirmed.'
            : `Dispensing ${g} g — watch the progress below. 🥣`,
        });
        return true;
      },
      abort: async () => !!(await run('abort', () => service.abort(), 'Abort failed')),
      clearFault: async () => {
        const r = await run('clear', () => service.clearFault(), 'Could not clear the fault');
        if (r) {
          toast.push({
            kind: 'info',
            title: 'Fault clear request accepted',
            message: 'The device has not confirmed that the fault was cleared.',
          });
          prevFaultRef.current = null;
          void service
            .getStatus()
            .then((s) => setTelemetry(s.telemetry))
            .catch(() => undefined);
        }
        return !!r;
      },
      saveSchedule: async (slots) => {
        const r = await run(
          'schedule',
          async () => {
            await service.putSchedule(slots);
            return service.getSchedule();
          },
          'Schedule not saved'
        );
        if (r) {
          setSchedule(r);
          toast.push({
            kind: 'info',
            title: 'Schedule update accepted',
            message: 'The CAM echoed the submitted schedule; WROOM storage was not confirmed.',
          });
        }
        return !!r;
      },
      saveConfig: async (c) => {
        const r = await run('config', () => service.setConfig(c), 'Settings not saved');
        if (r) {
          setConfig(c);
          toast.push({
            kind: 'info',
            title: 'Settings update accepted',
            message: 'The device has not confirmed that the new limits were applied.',
          });
        }
        return !!r;
      },
      tare: async () => {
        const r = await run('tare', () => service.tare(), 'Tare failed');
        if (r) {
          toast.push({ kind: 'info', title: 'Tare request accepted', message: 'The device has not confirmed that the scale was tared.' });
        }
        return !!r;
      },
      calibrate: async (knownG) => {
        const r = await run(
          'calibrate',
          () => service.calibrate(knownG),
          'Calibration failed'
        );
        if (r) {
          toast.push({
            kind: 'info',
            title: 'Calibration request accepted',
            message: 'The device has not confirmed calibration or the reported scale factor.',
          });
        }
        return !!r;
      },
      refreshSnapshot: async () => {
        const r = await run('snapshot', () => service.getSnapshot(), 'Snapshot unavailable');
        if (r) setSnapshot(r);
        return !!r;
      },
      reconnect: async () => {
        setPending((p) => ({ ...p, reconnect: true }));
        try {
          await service.reconnect();
          await refreshAll();
        } finally {
          setPending((p) => ({ ...p, reconnect: false }));
        }
      },
    }),
    [run, service, toast, refreshAll]
  );

  const demo = useMemo<DeviceContextValue['demo']>(() => {
    const d = service.demo;
    if (!d) return null;
    return {
      simulateDisconnect: () => d.simulateConnectionLoss(),
      injectFault: (c) => d.injectFault(c),
      triggerVisit: (k) => d.triggerVisit(k),
      refillHopper: () => {
        d.refillHopper();
        toast.push({
          kind: 'success',
          title: 'Hopper refilled 🦴',
          message: 'Simulated hopper is back to 100%.',
        });
      },
      emptyBowl: () => {
        d.emptyBowl();
        toast.push({
          kind: 'info',
          title: 'Bowl licked clean 🐶',
          message: 'Simulated bowl weight reset to near zero.',
        });
      },
      resetDemo: async () => {
        setPending((p) => ({ ...p, reset: true }));
        try {
          await d.reset();
          localStorage.removeItem(CAL_KEY);
          setCalibration(loadCalibration());
          setWeightHistory([]);
          setActiveFeed(null);
          prevFaultRef.current = null;
          wasLostRef.current = false;
          await refreshAll();
          toast.push({
            kind: 'success',
            title: 'Demo data restored',
            message: 'Telemetry, schedules, history and settings were reset.',
          });
          return true;
        } catch (e) {
          toast.push({ kind: 'error', title: 'Reset failed', message: errorMessage(e) });
          return false;
        } finally {
          setPending((p) => ({ ...p, reset: false }));
        }
      },
    };
  }, [refreshAll, service, toast]);

  const value: DeviceContextValue = {
    mode,
    setMode,
    isDemo: service.mode === 'mock',
    integrationNotice: service.mode === 'hardware'
      ? 'CAM connectivity is separate from feeder status. This firmware does not provide verifiable WROOM telemetry, command acknowledgements, schedule/config readback, or complete feeding history; affected hardware controls are unavailable.'
      : null,
    connection,
    link,
    rssi,
    telemetry,
    lastHeartbeat,
    weightHistory,
    activeFeed,
    schedule,
    events,
    visits,
    config,
    snapshot,
    calibration,
    pending,
    canOperate: service.mode === 'mock'
      ? connection === 'connected' && telemetry !== null
      : false,
    actions,
    demo,
  };

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice must be used inside <DeviceProvider>');
  return ctx;
}
