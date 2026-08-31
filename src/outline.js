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

    const minimumLevel = Math.min(...normalized.map((heading) => heading.level));
    return normalized.map((heading) => ({
      ...heading,
      depth: heading.level - minimumLevel,
    }));
  }

  return Object.freeze({
    buildOutlineEntries,
    normalizeWhitespace,
  });
});
