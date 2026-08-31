const test = require("node:test");
const assert = require("node:assert/strict");

const { readingLineOffset } = require("../src/navigation.js");

test("shared reading line uses 32 percent of a normal viewport", () => {
  assert.equal(readingLineOffset(800), 256);
});

test("shared reading line keeps safe top and bottom margins", () => {
  assert.equal(readingLineOffset(200), 104);
  assert.equal(readingLineOffset(100), 20);
});
