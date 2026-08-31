"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  matchesProPromotionText,
  normalizeWhitespace,
} = require("../src/dismiss-promos.js");

test("normalizeWhitespace normalizes promotion copy", () => {
  assert.equal(normalizeWhitespace("  获取\n ChatGPT   Pro "), "获取 ChatGPT Pro");
});

test("matches Chinese Pro promotion actions", () => {
  assert.equal(matchesProPromotionText("获取 Pro，解锁更多功能"), true);
  assert.equal(matchesProPromotionText("升级到 ChatGPT Pro"), true);
  assert.equal(matchesProPromotionText("立即订阅 Pro"), true);
});

test("matches English Pro promotion actions", () => {
  assert.equal(matchesProPromotionText("Get Pro for higher limits"), true);
  assert.equal(matchesProPromotionText("Upgrade to ChatGPT Pro"), true);
});

test("does not treat ordinary dialogs as Pro promotions", () => {
  assert.equal(matchesProPromotionText("关闭设置"), false);
  assert.equal(matchesProPromotionText("分享对话"), false);
  assert.equal(matchesProPromotionText("Pro 方案说明"), false);
});
