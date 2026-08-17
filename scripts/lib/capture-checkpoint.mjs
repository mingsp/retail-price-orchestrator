export function durableProductIdsFromSeenKeys(seenKeys = []) {
  return new Set(
    seenKeys
      .map((key) => String(key).split(":").slice(2).join(":"))
      .filter(Boolean)
  );
}

export function categoryDurableProductIdsFromSeenKeys(seenKeys = [], category = {}) {
  const prefix = `${Number(category?.i)}:${Number(category?.j)}:`;
  return new Set(
    [...seenKeys]
      .map(String)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter(Boolean)
  );
}

export function missingDurableProductIds(allIds, durableProductIds, cachedProductIds = []) {
  const present = new Set([
    ...durableProductIds,
    ...cachedProductIds.map((id) => String(id)).filter(Boolean)
  ]);
  return allIds.map(String).filter(Boolean).filter((id) => !present.has(id));
}

export function categoryCompletionFromEvidence({
  observedAllSpuIds = [],
  durableCapturedSpuIds = [],
  expected = 0
} = {}) {
  const observed = [...new Set(observedAllSpuIds.map(String).filter(Boolean))];
  const durable = new Set([...durableCapturedSpuIds].map(String).filter(Boolean));
  const missingSpuIds = observed.filter((id) => !durable.has(id));
  const target = Math.max(observed.length, Math.max(0, Number(expected) || 0));
  const finalSpus = observed.length
    ? Math.max(observed.length - missingSpuIds.length, durable.size)
    : durable.size;
  const missingCount = Math.max(missingSpuIds.length, Math.max(0, target - finalSpus));

  return {
    finalAll: observed.length,
    target,
    finalSpus,
    missingSpuIds,
    missingCount,
    completed: missingCount === 0
  };
}

export function requiresPageFallback({ allIds = [], expected = 0, durableCount = 0 } = {}) {
  if (allIds.length > 0) return false;
  return Math.max(0, Number(expected) || 0) > Math.max(0, Number(durableCount) || 0);
}

export function isDurablyCompletedCategoryEvent(event = {}) {
  if (event?.event !== "category_done" || event?.final?.completed !== true) return false;
  const categoryExpected = Math.max(0, Number(event?.category?.product_count || 0));
  if (categoryExpected > Number(event?.final?.finalSpus || 0)) return false;
  const observedIds = Array.isArray(event?.evidence?.observedAllSpuIds)
    ? event.evidence.observedAllSpuIds.map(String).filter(Boolean)
    : [];
  const missingIds = Array.isArray(event?.evidence?.missingSpuIds)
    ? event.evidence.missingSpuIds.map(String).filter(Boolean)
    : [];
  if (observedIds.length > 0) return missingIds.length === 0;
  return event?.category?.metadataOnly === true && Number(event?.final?.finalAll || 0) === 0;
}

export function remainingCategoriesFromCheckpoint(
  categories,
  currentCategory,
  categoryCompleted = false
) {
  const currentTag = String(currentCategory?.tag || "");
  const semanticAnchor = currentTag
    ? categories.find((category) => String(category?.tag || "") === currentTag)
    : null;
  const anchor = semanticAnchor || currentCategory;
  const currentI = Number(anchor?.i);
  if (!Number.isInteger(currentI)) return [...categories];

  const currentJ = Number.isInteger(Number(anchor?.j))
    ? Number(anchor.j)
    : -1;

  return categories.filter((category) => {
    const categoryI = Number(category?.i);
    const categoryJ = Number.isInteger(Number(category?.j))
      ? Number(category.j)
      : -1;

    if (categoryI > currentI) return true;
    if (categoryI < currentI) return false;
    if (categoryJ > currentJ) return true;
    if (categoryJ < currentJ) return false;
    return categoryCompleted !== true;
  });
}

export function mergeCheckpointState(previousState, nextState) {
  return {
    ...previousState,
    ...nextState
  };
}
