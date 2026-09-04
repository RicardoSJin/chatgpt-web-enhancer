const test = require("node:test");
const assert = require("node:assert/strict");

const { createHistoryState, readingLineOffset } = require("../src/navigation.js");

function location(scrollTop, anchorTurnId = `turn-${scrollTop}`) {
  return {
    anchorOffset: -20,
    anchorTurnId,
    locationKey: "https://chatgpt.com/c/example",
    scrollRatio: scrollTop / 1000,
    scrollTop,
  };
}

test("shared reading line uses 32 percent of a normal viewport", () => {
  assert.equal(readingLineOffset(800), 256);
});

test("shared reading line keeps safe top and bottom margins", () => {
  assert.equal(readingLineOffset(200), 104);
  assert.equal(readingLineOffset(100), 20);
});

test("jump history returns to the captured position and can move forward again", () => {
  const history = createHistoryState();
  assert.equal(history.record(location(120), location(760)), true);
  assert.deepEqual(history.getState(), {
    canGoBack: true,
    canGoForward: false,
    index: 1,
    length: 2,
  });

  const back = history.prepare(-1, location(780));
  assert.equal(back.snapshot.scrollTop, 120);
  history.commit(back.index);
  assert.equal(history.getState().canGoForward, true);

  const forward = history.prepare(1, location(135));
  assert.equal(forward.snapshot.scrollTop, 780);
  history.commit(forward.index);
  assert.equal(history.getState().canGoForward, false);
});

test("a new jump after going back discards the obsolete forward branch", () => {
  const history = createHistoryState();
  history.record(location(100), location(300));
  history.record(location(320), location(600));
  const back = history.prepare(-1, location(620));
  history.commit(back.index);

  history.record(location(340), location(900));
  assert.deepEqual(history.getState(), {
    canGoBack: true,
    canGoForward: false,
    index: 2,
    length: 3,
  });
  assert.equal(history.prepare(1, location(910)), null);
});

test("jump history ignores an unchanged reading position", () => {
  const history = createHistoryState();
  assert.equal(history.record(location(100, "same"), location(101, "same")), false);
  assert.deepEqual(history.getState(), {
    canGoBack: false,
    canGoForward: false,
    index: -1,
    length: 0,
  });
});
