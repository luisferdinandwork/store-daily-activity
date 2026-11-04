export type VisitCategory = 'in_city' | 'out_city';
export const VISIT_CATEGORY_LABELS = { in_city: 'Dalam kota', out_city: 'Luar kota' };

export interface VisitTask {
  id: string;
  label: string;
  requirePhoto: boolean;
}
export interface VisitAnswer {
  /** 'ya' / 'tidak' = the old checklist; 'text' = a free-text field (see fields.ts), `note` holds the text. */
  answer: 'ya' | 'tidak' | 'text';
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
  areaId: number;
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
/** GET /api/ops/store-visits/[storeId] — the visit form's data (what was written lives in the Report). */
export interface VisitDetail {
  store: VisitStore;
  canSubmit: boolean;
}
/** GET /api/ops/store-visits/result/[visitId] — one saved visit, for the Report's preview. */
export interface VisitResult extends StoreVisitRecord {
  storeName: string;
  storeNo: string;
  areaName: string;
}
