export type VisitCategory = 'in_city' | 'out_city';
export const VISIT_CATEGORY_LABELS = { in_city: 'Dalam kota', out_city: 'Luar kota' };

export interface VisitTask {
  id: string;
  label: string;
  requirePhoto: boolean;
}
export interface VisitAnswer {
  answer: 'ya' | 'tidak';
  note: string;
  photoUrl?: string;
  photoGeo?: VisitPhotoGeo;
}
export interface VisitPhotoGeo {
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
}
export interface VisitPolicy {
  storeNo: string;
  storeName: string;
  manager: string;
  city: string;
  category: VisitCategory;
  intervalDays: number;
  minimumVisits: number;
}
export interface VisitStore {
  id: number;
  storeNo: string;
  name: string;
  areaName: string;
  hasCoordinates: boolean;
  policy: VisitPolicy | null;
  progress: { completed: number; remaining: number; dueDate: string | null; lastVisit: string | null };
}
export interface StoreVisitRecord {
  id: string;
  storeId: number;
  visitedAt: string;
  visitorName: string | null;
  photoUrl: string;
  photoGeo: VisitPhotoGeo;
  lat: string;
  lng: string;
  accuracy: string;
  distanceM: number;
  tasks: VisitTask[];
  answers: Record<string, VisitAnswer>;
  notes: string;
}
export interface VisitDetail {
  store: VisitStore;
  tasks: VisitTask[];
  version: number;
  canSubmit: boolean;
  visits: StoreVisitRecord[];
}
