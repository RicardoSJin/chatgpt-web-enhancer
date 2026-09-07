"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildOutlineEntries, normalizeWhitespace } = require("../src/outline.js");

test("normalizeWhitespace collapses whitespace", () => {
  assert.equal(normalizeWhitespace("  第一章\n  概览  "), "第一章 概览");
});

test("buildOutlineEntries preserves source levels and compresses skipped display levels", () => {
  const entries = buildOutlineEntries([
    { level: 2, text: "开始" },
    { level: 3, text: "准备" },
    { level: 5, text: "细节" },
    { level: 2, text: "结束" },
  ]);

  assert.deepEqual(
    entries.map(({ level, displayLevel, depth, text }) => ({
      level,
      displayLevel,
      depth,
      text,
    })),
    [
      { level: 2, displayLevel: 1, depth: 0, text: "开始" },
      { level: 3, displayLevel: 2, depth: 1, text: "准备" },
      { level: 5, displayLevel: 3, depth: 2, text: "细节" },
      { level: 2, displayLevel: 1, depth: 0, text: "结束" },
    ],
  );
});

test("a source H1 to H3 jump is displayed as H1 to H2", () => {
  const entries = buildOutlineEntries([
    { level: 1, text: "一级" },
    { level: 3, text: "跳级子标题" },
    { level: 2, text: "二级" },
    { level: 3, text: "正常子标题" },
  ]);

  assert.deepEqual(
    entries.map(({ level, displayLevel }) => ({ level, displayLevel })),
    [
      { level: 1, displayLevel: 1 },
      { level: 3, displayLevel: 2 },
      { level: 2, displayLevel: 2 },
      { level: 3, displayLevel: 3 },
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
  assert.equal(entries[0].displayLevel, 1);
  assert.equal(entries[0].depth, 0);
  assert.equal(entries[0].text, "附录");
});
