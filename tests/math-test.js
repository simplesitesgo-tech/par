// Hand-checked grade math examples. Run with: node tests/math-test.js
const Par = require('../app.js');
let fails = 0;
function eq(name, got, want) {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-6 : got === want;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ': got ' + got + ', want ' + want);
  if (!ok) fails++;
}
const A = (id, pts, score, extra) => Object.assign({ id, name: id, pts, score: score == null ? null : score }, extra || {});

// Example 1 (the one to explain to judges), weighted:
// Homework is 40%: scored 18/20, one 20 point homework left. Final is 60%: 100 points, not taken yet.
// Current = 18/20 = 90%. With zeros: 0.4 x 18/40 = 18%. With perfect: 0.4 x 38/40 + 0.6 = 98%.
// Target 90%: p = (90 - 18) / (98 - 18) = 72 / 80 = 0.9. So Par is 18/20 on the homework and 90/100 on the final.
const c1 = { id: 'c1', weighted: true, groups: [
  { id: 'hw', weight: 40, assignments: [A('hw1', 20, 18), A('hw2', 20)] },
  { id: 'fin', weight: 60, assignments: [A('final', 100)] }] };
let r = Par.analyze(c1, { target: 90 });
eq('ex1 current', r.current, 90);
eq('ex1 f0', r.f0, 18);
eq('ex1 f1', r.f1, 98);
eq('ex1 p', r.p, 0.9);
eq('ex1 need hw2', Par.need(r, 20).score, 18);
eq('ex1 need final', Par.need(r, 100).score, 90);
eq('ex1 status', r.status, 'push');

// What-if: predict 20/20 on hw2. Homework becomes 38/40 = 95%, worth 0.4 x 95 = 38 points. f0 = 38%, f1 = 98%.
// p = (90 - 38) / 60 = 0.8667, so the final needs 86.7 / 100 (rounded up).
r = Par.analyze(c1, { target: 90, predictions: { hw2: 20 } });
eq('what-if p', r.p, 52 / 60);
eq('what-if need final', Par.need(r, 100).score, 86.7);
eq('what-if current stays real', r.current, 90);

// Example 2, unweighted points: 40/50 so far, 50 points left, target 90 -> need 100% (50/50).
const c2 = { id: 'c2', weighted: false, groups: [{ id: 'g', assignments: [A('a', 50, 40), A('b', 50)] }] };
r = Par.analyze(c2, { target: 90 });
eq('ex2 current', r.current, 80);
eq('ex2 p', r.p, 1);
eq('ex2 status', r.status, 'birdie');
r = Par.analyze(c2, { target: 93 });
eq('ex2 out of reach', r.state, 'out');
eq('ex2 best possible', r.f1, 90);
eq('ex2 suggests A-', r.bestTarget.letter, 'A-');
r = Par.analyze(c2, { target: 40 });
eq('ex2 locked in', r.state, 'locked');

// Excused, omitted and 0 point work is skipped. Extra credit adds points.
const c3 = { id: 'c3', weighted: false, groups: [{ id: 'g', assignments: [
  A('a', 10, 9), A('ex', 10, null, { excused: true }), A('om', 10, 2, { omit: true }), A('bonus', 0, 1), A('b', 10)] }] };
r = Par.analyze(c3, { target: 90 });
eq('ex3 current with extra credit', r.current, 100);
eq('ex3 remaining count', r.remainingCount, 1);

// Nothing left and nothing at all.
r = Par.analyze({ id: 'c4', groups: [{ id: 'g', assignments: [A('a', 100, 91.2)] }] }, { target: 90 });
eq('done state', r.state, 'done');
eq('done final', r.f0, 91.2);
r = Par.analyze({ id: 'c5', groups: [] }, {});
eq('empty state', r.state, 'empty');
eq('empty aims for A', r.p, 0.93);

// Weighted class with all weights 0 falls back to points instead of crashing.
r = Par.analyze({ id: 'c6', weighted: true, groups: [{ id: 'g', weight: 0, assignments: [A('a', 10, 8), A('b', 10)] }] }, { target: 80 });
eq('zero weights fallback p', r.p, 0.8);
eq('zero weights flagged', r.weightsBroken, true);

// Bad pasted data is rejected with a friendly message.
for (const bad of ['', 'hello', '{"courses": []}', '[1,2]', 'null', '{"courses":[{"nope":1}]}']) {
  let msg = '';
  try { Par.normalizePayload(bad); } catch (e) { msg = e.friendly ? 'friendly' : 'crash'; }
  eq('rejects ' + JSON.stringify(bad), msg, 'friendly');
}

console.log(fails ? fails + ' FAILED' : 'All tests passed');
process.exit(fails ? 1 : 0);
