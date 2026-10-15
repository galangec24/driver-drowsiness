export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface Thresholds {
  earThreshold: number;
  perclosThreshold: number;
  drowsyDurationMs: number;
  fusionWeightVision: number;
  fusionWeightPhysio: number;
  /** Yawns in 5 minutes that count as full evidence (alone → warning). */
  yawnThreshold: number;
  fusionWeightYawn: number;
  /** Fractional HR drop below the driver's own baseline that counts as full evidence. */
  hrDropThreshold: number;
  /** Fractional breathing-rate drop below the driver's baseline (dashboard radar) = full evidence. */
  breathDropThreshold: number;
  /** Head nods in 5 minutes that mean the driver is falling asleep (→ drowsy). */
  nodThreshold: number;
  fusionWeightNod: number;
}

/** GPS fix from the in-car device. heading = degrees clockwise from north, speed = km/h. */
export interface GeoLocation {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  at?: string;
}

export type Classification = 'alert' | 'warning' | 'drowsy';
export type DriverStatus = Classification | 'offline';

export interface Driver {
  id: string;
  parentId: string;
  name: string;
  relationship: string;
  referencePhotoUrl: string;
  personalThresholds: Thresholds;
  faceEnrolled: boolean;
  enrollment?: { photoCount: number; quality: number; enrolledAt?: string };
  lastTunedAt?: string;
  createdAt: string;
  status: DriverStatus;
  lastUpdate: string | null;
  lastLocation?: GeoLocation | null;
}

export interface Signals {
  ear?: number;
  perclos?: number;
  heartRate?: number;
  faceConfidence?: number;
  /** BLE wearable: HRV (RMSSD, ms) and the driver's personal HR baseline. */
  hrv?: number;
  hrBaseline?: number;
  /** Yawns in the last 5 minutes (camera). */
  yawnCount?: number;
  /** Head nods (falling forward) in the last 5 minutes (camera). */
  nodCount?: number;
  mar?: number;
  /** Dashboard radar: breaths per minute and the driver's personal baseline. */
  breathingRate?: number;
  breathingBaseline?: number;
}

export interface RadarStatus {
  connected: boolean;
  present?: boolean | null;
  distanceCm?: number | null;
}

export interface WearableStatus {
  connected: boolean;
  contact?: boolean | null;
  battery?: number | null;
  name?: string | null;
}

/** Socket.io `driver:status` payload. */
export interface DriverLiveStatus {
  driverId: string;
  status: Classification;
  lastUpdate: string;
  fusionScore?: number;
  signals?: Signals;
  source?: string;
  location?: GeoLocation | null;
  wearable?: WearableStatus;
  radar?: RadarStatus;
}

export type AlertType = 'drowsy' | 'microsleep' | 'distraction' | 'face_match' | 'warning' | 'yawning' | 'nodding';
export type AckSource = 'apk' | 'web' | 'unknown';

export interface Alert {
  id: string;
  driverId: string;
  parentId: string;
  type: AlertType;
  confidence: number;
  sensorSnapshot: Signals & { timestamp?: string };
  /** Where the car was when the alert fired. */
  location?: GeoLocation | null;
  /** Camera frame of the driver at the trigger moment (relative /uploads/... or absolute). */
  snapshotUrl?: string | null;
  /** Recorded while the car had no internet and delivered this many seconds later. */
  delayedS?: number | null;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: AckSource;
  /** Parent feedback: true = false alarm, false = real, null = not labelled. */
  falseAlarm?: boolean | null;
  createdAt: string;
  driverName?: string | null;
}

export interface AlertsResponse {
  alerts: Alert[];
  unacknowledged: number;
}

export interface SensorLogPoint {
  signals: Signals;
  classification: Classification;
  fusionScore: number;
  source: string;
  createdAt: string;
}

export interface SimilarFace {
  driverId: string;
  name: string;
  confidence: number;
}

export interface PhotoReport {
  index: number;
  quality: number;
  issues: string[];
}
