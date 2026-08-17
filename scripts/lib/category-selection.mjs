export function selectTaskCategories(plan, config) {
  const configuredNames = new Set((config.categoryNames || []).map((name) => String(name).toLowerCase()));
  const configuredTags = new Set(
    [config.categoryTag, ...(config.categoryTags || [])]
      .map((tag) => String(tag || ""))
      .filter(Boolean)
  );
  const skipCategoryIs = config.skipCategoryIs || new Set();
  const eligible = plan.filter((category) => {
    if (!configuredTags.size && config.startCategoryI !== undefined && category.i < config.startCategoryI) return false;
    if (!configuredTags.size && config.endCategoryI !== undefined && category.i > config.endCategoryI) return false;
    return !skipCategoryIs.has(category.i);
  });

  let selected = [];
  if (configuredTags.size) {
    selected = eligible.filter((category) => configuredTags.has(String(category.tag || "")));
  }

  if (!selected.length && configuredNames.size) {
    selected = eligible.filter((category) => categoryNames(category).some((name) => configuredNames.has(name)));
  }

  const hasSemanticIdentity = configuredTags.size > 0 || configuredNames.size > 0;
  if (!selected.length && !hasSemanticIdentity && config.categoryI !== undefined) {
    selected = eligible.filter(
      (category) => category.i === config.categoryI && (config.categoryJ === undefined || category.j === config.categoryJ)
    );
  }

  if (!selected.length && config.captureAllCategories && !hasSemanticIdentity && config.categoryI === undefined) {
    selected = eligible;
  }

  return config.maxCategories === undefined ? selected : selected.slice(0, config.maxCategories);
}

function categoryNames(category) {
  const displayName =
    category.parentName && category.name && category.parentName !== category.name
      ? `${category.parentName}/${category.name}`
      : category.name || category.parentName || "";
  return [category.name, category.parentName, displayName, `${category.parentName || ""}${category.name || ""}`]
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());
}
