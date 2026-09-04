(function initializeTimelineModel(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ChatGPTTimelineModel = api;
  }
})(typeof globalThis === "undefined" ? undefined : globalThis, function createTimelineModel() {
  "use strict";

  function compareRecords(left, right) {
    const leftSequence = Number.isFinite(left.sequence)
      ? left.sequence
      : Number.MAX_SAFE_INTEGER;
    const rightSequence = Number.isFinite(right.sequence)
      ? right.sequence
      : Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }

    return String(left.id).localeCompare(String(right.id));
  }

  function computeAnchorShift(measurements) {
    const shifts = Array.from(measurements ?? [])
      .filter(({ previousTop, currentTop }) => {
        return Number.isFinite(previousTop) && Number.isFinite(currentTop);
      })
      .map(({ previousTop, currentTop }) => currentTop - previousTop)
      .sort((left, right) => left - right);
    if (shifts.length === 0) return 0;
    const middle = Math.floor(shifts.length / 2);
    return shifts.length % 2
      ? shifts[middle]
      : (shifts[middle - 1] + shifts[middle]) / 2;
  }

  function mergeOrderedIds(existingIds, mountedIds) {
    const output = Array.from(new Set(existingIds ?? []));
    const mounted = Array.from(new Set(mountedIds ?? []));

    mounted.forEach((id, index) => {
      if (output.includes(id)) {
        return;
      }

      const nextAnchor = mounted.slice(index + 1).find((candidate) => output.includes(candidate));
      if (nextAnchor) {
        output.splice(output.indexOf(nextAnchor), 0, id);
        return;
      }

      const previousAnchor = mounted
        .slice(0, index)
        .reverse()
        .find((candidate) => output.includes(candidate));
      if (previousAnchor) {
        output.splice(output.indexOf(previousAnchor) + 1, 0, id);
        return;
      }

      output.push(id);
    });

    return output;
  }

  function reconcileReplacedBranch(existingIds, mountedIds, replacedIds) {
    const existing = Array.from(new Set(existingIds ?? []));
    const mounted = Array.from(new Set(mountedIds ?? []));
    const replaced = new Set(replacedIds ?? []);
    const cutoff = existing.findIndex((id) => replaced.has(id));
    if (cutoff < 0) {
      return mergeOrderedIds(existing, mounted);
    }

    const mountedSet = new Set(mounted);
    const preserved = existing.filter((id, index) => {
      return index < cutoff || mountedSet.has(id);
    });
    return mergeOrderedIds(preserved, mounted);
  }

  function getQuestionRecords(records) {
    return Array.from(records ?? [])
      .filter((record) => record.role === "user")
      .sort(compareRecords);
  }

  function normalizeSearchText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function filterQuestionRecords(records, query) {
    const questions = getQuestionRecords(records);
    const terms = normalizeSearchText(query).split(" ").filter(Boolean);
    if (terms.length === 0) {
      return questions;
    }

    return questions.filter((record) => {
      const searchableText = normalizeSearchText(record.searchText || record.excerpt);
      return terms.every((term) => searchableText.includes(term));
    });
  }

  function getRelativeQuestion(records, currentId, direction) {
    const questions = getQuestionRecords(records);
    if (questions.length === 0) {
      return null;
    }

    const currentIndex = questions.findIndex((record) => record.id === currentId);
    if (currentIndex < 0) {
      return direction < 0 ? questions.at(-1) : questions[0];
    }

    const nextIndex = Math.min(
      questions.length - 1,
      Math.max(0, currentIndex + Math.sign(direction || 1)),
    );
    return questions[nextIndex];
  }

  function getActiveQuestionAtPosition(records, anchorPosition) {
    const questions = Array.from(records ?? [])
      .filter((record) => record.role === "user" && Number.isFinite(record.position))
      .sort((left, right) => {
        const distance = left.position - right.position;
        return Math.abs(distance) > 0.5 ? distance : compareRecords(left, right);
      });
    if (questions.length === 0) {
      return null;
    }

    const preceding = questions.filter((record) => record.position <= anchorPosition + 0.5);
    return preceding.at(-1) ?? questions[0];
  }

  return Object.freeze({
    compareRecords,
    computeAnchorShift,
    filterQuestionRecords,
    getActiveQuestionAtPosition,
    getQuestionRecords,
    getRelativeQuestion,
    mergeOrderedIds,
    normalizeSearchText,
    reconcileReplacedBranch,
  });
});
