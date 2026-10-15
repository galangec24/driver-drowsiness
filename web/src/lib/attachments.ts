/** Client-side checks for feedback attachments (the server checks again, by content). */
export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ACCEPT = 'image/*,.pdf,.txt,.log,.csv,.json';

export interface PendingFile {
  name: string;
  size: number;
  type: string;
  /** data URL */
  data: string;
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

/** Adds files within the limits; returns the new list and a message for anything refused. */
export async function addFiles(
  current: PendingFile[],
  files: File[],
): Promise<{ list: PendingFile[]; problem: string | null }> {
  const list = [...current];
  let problem: string | null = null;
  for (const f of files) {
    if (list.length >= MAX_FILES) {
      problem = `You can attach up to ${MAX_FILES} files.`;
      break;
    }
    if (f.size > MAX_FILE_BYTES) {
      problem = `"${f.name}" is larger than 5 MB.`;
      continue;
    }
    list.push({ name: f.name || 'pasted-image.png', size: f.size, type: f.type, data: await readAsDataUrl(f) });
  }
  return { list, problem };
}

/** "Capture screen" is possible in desktop browsers (not on phones: attach a screenshot there). */
export function canCaptureScreen(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/** Ask the browser to share a screen/window/tab, grab one frame as a JPEG, stop sharing. */
export async function captureScreen(): Promise<PendingFile> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 300)); // let the first real frame arrive
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, 1));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    return {
      name: `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`,
      size: Math.round((data.length * 3) / 4),
      type: 'image/jpeg',
      data,
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
