export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "project";
}

export function makeUniqueId(baseValue: string, existingIds: readonly string[]): string {
  const baseId = slugify(baseValue);
  const existing = new Set(existingIds);

  if (!existing.has(baseId)) {
    return baseId;
  }

  let index = 2;
  let candidate = `${baseId}-${index}`;

  while (existing.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }

  return candidate;
}
