function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))];
}

export function categoryEvidenceKey(category = {}) {
  const tag = String(category?.tag ?? "").trim();
  if (tag) return `tag:${tag}`;
  const displayName = String(category?.displayName ?? category?.name ?? "").trim();
  if (displayName) return `name:${displayName}`;
  return `position:${category?.i ?? ""}|${category?.j ?? ""}`;
}

export function buildCategoryUnionCoverage(categoryEvents = [], productRows = []) {
  const groups = new Map();

  for (const event of categoryEvents) {
    if (event?.event !== "category_done") continue;
    const key = categoryEvidenceKey(event.category);
    const group = groups.get(key) || {
      key,
      category: event.category || {},
      observedSpuIds: new Set(),
      capturedSpuIds: new Set(),
      accountIds: new Set(),
      evidenceCount: 0
    };
    for (const id of normalizeIds(event?.evidence?.observedAllSpuIds)) group.observedSpuIds.add(id);
    const accountId = String(event?.account?.accountId ?? event?.evidence?.accountId ?? "").trim();
    if (accountId) group.accountIds.add(accountId);
    group.evidenceCount += 1;
    groups.set(key, group);
  }

  for (const row of productRows) {
    const id = String(row?.productRaw?.id ?? row?.productRaw?.spu_id ?? row?.productIndex?.spuId ?? "").trim();
    if (!id) continue;
    const key = categoryEvidenceKey(row.category);
    const group = groups.get(key);
    if (group) group.capturedSpuIds.add(id);
  }

  return [...groups.values()].map((group) => {
    const observedSpuIds = [...group.observedSpuIds];
    const capturedSpuIds = [...group.capturedSpuIds];
    const missingSpuIds = observedSpuIds.filter((id) => !group.capturedSpuIds.has(id));
    return {
      key: group.key,
      category: group.category,
      observedSpuIds,
      capturedSpuIds,
      missingSpuIds,
      accountIds: [...group.accountIds],
      evidenceCount: group.evidenceCount,
      completed: observedSpuIds.length > 0 && missingSpuIds.length === 0
    };
  });
}
