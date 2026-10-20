import { api } from './client';
import { platformName } from './ratings';

export type QuestionType = 'single' | 'multiple' | 'rating' | 'yesno' | 'text';
export type SurveyStatus = 'draft' | 'open' | 'closed';

export interface SurveyQuestion {
  qid?: string;
  text: string;
  type: QuestionType;
  options: string[];
  required: boolean;
}

export interface Survey {
  id: string;
  title: string;
  description: string;
  questions: Required<SurveyQuestion>[];
  status: SurveyStatus;
  audience: 'everyone' | 'parents';
  source: { fileName: string; format: string } | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  responses?: number;
  answered?: boolean;
  answeredAt?: string | null;
}

export interface SurveyDraft {
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  source?: { fileName: string; format: string };
}

export interface OptionCount {
  option: string;
  count: number;
  pct: number;
}

export interface QuestionResult {
  qid: string;
  text: string;
  type: QuestionType;
  answered: number;
  skipped: number;
  counts?: OptionCount[];
  average?: number | null;
  answers?: string[];
}

export interface SurveyResults {
  survey: Survey;
  total: number;
  perDay: { day: string; count: number }[];
  questions: QuestionResult[];
}

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: 'One choice',
  multiple: 'Several choices',
  rating: 'Rating (1-5 stars)',
  yesno: 'Yes / No',
  text: 'Written answer',
};

// ---------------------------------------------------------------- users
export async function openSurveys(): Promise<Survey[]> {
  const { data } = await api.get<{ surveys: Survey[] }>('/surveys');
  return data.surveys;
}

export type AnswerValue = string | string[] | number;

export async function answerSurvey(id: string, answers: { qid: string; value: AnswerValue }[]): Promise<void> {
  await api.post(`/surveys/${id}/responses`, { answers, platform: platformName() });
}

// ---------------------------------------------------------------- admin
export async function adminSurveys(): Promise<Survey[]> {
  const { data } = await api.get<{ surveys: Survey[] }>('/admin/surveys');
  return data.surveys;
}

export async function importSurveyFile(file: File): Promise<SurveyDraft> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
  const { data } = await api.post<{ draft: SurveyDraft }>('/admin/surveys/import', { name: file.name, data: dataUrl });
  return data.draft;
}

export async function createSurvey(draft: SurveyDraft): Promise<Survey> {
  const { data } = await api.post<{ survey: Survey }>('/admin/surveys', draft);
  return data.survey;
}

export async function updateSurvey(id: string, draft: Partial<SurveyDraft>): Promise<Survey> {
  const { data } = await api.patch<{ survey: Survey }>(`/admin/surveys/${id}`, draft);
  return data.survey;
}

export async function setSurveyStatus(id: string, action: 'publish' | 'close'): Promise<Survey> {
  const { data } = await api.post<{ survey: Survey }>(`/admin/surveys/${id}/${action}`);
  return data.survey;
}

export async function deleteSurvey(id: string): Promise<void> {
  await api.delete(`/admin/surveys/${id}`);
}

export async function surveyResults(id: string): Promise<SurveyResults> {
  const { data } = await api.get<SurveyResults>(`/admin/surveys/${id}/results`);
  return data;
}

/** Downloads the Excel file (Summary + Responses sheets). */
export async function downloadSurveyExcel(id: string, title: string): Promise<void> {
  const { data } = await api.get<Blob>(`/admin/surveys/${id}/export.xlsx`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${
    title
      .replace(/[^a-z0-9 _-]/gi, '')
      .trim()
      .replace(/\s+/g, '_') || 'survey'
  }_results.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
