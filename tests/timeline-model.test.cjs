const test = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAnchorShift,
  filterQuestionRecords,
  getActiveQuestionAtPosition,
  getQuestionRecords,
  getRelativeQuestion,
  mergeOrderedIds,
  reconcileReplacedBranch,
} = require("../src/timeline-model.js");

test("anchor shift follows stable turn ids when older content is prepended", () => {
  assert.equal(computeAnchorShift([
    { previousTop: 37782, currentTop: 64949 },
    { previousTop: 44433, currentTop: 71600 },
    { previousTop: undefined, currentTop: 7150 },
  ]), 27167);
});

test("anchor shift uses the median to ignore one unstable layout measurement", () => {
  assert.equal(computeAnchorShift([
    { previousTop: 100, currentTop: 5100 },
    { previousTop: 200, currentTop: 5200 },
    { previousTop: 300, currentTop: 15300 },
  ]), 5000);
});

test("the timeline contains only user questions in conversation order", () => {
  const questions = getQuestionRecords([
    { id: "a2", sequence: 1, role: "assistant" },
    { id: "u2", sequence: 2, role: "user" },
    { id: "u1", sequence: 0, role: "user" },
  ]);

  assert.deepEqual(questions.map((record) => record.id), ["u1", "u2"]);
});

test("question search is case-insensitive and keeps conversation order", () => {
  const questions = filterQuestionRecords([
    { id: "u2", sequence: 2, role: "user", searchText: "LEN() 是 Python 函数吗" },
    { id: "a1", sequence: 1, role: "assistant", searchText: "Python 回复" },
    { id: "u1", sequence: 0, role: "user", searchText: "SUM() 是 Python 函数吗" },
  ], "python");

  assert.deepEqual(questions.map((record) => record.id), ["u1", "u2"]);
});

test("question search matches every normalized search term", () => {
  const questions = filterQuestionRecords([
    { id: "u1", sequence: 0, role: "user", searchText: "如何修复 ChatGPT 时间轴" },
    { id: "u2", sequence: 1, role: "user", searchText: "如何搜索用户问题" },
  ], "时间轴  ChatGPT");

  assert.deepEqual(questions.map((record) => record.id), ["u1"]);
});

test("empty question search returns all user questions", () => {
  const questions = filterQuestionRecords([
    { id: "u2", sequence: 1, role: "user", excerpt: "第二问" },
    { id: "u1", sequence: 0, role: "user", excerpt: "第一问" },
  ], "   ");

  assert.deepEqual(questions.map((record) => record.id), ["u1", "u2"]);
});

test("keyboard navigation moves only between user questions", () => {
  const records = [
    { id: "u1", sequence: 0, role: "user" },
    { id: "a1", sequence: 1, role: "assistant" },
    { id: "u2", sequence: 2, role: "user" },
  ];

  assert.equal(getRelativeQuestion(records, "u1", 1).id, "u2");
  assert.equal(getRelativeQuestion(records, "u2", -1).id, "u1");
  assert.equal(getRelativeQuestion(records, "a1", 1).id, "u1");
});

test("active question follows fresh positions instead of stale sequence order", () => {
  const active = getActiveQuestionAtPosition([
    { id: "u3", sequence: 0, role: "user", position: 720 },
    { id: "u1", sequence: 2, role: "user", position: -460 },
    { id: "u2", sequence: 1, role: "user", position: 88 },
  ], 96);

  assert.equal(active.id, "u2");
});

test("active question stays on the preceding prompt while its answer is being read", () => {
  const active = getActiveQuestionAtPosition([
    { id: "u1", sequence: 0, role: "user", position: -800 },
    { id: "u2", sequence: 1, role: "user", position: 520 },
  ], 96);

  assert.equal(active.id, "u1");
});

test("cached positions keep an unmounted question active inside its answer", () => {
  const active = getActiveQuestionAtPosition([
    { id: "u4", sequence: 3, role: "user", position: 18000, mounted: false },
    { id: "u6", sequence: 5, role: "user", position: 34000, mounted: true },
    { id: "u9", sequence: 8, role: "user", position: 41000, mounted: true },
  ], 26750);

  assert.equal(active.id, "u4");
});

test("native turn ids keep chronological order when an older virtual window mounts", () => {
  const recentWindow = ["user-7", "user-9"];
  const expandedWindow = ["user-1", "user-3", "user-5", "user-7", "user-9"];

  assert.deepEqual(
    mergeOrderedIds(recentWindow, expandedWindow),
    expandedWindow,
  );
});

test("newer virtual windows append after their last stable anchor", () => {
  assert.deepEqual(
    mergeOrderedIds(["user-1", "user-3"], ["user-3", "user-5", "user-7"]),
    ["user-1", "user-3", "user-5", "user-7"],
  );
});

test("editing a message removes the obsolete branch tail", () => {
  assert.deepEqual(
    reconcileReplacedBranch(
      ["u1", "old-edit", "old-followup-1", "old-followup-2"],
      ["u1", "new-edit", "new-followup"],
      ["old-edit"],
    ),
    ["u1", "new-edit", "new-followup"],
  );
});

test("branch reconciliation keeps cached questions before the edited message", () => {
  assert.deepEqual(
    reconcileReplacedBranch(
      ["cached-u1", "cached-u2", "old-edit", "old-tail"],
      ["cached-u2", "new-edit"],
      ["old-edit"],
    ),
    ["cached-u1", "cached-u2", "new-edit"],
  );
});

test("ordinary virtual mounting does not prune records without a replacement", () => {
  assert.deepEqual(
    reconcileReplacedBranch(["u1", "u3"], ["u3", "u5"], []),
    ["u1", "u3", "u5"],
  );
});
