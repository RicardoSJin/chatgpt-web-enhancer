(function initializeOutlineApi(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ChatGPTAnswerTocOutline = api;
  }
})(typeof globalThis === "undefined" ? undefined : globalThis, function createOutlineApi() {
  "use strict";

  function normalizeWhitespace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeLevel(value) {
    const level = Number.parseInt(String(value), 10);
    return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 6;
  }

  function buildOutlineEntries(headings) {
    const normalized = Array.from(headings ?? [], (heading, index) => ({
      ...heading,
      index,
      level: normalizeLevel(heading.level),
      text: normalizeWhitespace(heading.text ?? heading.textContent),
    })).filter((heading) => heading.text.length > 0);

    if (normalized.length === 0) {
      return [];
    }

    const hierarchy = [];
    const entries = normalized.map((heading) => {
      while (hierarchy.length > 0 && hierarchy.at(-1) >= heading.level) {
        hierarchy.pop();
      }
      hierarchy.push(heading.level);
      const depth = hierarchy.length - 1;
      return {
        ...heading,
        depth,
        displayLevel: depth + 1,
      };
    });

    const occurrences = new Map();
    return entries.map((entry, index) => {
      const baseKey = `${entry.level}\u001f${entry.text}`;
      const occurrence = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, occurrence + 1);
      return {
        ...entry,
        hasChildren: (entries[index + 1]?.depth ?? -1) > entry.depth,
        key: `${baseKey}\u001f${occurrence}`,
      };
    });
  }

  function getVisibleOutlineIndexes(entries, collapsedIndexes) {
    const source = Array.from(entries ?? []);
    const collapsed = new Set(collapsedIndexes ?? []);
    const visibleIndexes = [];
    let collapsedDepth = null;

    source.forEach((entry, index) => {
      if (collapsedDepth !== null && entry.depth > collapsedDepth) {
        return;
      }
      collapsedDepth = null;
      visibleIndexes.push(index);
      if (entry.hasChildren && collapsed.has(index)) {
        collapsedDepth = entry.depth;
      }
    });

    return visibleIndexes;
  }

  return Object.freeze({
    buildOutlineEntries,
    getVisibleOutlineIndexes,
    normalizeWhitespace,
  });
});
