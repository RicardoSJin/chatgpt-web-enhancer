"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildOutlineEntries, normalizeWhitespace } = require("../src/outline.js");

test("normalizeWhitespace collapses whitespace", () => {
  assert.equal(normalizeWhitespace("  第一章\n  概览  "), "第一章 概览");
});

test("buildOutlineEntries preserves levels and derives relative depth", () => {
  const entries = buildOutlineEntries([
    { level: 2, text: "开始" },
    { level: 3, text: "准备" },
    { level: 5, text: "细节" },
    { level: 2, text: "结束" },
  ]);

  assert.deepEqual(
    entries.map(({ level, depth, text }) => ({ level, depth, text })),
    [
      { level: 2, depth: 0, text: "开始" },
      { level: 3, depth: 1, text: "准备" },
      { level: 5, depth: 3, text: "细节" },
      { level: 2, depth: 0, text: "结束" },
    ],
  );
});

test("buildOutlineEntries drops empty headings and normalizes invalid levels", () => {
  const entries = buildOutlineEntries([
    { level: 1, text: "" },
    { level: 9, textContent: "附录" },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, 6);
  assert.equal(entries[0].depth, 0);
  assert.equal(entries[0].text, "附录");
});
