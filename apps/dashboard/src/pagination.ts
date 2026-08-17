export interface PageSlice<T> {
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  start: number;
  end: number;
}

export function slicePage<T>(items: T[], requestedPage: number, pageSize: number): PageSlice<T> {
  const normalizedPageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / normalizedPageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage)));
  const startIndex = (page - 1) * normalizedPageSize;
  const endIndex = Math.min(startIndex + normalizedPageSize, items.length);

  return {
    items: items.slice(startIndex, endIndex),
    page,
    pageCount,
    pageSize: normalizedPageSize,
    total: items.length,
    start: items.length ? startIndex + 1 : 0,
    end: endIndex
  };
}
