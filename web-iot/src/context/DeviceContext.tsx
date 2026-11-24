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
  | 'camera'
  | 'flash'
  | 'time'
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
  cameraOn: boolean;
  flashOn: boolean;
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
  canOperate: boolean;
  actions: {
    feed: (g: number, force?: boolean) => Promise<boolean>;
    abort: () => Promise<boolean>;
    clearFault: () => Promise<boolean>;
    saveSchedule: (s: FeedingSchedule[]) => Promise<boolean>;
    saveConfig: (c: FeederConfig) => Promise<boolean>;
    tare: () => Promise<boolean>;
    calibrate: (knownG: number) => Promise<boolean>;
    refreshSnapshot: (wake?: boolean) => Promise<boolean>;
    setCamera: (on: boolean) => Promise<boolean>;
    setFlash: (on: boolean) => Promise<boolean>;
    syncTime: () => Promise<boolean>;
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
  return (import.meta.env.VITE_DEVICE_MODE as DeviceMode) === 'mock' ? 'mock' : 'hardware';
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
  const [cameraOn, setCameraOn] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
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
    setCameraOn(false);
    setFlashOn(false);
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
          ? 'Connecting to ESP32-CAM Access Point (192.168.4.1).'
          : 'Running in-browser Smart Pet Feeder simulation.',
    });
  }, [toast]);

  const refreshAll = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    const [st, sc, lg, cf, vs] = await Promise.allSettled([
      service.getStatus(),
      service.getSchedule(),
      service.getLog(),
      service.getConfig(),
      service.getPetVisits(),
    ]);

    if (serviceRef.current !== service || sequence !== refreshSequenceRef.current) return;

    if (st.status === 'fulfilled') {
      setConnection('connected');
      setLink(st.value.link);
      setRssi(st.value.rssi);
      if (typeof st.value.cameraOn === 'boolean') setCameraOn(st.value.cameraOn);
      if (typeof st.value.flashOn === 'boolean') setFlashOn(st.value.flashOn);
      setTelemetry(st.value.telemetry);
      setLastHeartbeat(Date.now());
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
  }, [service]);

  const onStateChange = useCallback(
    (state: FeederState, fault: FaultCode | null) => {
      const prev = prevStateRef.current;
      if (isActiveState(state) && (prev === null || !isActiveState(prev))) {
        const manual = pendingManualRef.current;
        pendingManualRef.current = null;
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
          feed = {
            targetG: config?.irPortionG ?? 20,
            source: 'ir',
            slot: null,
            startedAt: Date.now(),
            startWeightG: telemetryRef.current?.bowlWeightG ?? 0,
          };
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
    [config, toast]
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
                title: service.mode === 'hardware' ? 'ESP32-CAM Unreachable' : 'Connection lost',
                message:
                  service.mode === 'hardware'
                    ? 'Cannot reach ESP32-CAM at 192.168.4.1. Connect to Wi-Fi AP "PetFeeder".'
                    : 'Live data paused.',
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
          setCameraOn(t.cameraOn);
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
        case 'camera': {
          setCameraOn(evt.data.on);
          return;
        }
        case 'log': {
          const ev = eventFromLog(evt.data, service.mode === 'mock');
          setEvents((prev) => [ev, ...prev.filter((p) => p.id !== ev.id)].slice(0, HISTORY_LIMIT));
          const info = RESULT_INFO[ev.result] ?? RESULT_INFO.OK;
          const kind: ToastInput['kind'] =
            info.tone === 'ok' ? 'success' : info.tone === 'danger' ? 'error' : 'warning';
          const title =
            ev.result === 'OK'
              ? 'Feeding complete 🥣'
              : ev.result === 'ABORTED'
              ? 'Feeding aborted'
              : ev.result.startsWith('SKIP')
              ? info.label
              : `Feeding finished: ${info.label}`;
          const amount =
            ev.result.startsWith('SKIP') || ev.result === 'LOW_FOOD'
              ? ''
              : ` ${grams(ev.dispensedG)} dispensed.`;
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
          setCameraOn(true);
          service.getSnapshot().then(setSnapshot).catch(() => undefined);
          if (v.verdict === 'PET') {
            toast.push({
              kind: 'info',
              title: 'IR Triggered · Camera ON 📷',
              message: 'Pet detected at the feeder — live feed activated.',
            });
          }
          return;
        }
        case 'low_food':
          toast.push({
            kind: 'warning',
            title: 'Low Food Warning 🦴',
            message: evt.data.pct < 0
              ? 'Hopper level is critically low — refill soon.'
              : `Only ${evt.data.pct}% left in hopper — time to refill.`,
          });
          return;
        case 'error':
          if (evt.data.err === 'JAM' || evt.data.err === 'SENSOR') return;
          toast.push({
            kind: 'warning',
            title: 'Feeder Notice',
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
      feed: async (g, force = false) => {
        pendingManualRef.current = { grams: g, at: Date.now() };
        const r = await run('feed', () => service.feed(g, force), 'Feed request rejected');
        if (!r) {
          pendingManualRef.current = null;
          return false;
        }
        toast.push({
          kind: 'success',
          title: 'Dispense command sent 🥣',
          message: `Requested ${g} g${force ? ' (cooldown override)' : ''}.`,
        });
        return true;
      },
      abort: async () => !!(await run('abort', () => service.abort(), 'Abort failed')),
      clearFault: async () => {
        const r = await run('clear', () => service.clearFault(), 'Could not clear fault');
        if (r) {
          toast.push({ kind: 'success', title: 'Fault clear sent', message: 'Feeder reset to IDLE.' });
          prevFaultRef.current = null;
          void refreshAll();
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
          toast.push({ kind: 'success', title: 'Schedule saved', message: 'Synced to ESP32-S NVS.' });
        }
        return !!r;
      },
      saveConfig: async (c) => {
        const r = await run('config', () => service.setConfig(c), 'Settings not saved');
        if (r) {
          setConfig(c);
          toast.push({ kind: 'success', title: 'Settings saved', message: `Cooldown T=${c.cooldownMin}m, bowl limit=${c.leftoverThresholdG}g.` });
        }
        return !!r;
      },
      tare: async () => {
        const r = await run('tare', () => service.tare(), 'Tare failed');
        if (r) toast.push({ kind: 'success', title: 'Scale tared', message: 'HX711 zeroed to 0 g.' });
        return !!r;
      },
      calibrate: async (knownG) => {
        const r = await run('calibrate', () => service.calibrate(knownG), 'Calibration failed');
        if (r) toast.push({ kind: 'success', title: 'Scale calibrated', message: `Calibrated with ${knownG} g.` });
        return !!r;
      },
      refreshSnapshot: async (wake = false) => {
        const r = await run('snapshot', () => service.getSnapshot(wake), 'Snapshot unavailable');
        if (r) setSnapshot(r);
        return !!r;
      },
      setCamera: async (on: boolean) => {
        if (!service.setCamera) {
          setCameraOn(on);
          return true;
        }
        const r = await run('camera', () => service.setCamera!(on), 'Camera toggle failed');
        if (r) {
          setCameraOn(r.on);
          toast.push({ kind: 'info', title: r.on ? 'Camera ON 📷' : 'Camera Standby', message: r.on ? 'Live feed streaming.' : 'Camera powered down.' });
        }
        return !!r;
      },
      setFlash: async (on: boolean) => {
        if (!service.setFlash) {
          setFlashOn(on);
          return true;
        }
        const r = await run('flash', () => service.setFlash!(on), 'Flash toggle failed');
        if (r) setFlashOn(r.flash === 'ON');
        return !!r;
      },
      syncTime: async () => {
        if (!service.syncTime) return false;
        const r = await run('time', () => service.syncTime!(), 'RTC sync failed');
        if (r) toast.push({ kind: 'success', title: 'RTC synced', message: 'DS3231 clock updated from browser.' });
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
        toast.push({ kind: 'success', title: 'Hopper refilled 🦴', message: 'Simulated hopper at 100%.' });
      },
      emptyBowl: () => {
        d.emptyBowl();
        toast.push({ kind: 'info', title: 'Bowl emptied 🐶', message: 'Simulated bowl weight reset.' });
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
          toast.push({ kind: 'success', title: 'Demo data restored', message: 'All demo values reset.' });
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
    integrationNotice: null,
    connection,
    link,
    rssi,
    cameraOn,
    flashOn,
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
    canOperate:
      service.mode === 'mock'
        ? connection === 'connected' && telemetry !== null
        : connection === 'connected' && link,
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
