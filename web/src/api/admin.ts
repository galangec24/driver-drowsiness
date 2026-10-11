import { api } from './client';

export type JobType =
  'fetch_dataset' | 'train_verifier' | 'train_eye_state' | 'calibrate_yawn' | 'process_videos' | 'import_uploads';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ModelKind = 'fp_verifier' | 'eye_state' | 'yawn_threshold';

export interface TrainingJob {
  id: string;
  type: JobType;
  params: Record<string, unknown>;
  status: JobStatus;
  error: string | null;
  releaseId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Machine that ran it (e.g. the laptop running `npm run worker`). */
  worker?: string | null;
  log?: string;
}

export interface ModelRelease {
  id: string;
  kind: ModelKind;
  status: 'candidate' | 'active' | 'retired';
  jobId: string | null;
  summary: Record<string, unknown>;
  createdAt: string;
  promotedAt: string | null;
  report?: string;
  metrics?: Record<string, unknown>;
}

export interface WorkerInfo {
  enabled: boolean;
  mlPython: string | null;
  monitorPython: string | null;
  mlDir: string;
  videosDir: string;
  problems: string[];
  /** local: this server trains; remote: a laptop worker is online; none: nobody can train. */
  mode?: 'local' | 'remote' | 'none';
  host?: string | null;
  lastSeen?: string;
}

export interface ParentDriver {
  id: string;
  name: string;
  relationship: string;
  faceEnrolled: boolean;
  online: boolean;
  createdAt: string;
}

export interface ParentRow {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  signIn: 'password' | 'google' | 'google+password';
  createdAt: string;
  drivers: ParentDriver[];
  driverCount: number;
  onlineDrivers: number;
  alertsTotal: number;
  alerts7d: number;
  lastAlertAt: string | null;
}

export interface ParentsResponse {
  parents: ParentRow[];
  totals: { accounts: number; parents: number; unverified: number; drivers: number; onlineDrivers: number };
}

export async function getParents(): Promise<ParentsResponse> {
  return (await api.get<ParentsResponse>('/admin/parents')).data;
}

export interface CatalogDataset {
  id: string;
  title: string;
  source: 'kaggle' | 'manual';
  slug?: string;
  url?: string;
  sizeMb?: number;
  task: 'eye_state' | 'yawn_calibration' | 'video' | 'reference';
  preset?: 'rldd' | 'folders';
  description: string;
  local: {
    ready?: boolean;
    images?: number;
    open?: number;
    closed?: number;
    lastCalibrated?: string | null;
    folder?: string;
    videos?: number;
    processed?: boolean;
  };
}

export interface DatasetsResponse {
  catalog: CatalogDataset[];
  synthetic: { main: Record<string, unknown> | null; shift: Record<string, unknown> | null };
  recordings: { name: string; drivers: number | null; rows?: number; sessions?: number }[];
  uploads: number;
  feedback: { labelled: number; falseAlarms: number; realAlarms: number; withWindow: number };
  videosDir: string;
}

export interface Overview {
  counts: { parents: number; drivers: number; alerts7d: number; alertsByType: Record<string, number> };
  feedback: { labelled: number; falseAlarms: number; falseAlarmRate: number | null };
  models: Record<ModelKind, (ModelRelease & { bundled?: undefined }) | { bundled: true; [k: string]: unknown }>;
  worker: WorkerInfo;
  lastJob: TrainingJob | null;
}

export async function getOverview(): Promise<Overview> {
  return (await api.get<Overview>('/admin/overview')).data;
}

export async function getDatasets(): Promise<DatasetsResponse> {
  return (await api.get<DatasetsResponse>('/admin/datasets')).data;
}

export async function uploadRecording(name: string, content: string): Promise<{ file: string; rows: number }> {
  return (await api.post('/admin/recordings', { name, content }, { timeout: 60000 })).data;
}

export async function listJobs(): Promise<{ jobs: TrainingJob[]; busy: boolean }> {
  return (await api.get('/admin/jobs')).data;
}

export async function getJob(id: string): Promise<TrainingJob> {
  return (await api.get<{ job: TrainingJob }>(`/admin/jobs/${id}`)).data.job;
}

export async function startJob(type: JobType, params: Record<string, unknown> = {}): Promise<TrainingJob> {
  return (await api.post<{ job: TrainingJob }>('/admin/jobs', { type, params })).data.job;
}

export async function cancelJob(id: string): Promise<TrainingJob> {
  return (await api.post<{ job: TrainingJob }>(`/admin/jobs/${id}/cancel`)).data.job;
}

export async function listModels(): Promise<ModelRelease[]> {
  return (await api.get<{ releases: ModelRelease[] }>('/admin/models')).data.releases;
}

export async function getModel(id: string): Promise<ModelRelease> {
  return (await api.get<{ release: ModelRelease }>(`/admin/models/${id}`)).data.release;
}

export async function promoteModel(id: string): Promise<ModelRelease> {
  return (await api.post<{ release: ModelRelease }>(`/admin/models/${id}/promote`)).data.release;
}

export async function resetModel(kind: ModelKind): Promise<void> {
  await api.post(`/admin/models/reset/${kind}`);
}

export const JOB_LABEL: Record<JobType, string> = {
  fetch_dataset: 'Download dataset',
  train_verifier: 'Train false-alarm verifier',
  train_eye_state: 'Train eye model',
  calibrate_yawn: 'Calibrate yawn detector',
  process_videos: 'Process video dataset',
  import_uploads: 'Import uploaded recordings',
};

export const MODEL_LABEL: Record<ModelKind, string> = {
  fp_verifier: 'False-alarm verifier',
  eye_state: 'Eye open/closed model',
  yawn_threshold: 'Yawn threshold',
};
