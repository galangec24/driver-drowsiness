import { api } from './client';

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'other';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved';

export interface FeedbackAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
}

export interface Feedback {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  category: FeedbackCategory;
  message: string;
  attachments: FeedbackAttachment[];
  context: { page?: string; platform?: string; appVersion?: string; userAgent?: string };
  status: FeedbackStatus;
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export interface NewFeedback {
  category: FeedbackCategory;
  message: string;
  /** data URLs (base64) with the original file names. */
  attachments: { name: string; data: string }[];
  page?: string;
  platform: 'web' | 'windows';
  appVersion: string;
}

export async function sendFeedback(body: NewFeedback): Promise<Feedback> {
  return (await api.post<{ feedback: Feedback }>('/feedback', body, { timeout: 120000 })).data.feedback;
}

export async function myFeedback(): Promise<Feedback[]> {
  return (await api.get<{ feedback: Feedback[] }>('/feedback/mine')).data.feedback;
}

export async function adminFeedback(status?: FeedbackStatus) {
  return (
    await api.get<{ feedback: Feedback[]; counts: Record<FeedbackStatus, number> }>('/admin/feedback', {
      params: status ? { status } : {},
    })
  ).data;
}

export async function updateFeedback(id: string, patch: { status?: FeedbackStatus; reply?: string }) {
  return (await api.patch<{ feedback: Feedback }>(`/admin/feedback/${id}`, patch)).data.feedback;
}

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: 'Something is wrong',
  idea: 'Idea',
  question: 'Question',
  other: 'Other',
};

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'Received',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
