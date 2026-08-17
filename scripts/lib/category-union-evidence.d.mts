export interface CategoryIdentity {
  i?: number;
  j?: number;
  name?: string;
  displayName?: string;
  tag?: string;
  [key: string]: unknown;
}

export interface CategoryEvidenceEvent {
  event?: string;
  category?: CategoryIdentity;
  account?: { accountId?: string };
  evidence?: {
    accountId?: string;
    observedAllSpuIds?: Array<string | number>;
  };
}

export interface CategoryProductEvidenceRow {
  category?: CategoryIdentity;
  productRaw?: { id?: string | number; spu_id?: string | number };
  productIndex?: { spuId?: string | number };
}

export interface CategoryUnionCoverage {
  key: string;
  category: CategoryIdentity;
  observedSpuIds: string[];
  capturedSpuIds: string[];
  missingSpuIds: string[];
  accountIds: string[];
  evidenceCount: number;
  completed: boolean;
}

export function categoryEvidenceKey(category?: CategoryIdentity): string;

export function buildCategoryUnionCoverage(
  categoryEvents?: CategoryEvidenceEvent[],
  productRows?: CategoryProductEvidenceRow[]
): CategoryUnionCoverage[];
