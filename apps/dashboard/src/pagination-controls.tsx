import { ChevronLeft, ChevronRight } from "lucide-react";

export function PaginationControls({
  page,
  pageCount,
  start,
  end,
  total,
  onPageChange
}: {
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= 0) return null;

  return (
    <div className="pagination-bar">
      <div className="pagination-summary">
        当前显示 <strong>{start}-{end}</strong>，共 <strong>{total}</strong> 条
      </div>
      <div className="pagination-actions" aria-label="分页导航">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="上一页">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span>第 {page} / {pageCount} 页</span>
        <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="下一页">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
