import axios from 'axios';
import { api } from './client';
import { withOfflineFallback } from '../lib/offlineCache';
import type { Driver, PhotoReport, SensorLogPoint, SimilarFace, Thresholds } from './types';

export function listDrivers(): Promise<Driver[]> {
  return withOfflineFallback('drivers', async () => {
    const { data } = await api.get<{ drivers: Driver[] }>('/drivers');
    return data.drivers;
  });
}

export function getDriver(id: string): Promise<Driver> {
  return withOfflineFallback(`driver:${id}`, async () => {
    const { data } = await api.get<{ driver: Driver }>(`/drivers/${id}`);
    return data.driver;
  });
}

export interface CreateDriverInput {
  name: string;
  relationship: string;
  /** base64 JPEG data URLs: front, left, right. The backend computes embeddings. */
  photos: string[];
  /** The parent confirmed a face matching an existing driver is a different person (twins). */
  confirmLookalike?: boolean;
}

export interface PhotoCheck {
  ok: boolean;
  problem: 'no_face' | 'multiple_faces' | 'different_person' | null;
  message: string | null;
  quality?: number;
  /** Front photo only: registered drivers with the same face (possible duplicate or twin). */
  matches: SimilarFace[];
}

/** Validate one photo as it is taken: one face, and side photos the same person as `front`. */
export async function checkPhoto(photo: string, front?: string): Promise<PhotoCheck> {
  const { data } = await api.post<PhotoCheck>('/drivers/check-photo', { photo, front }, { timeout: 60000 });
  return data;
}

/** Registration refused because the face matches an already registered driver → those drivers. */
export function faceMatchesFromError(err: unknown): SimilarFace[] | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return null;
  const details = (err.response.data as { details?: { code?: string; matches?: SimilarFace[] } })?.details;
  return details?.code === 'FACE_MATCHES_DRIVER' ? (details.matches ?? []) : null;
}

export interface CreateDriverResult {
  driverId: string;
  driver: Driver;
  quality: number;
  photos: PhotoReport[];
  /** Already-registered drivers with a near-identical face (e.g. twins). */
  similarFaces?: SimilarFace[];
}

/** Same rule as the backend: case-, spacing- and width-insensitive. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

/** Client-side twin check against the loaded list (the server enforces it too). */
export function findDuplicateName(name: string, drivers: Pick<Driver, 'name'>[]): string | null {
  const key = nameKey(name);
  if (!key) return null;
  return drivers.find((d) => nameKey(d.name) === key)?.name ?? null;
}

export async function createDriver(input: CreateDriverInput): Promise<CreateDriverResult> {
  const { data } = await api.post<CreateDriverResult>('/drivers', input, { timeout: 60000 });
  return data;
}

export async function updateThresholds(id: string, patch: Partial<Thresholds>): Promise<Driver> {
  const { data } = await api.patch<{ driver: Driver }>(`/drivers/${id}/thresholds`, patch);
  return data.driver;
}

/** How deleting is confirmed: a code e-mailed to the account, or (no e-mail on the server) the name. */
export type DeleteCodeResult =
  { method: 'email'; email: string; sent: boolean; retryAfterS: number } | { method: 'name' };

export async function requestDeleteCode(id: string): Promise<DeleteCodeResult> {
  const { data } = await api.post<DeleteCodeResult>(`/drivers/${id}/delete-code`);
  return data;
}

export async function deleteDriver(id: string, confirm: { code?: string; confirmName?: string }): Promise<void> {
  await api.delete(`/drivers/${id}`, { data: confirm });
}

export interface HistoryRow {
  /** Last reading of this minute, and the first one. */
  at: string;
  from: string;
  readings: number;
  classification: 'alert' | 'warning' | 'drowsy';
  ear: number | null;
  perclos: number | null;
  heartRate: number | null;
  fusionScore: number | null;
  source: string;
  location: { lat: number; lng: number; speed?: number } | null;
  /** Driven since the previous minute with a location, and in total since the start of the range. */
  km: number;
  totalKm: number;
}

export interface DriverHistory {
  from: string;
  to: string;
  totalKm: number;
  lastReading: {
    at: string;
    classification: 'alert' | 'warning' | 'drowsy';
    fusionScore: number;
    source: string;
    location: { lat: number; lng: number; speed?: number } | null;
  } | null;
  rows: HistoryRow[];
}

export async function driverHistory(id: string, range: { from?: string; to?: string } = {}): Promise<DriverHistory> {
  const { data } = await api.get<DriverHistory>(`/drivers/${id}/history`, { params: range });
  return data;
}

export async function driverLogs(id: string, limit = 120): Promise<SensorLogPoint[]> {
  const { data } = await api.get<{ logs: SensorLogPoint[] }>(`/drivers/${id}/logs`, {
    params: { limit },
  });
  return data.logs;
}

export async function verifyDriver(id: string, photo: string): Promise<{ match: boolean; confidence: number }> {
  const { data } = await api.post<{ match: boolean; confidence: number }>(
    `/drivers/${id}/verify`,
    { photo },
    { timeout: 30000 },
  );
  return data;
}
