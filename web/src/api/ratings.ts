import { api } from './client';

export interface PublicReview {
  id: string;
  stars: number;
  comment: string;
  platform: string;
  author: string;
  updatedAt: string;
}

export interface RatingSummary {
  count: number;
  average: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  recent: PublicReview[];
}

export interface MyRating {
  stars: number;
  comment: string;
  updatedAt: string;
}

export interface AdminRating {
  id: string;
  stars: number;
  comment: string;
  platform: string;
  appVersion: string | null;
  userName: string | null;
  userEmail: string | null;
  updatedAt: string;
}

export const platformName = (): 'web' | 'windows' => (window.guardianDesktop ? 'windows' : 'web');

export async function getRatingSummary(): Promise<RatingSummary> {
  const { data } = await api.get<RatingSummary>('/ratings/summary');
  return data;
}

export async function getMyRating(): Promise<MyRating | null> {
  const { data } = await api.get<{ rating: MyRating | null }>('/ratings/mine');
  return data.rating;
}

export async function rateApp(body: {
  stars: number;
  comment?: string;
}): Promise<{ rating: MyRating; summary: RatingSummary }> {
  const { data } = await api.put<{ rating: MyRating; summary: RatingSummary }>('/ratings/mine', {
    ...body,
    platform: platformName(),
    appVersion: __APP_VERSION__,
  });
  return data;
}

export async function removeMyRating(): Promise<RatingSummary> {
  const { data } = await api.delete<{ summary: RatingSummary }>('/ratings/mine');
  return data.summary;
}

export async function adminRatings(): Promise<{ summary: RatingSummary; ratings: AdminRating[] }> {
  const { data } = await api.get<{ summary: RatingSummary; ratings: AdminRating[] }>('/admin/ratings');
  return data;
}
