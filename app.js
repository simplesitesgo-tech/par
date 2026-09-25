'use strict';

/* =========================================================
   Part 1: grade math, data checking, and sample data.
   No page code here, so tests can run it with Node.
   ========================================================= */
var Par = (function () {
  var DEFAULT_SCALE = [
    ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77],
    ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60]
  ].map(function (x) { return { letter: x[0], min: x[1] }; });

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function validScale(scale) {
    if (!Array.isArray(scale) || !scale.length) return null;
    var ok = scale.filter(function (s) { return s && typeof s.letter === 'string' && s.letter && isNum(s.min); });
    if (!ok.length) return null;
    return ok.slice().sort(function (a, b) { return b.min - a.min; });
  }

  function letterFor(pct, scale) {
    if (!isNum(pct)) return '';
    scale = validScale(scale) || DEFAULT_SCALE;
    for (var i = 0; i < scale.length; i++) if (pct >= scale[i].min - 1e-9) return scale[i].letter;
    return 'F';
  }

  function defaultTarget(current, scale) {
    if (!isNum(current)) return scale[0].min;
    for (var i = 0; i < scale.length; i++) if (current >= scale[i].min - 1e-9) return scale[i].min;
    return scale[scale.length - 1].min;
  }

  // Needed score on one assignment, rounded UP to one decimal.
  function neededScore(p, pts) {
    return Math.ceil(p * pts * 10 - 1e-6) / 10;
  }

  // Canvas drop rules. Picks which scores to drop the same way Canvas does:
  // drop_lowest removes the scores that leave the HIGHEST group percent,
  // drop_highest then removes the ones that leave the LOWEST. never_drop items are always kept.
  function applyDrops(items, rules) {
    var low = Math.max(0, Math.floor(rules.drop_lowest || 0));
    var high = Math.max(0, Math.floor(rules.drop_highest || 0));
    if (!low && !high) return items;
    var never = {};
    (rules.never_drop || []).forEach(function (id) { never[String(id)] = true; });
    var keep = items.slice();
    function dropBest(k, wantHigh) {
      var droppable = keep.filter(function (it) { return !never[it.id]; });
      k = Math.min(k, droppable.length, keep.length - 1);
      if (k <= 0) return;
      // Find the ratio q the kept set can reach, by bisection. For a guess q, each item is worth e - q*g.
      var lo = -1, hi = 1e3;
      function pick(q) {
        var vals = droppable.map(function (it) { return { it: it, v: it.e - q * it.g }; });
        vals.sort(function (a, b) { return wantHigh ? a.v - b.v : b.v - a.v; });
        var dropped = vals.slice(0, k).map(function (x) { return x.it; });
        var kept = keep.filter(function (it) { return dropped.indexOf(it) < 0; });
        var sum = kept.reduce(function (s, it) { return s + it.e - q * it.g; }, 0);
        return { kept: kept, ok: wantHigh ? sum >= 0 : sum <= 0 };
      }
      var best = null;
      for (var i = 0; i < 60; i++) {
        var mid = (lo + hi) / 2, r = pick(mid);
        if (r.ok) { best = r; if (wantHigh) lo = mid; else hi = mid; }
        else { if (wantHigh) hi = mid; else lo = mid; }
      }
      keep = (best || pick(wantHigh ? lo : hi)).kept;
    }
    dropBest(low, true);
    dropBest(high, false);
    return keep;
  }

  function sumItems(items) {
    var E = 0, G = 0;
    items.forEach(function (it) { E += it.e; G += it.g; });
    return { E: E, G: G };
  }

  // The heart of Par. Works out current grade, the "par" average p, and status for one class.
  function analyze(course, pref) {
    pref = pref || {};
    var scale = validScale(pref.scale) || DEFAULT_SCALE;
    var preds = pref.predictions || {};
    var useWeights = typeof pref.weighted === 'boolean' ? pref.weighted : !!course.weighted;

    var groups = (course.groups || []).map(function (g) {
      var w = pref.weights && isNum(pref.weights[g.id]) ? pref.weights[g.id] : (isNum(g.weight) ? g.weight : 0);
      var gr = {
        id: g.id, name: g.name, weight: Math.max(0, w), canvasWeight: isNum(g.weight) ? g.weight : 0,
        rules: g.rules || {}, graded: [], remaining: [], skipped: [],
        E: 0, G: 0, R: 0, Er: 0, Gr: 0,
        realItems: [], knownItems: [], openItems: []
      };
      gr.dropLow = Math.floor(gr.rules.drop_lowest || 0);
      gr.dropHigh = Math.floor(gr.rules.drop_highest || 0);
      gr.drops = gr.dropLow + gr.dropHigh > 0;
      (g.assignments || []).forEach(function (a) {
        var pts = isNum(a.pts) && a.pts > 0 ? a.pts : 0;
        if (a.excused) gr.skipped.push({ a: a, why: 'Excused' });
        else if (a.omit) gr.skipped.push({ a: a, why: 'Does not count toward the grade' });
        else if (isNum(a.score)) {
          gr.E += a.score; gr.G += pts; gr.Er += a.score; gr.Gr += pts;
          gr.graded.push({ a: a });
          gr.realItems.push({ id: a.id, e: a.score, g: pts });
          gr.knownItems.push({ id: a.id, e: a.score, g: pts });
        } else if (pts === 0) gr.skipped.push({ a: a, why: 'Worth 0 points' });
        else if (isNum(preds[a.id])) {
          gr.E += preds[a.id]; gr.G += pts;
          gr.remaining.push({ a: a, predicted: preds[a.id] });
          gr.knownItems.push({ id: a.id, e: preds[a.id], g: pts });
        } else {
          gr.R += pts;
          gr.remaining.push({ a: a });
          gr.openItems.push({ id: a.id, g: pts });
        }
      });
      return gr;
    });

    var anyDrops = groups.some(function (g) { return g.drops; });
    var counted = groups.filter(function (g) { return g.G + g.R > 0; });
    var W = counted.reduce(function (s, g) { return s + g.weight; }, 0);
    var weighted = useWeights && W > 0;
    var weightsBroken = useWeights && counted.length > 0 && W <= 0;

    // Group totals after drop rules. p = the average assumed on every open assignment.
    function groupAt(g, p) {
      var items = g.knownItems.concat(g.openItems.map(function (it) { return { id: it.id, e: p * it.g, g: it.g }; }));
      return sumItems(applyDrops(items, g.rules));
    }

    function combine(parts) {
      var use = parts.filter(function (x) { return x.G > 0 || (!weighted && x.E > 0); });
      if (weighted) {
        use = use.filter(function (x) { return x.G > 0; });
        var w = use.reduce(function (s, x) { return s + x.w; }, 0);
        if (w > 0) return use.reduce(function (s, x) { return s + x.w * x.E / x.G; }, 0) / w * 100;
      }
      var E = 0, D = 0;
      use.forEach(function (x) { E += x.E; D += x.G; });
      return D > 0 ? E / D * 100 : null;
    }

    function F(p) {
      return combine(groups.map(function (g) {
        var t = groupAt(g, p); t.w = g.weight; return t;
      }));
    }

    function gradeFrom(key) {
      return combine(groups.map(function (g) {
        var t = sumItems(applyDrops(g[key], g.rules)); t.w = g.weight; return t;
      }));
    }

    groups.forEach(function (g) {
      var real = sumItems(applyDrops(g.realItems, g.rules));
      g.current = real.G > 0 ? real.E / real.G * 100 : null;
      g.share = weighted && W > 0 ? g.weight / W * 100 : null;
    });

    var current = gradeFrom('realItems');
    var projected = gradeFrom('knownItems');
    var target = isNum(pref.target) ? pref.target : defaultTarget(current, scale);
    var f0 = counted.length ? F(0) : null;
    var f1 = counted.length ? F(1) : null;
    var remainingCount = 0, predictedCount = 0;
    groups.forEach(function (g) {
      g.remaining.forEach(function (r) { if (r.predicted == null) remainingCount++; else predictedCount++; });
    });

    var state, p = null;
    if (f0 == null) { state = 'empty'; p = target / 100; }
    else if (f1 - f0 < 1e-9) state = 'done';
    else if (target > f1 + 1e-9) state = 'out';
    else if (target <= f0) state = 'locked';
    else {
      state = 'live';
      if (!anyDrops) p = (target - f0) / (f1 - f0);
      else {
        // With drop rules the grade is no longer a straight line in p, so search for the smallest p that works.
        var lo = 0, hi = 1;
        for (var i = 0; i < 50; i++) {
          var mid = (lo + hi) / 2;
          if (F(mid) >= target - 1e-9) hi = mid; else lo = mid;
        }
        p = hi;
      }
    }
    if (state === 'out') p = f1 - f0 > 0 ? (target - f0) / (f1 - f0) : null;

    var status;
    if (state === 'out') status = 'out';
    else if (state === 'locked') status = 'locked';
    else if (state === 'done') status = f0 >= target - 1e-9 ? 'locked' : 'out';
    else if (p > 0.95) status = 'birdie';
    else if (p >= 0.85) status = 'push';
    else status = 'par';

    var bestTarget = null;
    if (state === 'out' || (state === 'done' && status === 'out')) {
      var ceiling = state === 'done' ? f0 : f1;
      for (var j = 0; j < scale.length; j++) if (scale[j].min <= ceiling + 1e-9) { bestTarget = scale[j]; break; }
    }

    var canvasScore = isNum(course.canvasScore) ? course.canvasScore : null;
    var matches = canvasScore != null && current != null ? Math.abs(canvasScore - current) <= 0.5 : null;

    return {
      groups: groups, scale: scale, weighted: weighted, useWeights: useWeights, weightsBroken: weightsBroken,
      current: current, projected: projected, target: target, targetLetter: letterFor(target, scale),
      currentLetter: letterFor(current, scale),
      f0: f0, f1: f1, p: p, state: state, status: status, bestTarget: bestTarget,
      remainingCount: remainingCount, predictedCount: predictedCount,
      canvasScore: canvasScore, matches: matches,
      noGrades: current == null
    };
  }

  // What a single remaining assignment needs, in words and numbers.
  function need(an, pts) {
    if (an.state === 'locked') return { kind: 'locked', score: 0 };
    if (an.state === 'out') return { kind: 'out', score: pts };
    if (an.p == null) return { kind: 'none' };
    var s = neededScore(an.p, pts);
    return { kind: 'need', score: s, pct: s / pts * 100 };
  }

  // ---------- Checking data that comes from the bookmarklet or the paste box ----------
  function ParError(message) { var e = new Error(message); e.friendly = true; return e; }

  function num(v) { return isNum(v) && Math.abs(v) < 1e7 ? v : null; }
  function str(v, max) {
    if (typeof v === 'string') return v.slice(0, max);
    if (isNum(v)) return String(v);
    return '';
  }
  function arr(v) { return Array.isArray(v) ? v : []; }

  function normAssignment(a) {
    if (!a || typeof a !== 'object') return null;
    var id = str(a.id, 40);
    if (!id) return null;
    var due = typeof a.due === 'string' && !isNaN(Date.parse(a.due)) ? a.due : null;
    return {
      id: id, name: str(a.name, 200) || 'Untitled', pts: num(a.pts), due: due,
      omit: a.omit === true, score: num(a.score), excused: a.excused === true, state: str(a.state, 40) || null
    };
  }

  function normGroup(g) {
    if (!g || typeof g !== 'object') return null;
    var id = str(g.id, 40);
    if (!id) return null;
    var rules = {};
    if (g.rules && typeof g.rules === 'object') {
      if (num(g.rules.drop_lowest)) rules.drop_lowest = g.rules.drop_lowest;
      if (num(g.rules.drop_highest)) rules.drop_highest = g.rules.drop_highest;
      if (Array.isArray(g.rules.never_drop)) rules.never_drop = g.rules.never_drop.slice(0, 200).map(function (x) { return str(x, 40); }).filter(Boolean);
    }
    return {
      id: id, name: str(g.name, 120) || 'Assignments', weight: num(g.weight), rules: rules,
      assignments: arr(g.assignments).slice(0, 1000).map(normAssignment).filter(Boolean)
    };
  }

  function normCourse(c) {
    if (!c || typeof c !== 'object') return null;
    var id = str(c.id, 40);
    if (!id) return null;
    return {
      id: id, name: str(c.name, 200) || 'Untitled class', code: str(c.code, 80),
      weighted: c.weighted === true, canvasScore: num(c.canvasScore), canvasGrade: str(c.canvasGrade, 12) || null,
      error: str(c.error, 200) || null,
      groups: arr(c.groups).slice(0, 100).map(normGroup).filter(Boolean)
    };
  }

  function normalizePayload(input) {
    var obj = input;
    if (typeof input === 'string') {
      var text = input.trim();
      if (!text) throw ParError('The paste box is empty. Click Sync Canvas on a Canvas page first, then paste here.');
      if (text.length > 8e6) throw ParError('That is way too much text to be Par sync data. Try syncing again.');
      try { obj = JSON.parse(text); } catch (e) {
        throw ParError('That does not look like Par sync data. On a Canvas page, click Sync Canvas, then come back and paste what it copied.');
      }
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.courses)) {
      throw ParError('That does not look like Par sync data. On a Canvas page, click Sync Canvas, then come back and paste what it copied.');
    }
    var courses = obj.courses.slice(0, 100).map(normCourse).filter(Boolean);
    if (!courses.length) throw ParError('The sync data had no classes in it. Open Canvas, make sure your classes show on the Dashboard, and sync again.');
    var synced = typeof obj.syncedAt === 'string' && !isNaN(Date.parse(obj.syncedAt)) ? obj.syncedAt : new Date().toISOString();
    return { origin: str(obj.origin, 200), syncedAt: synced, sample: obj.sample === true, courses: courses };
  }

  // ---------- Sample student for judges and first-time visitors ----------
  function sampleData(now) {
    now = now || Date.now();
    var DAY = 86400000;
    function due(days) {
      var d = new Date(now + days * DAY);
      d.setHours(23, 59, 0, 0);
      return d.toISOString();
    }
    var n = 0;
    function A(name, pts, dueDays, score, extra) {
      var a = { id: 's' + (++n), name: name, pts: pts, due: due(dueDays), score: score == null ? null : score, excused: false, omit: false };
      if (extra) for (var k in extra) a[k] = extra[k];
      return a;
    }
    var courses = [
      {
        id: 'sample-stat', name: 'Statistics for Business', code: 'STAT 252', weighted: true,
        groups: [
          { id: 'sg1', name: 'Homework', weight: 20, assignments: [
            A('Homework 1', 20, -24, 19), A('Homework 2', 20, -17, 18), A('Homework 3', 20, -10, 20),
            A('Homework 4', 20, -3, 17), A('Homework 5', 20, 4), A('Homework 6', 20, 11), A('Homework 7', 20, 18)] },
          { id: 'sg2', name: 'Quizzes', weight: 15, rules: { drop_lowest: 1 }, assignments: [
            A('Quiz 1', 10, -21, 9), A('Quiz 2', 10, -14, 8), A('Quiz 3', 10, -7, 10), A('Quiz 4', 10, 1), A('Quiz 5', 10, 8)] },
          { id: 'sg3', name: 'Midterms', weight: 35, assignments: [A('Midterm 1', 100, -12, 88), A('Midterm 2', 100, 15)] },
          { id: 'sg4', name: 'Final Exam', weight: 30, assignments: [A('Final Exam', 150, 27)] }
        ]
      },
      {
        id: 'sample-bus', name: 'Managing Organizations', code: 'BUS 391', weighted: false,
        groups: [
          { id: 'bg1', name: 'Case Studies', weight: null, assignments: [
            A('Case Study 1: Patagonia', 50, -20, 42), A('Case Study 2: Netflix Culture', 50, -6, 40), A('Case Study 3: Zappos', 50, 6), A('Case Study 4: Toyota', 50, 20)] },
          { id: 'bg2', name: 'Participation', weight: null, assignments: [
            A('Participation Week 1', 10, -22, 10), A('Participation Week 2', 10, -15, 9), A('Participation Week 3', 10, -8, 10),
            A('Participation Week 4', 10, -1, 8), A('Participation Week 5', 10, 6), A('Participation Week 6', 10, 13)] },
          { id: 'bg3', name: 'Exams', weight: null, assignments: [A('Midterm', 100, -9, 81), A('Final Exam', 150, 25)] },
          { id: 'bg4', name: 'Team Project', weight: null, assignments: [A('Team Project Proposal', 25, 2), A('Team Project Presentation', 75, 23)] }
        ]
      },
      {
        id: 'sample-acct', name: 'Managerial Accounting', code: 'ACCT 212', weighted: true,
        groups: [
          { id: 'ag1', name: 'Homework (Connect)', weight: 15, assignments: [
            A('Connect Ch. 1', 30, -23, 27), A('Connect Ch. 2', 30, -16, 24), A('Connect Ch. 3', 30, -9, 22),
            A('Connect Ch. 4', 30, 3), A('Connect Ch. 5', 30, 10)] },
          { id: 'ag2', name: 'Quizzes', weight: 15, rules: { drop_lowest: 1 }, assignments: [
            A('Quiz 1: Cost Behavior', 20, -18, 13), A('Quiz 2: CVP Analysis', 20, -11, 12), A('Quiz 3: Job Costing', 20, 5)] },
          { id: 'ag3', name: 'Exams', weight: 40, assignments: [A('Exam 1', 100, -5, 58), A('Exam 2', 100, 19)] },
          { id: 'ag4', name: 'Final Exam', weight: 30, assignments: [A('Final Exam', 150, 28)] }
        ]
      },
      {
        id: 'sample-engl', name: 'Writing for the Workplace', code: 'ENGL 339', weighted: true,
        groups: [
          { id: 'eg1', name: 'Reading Responses', weight: 20, assignments: [
            A('Reading Response 1', 10, -25, 10), A('Reading Response 2', 10, -18, 10), A('Reading Response 3', 10, -11, 9),
            A('Reading Response 4', 10, -4, 10), A('Reading Response 5', 10, 3), A('Reading Response 6', 10, 10),
            A('Syllabus Quiz', 5, -26, null, { excused: true })] },
          { id: 'eg2', name: 'Major Projects', weight: 50, assignments: [
            A('Cover Letter and Resume', 100, -8, 98), A('Proposal Memo', 100, -2, 96), A('Final Report', 100, 26)] },
          { id: 'eg3', name: 'Participation', weight: 10, assignments: [A('Participation', 20, 29)] },
          { id: 'eg4', name: 'Portfolio', weight: 20, assignments: [A('Writing Portfolio', 100, 30)] }
        ]
      }
    ];
    var targets = { 'sample-stat': 83, 'sample-bus': 90, 'sample-acct': 93, 'sample-engl': 90 };
    courses.forEach(function (c) {
      c.canvasScore = analyze(c, {}).current;
      if (c.canvasScore != null) c.canvasScore = Math.round(c.canvasScore * 100) / 100;
    });
    return {
      data: { par: 1, origin: 'https://canvas.calpoly.edu', syncedAt: new Date(now - 2 * 3600000).toISOString(), sample: true, courses: courses },
      targets: targets
    };
  }

  // ---------- Reading a syllabus: pulls out "Homework 20%" style weights and a letter scale ----------
  var DASH = '[-\\u2013\\u2014\\u2212]';
  var POLICY = /\b(late|penalt|deduct|per day|each day|reduc|lose|loses|lost|curve|bonus|extra credit|absen|plagiar|minimum|at least|below|less than|more than|refund|tuition)\b/i;
  var SYN = {
    hw: 'homework', homeworks: 'homework', assignments: 'assignment', quizzes: 'quiz', quizes: 'quiz',
    tests: 'exam', test: 'exam', exams: 'exam', examination: 'exam', examinations: 'exam', midterms: 'midterm',
    'mid-term': 'midterm', labs: 'lab', laboratory: 'lab', papers: 'paper', essays: 'essay', projects: 'project',
    discussions: 'discussion', attendance: 'participation', participate: 'participation', readings: 'reading',
    responses: 'response', presentations: 'presentation', problems: 'problem', sets: 'set', reports: 'report'
  };
  var STOP = { and: 1, the: 1, of: 1, a: 1, in: 1, for: 1, grade: 1, total: 1, weekly: 1, class: 1, course: 1, your: 1, final_grade: 1, points: 1, pts: 1, percent: 1 };

  function tokens(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9\- ]+/g, ' ').split(/\s+/).filter(Boolean)
      .map(function (w) { w = SYN[w] || w; return w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? (SYN[w.slice(0, -1)] || w.slice(0, -1)) : w; })
      .filter(function (w) { return !STOP[w] && !/^\d+$/.test(w); });
  }

  function similarity(a, b) {
    var A = tokens(a), B = tokens(b);
    if (!A.length || !B.length) return 0;
    var hit = A.filter(function (w) { return B.indexOf(w) >= 0; }).length;
    var score = hit / (A.length + B.length - hit);
    if (A.join(' ') === B.join(' ')) score = 1;
    if (A.indexOf('final') >= 0 !== B.indexOf('final') >= 0 && (A.indexOf('exam') >= 0 || B.indexOf('exam') >= 0)) score *= 0.5;
    return score;
  }

  function cleanLabel(raw) {
    raw = raw
      .replace(/\(\s*\)/g, ' ')
      .replace(/\b(of|toward|towards)\s+(the\s+|your\s+)?(final\s+|course\s+|total\s+|overall\s+)?(grade|total|mark)\b/gi, ' ')
      .replace(/\b(weight(ed)?|worth|percent(age)?|total)\b/gi, ' ');
    var parts = raw.split(':');
    if (parts.length > 1 && (parts[parts.length - 1].match(/[A-Za-z]/g) || []).length >= 3) raw = parts[parts.length - 1];
    return raw
      .replace(/^[\s\d.)(*:=|\u2013\u2014\u2212-]+/, '')
      .replace(/[\s.:=|,*(\-\u2013\u2014]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function parseSyllabus(text) {
    text = String(text || '').slice(0, 200000);
    var lines = text.replace(/\r/g, '').split(/\n|•|●|▪|;/).map(function (l) { return l.replace(/[ \t ]+/g, ' ').trim(); }).filter(Boolean);
    var scale = {}, items = [], seen = {};
    var rangeA = new RegExp('(?:^|[\\s,(])([A-DF][+\\u2212-]?)\\s*[:=]?\\s*\\(?\\s*(\\d{2}(?:\\.\\d+)?)\\s*%?\\s*(?:' + DASH + '|to)\\s*(\\d{2,3}(?:\\.\\d+)?)', 'g');
    var rangeB = new RegExp('(\\d{2}(?:\\.\\d+)?)\\s*%?\\s*(?:' + DASH + '|to)\\s*(\\d{2,3}(?:\\.\\d+)?)\\s*%?\\s*[:=]?\\s*([A-DF][+\\u2212-]?)(?=[\\s,).]|$)', 'g');
    var above = /(?:^|[\s,(])([A-DF][+\u2212-]?)\s*[:=]?\s*(\d{2}(?:\.\d+)?)\s*%?\s*(?:and above|or above|or higher|or more|\+)/gi;
    function addScale(letter, min) {
      letter = letter.toUpperCase().replace('\u2212', '-');
      if (letter === 'F' || !(min >= 40 && min <= 100) || scale[letter] != null) return;
      scale[letter] = min;
    }
    lines.forEach(function (line) {
      var m, found = false;
      rangeA.lastIndex = 0; rangeB.lastIndex = 0; above.lastIndex = 0;
      while ((m = rangeA.exec(line))) { addScale(m[1], Math.min(+m[2], +m[3])); found = true; }
      while ((m = rangeB.exec(line))) { addScale(m[3], Math.min(+m[1], +m[2])); found = true; }
      while ((m = above.exec(line))) { addScale(m[1], +m[2]); found = true; }
      if (found) return;
      if (!/%/.test(line) || POLICY.test(line)) return;
      var chunks = (line.match(/%/g) || []).length > 1 ? line.split(/,|\||\t| {3,}|\band\b(?=[^%]*\d\s*%)/) : [line];
      chunks.forEach(function (chunk) {
        var pm = chunk.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
        if (!pm) return;
        var pct = parseFloat(pm[1]);
        if (!(pct > 0 && pct <= 100)) return;
        var label = cleanLabel(chunk.replace(pm[0], ' ')).replace(/\((lowest|highest)[^)]*\)/i, '').trim();
        if ((label.match(/[A-Za-z]/g) || []).length < 3 || label.length > 70) return;
        if (/^[A-DF][+-]?$/.test(label)) return;
        var key = tokens(label).join(' ') || label.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        items.push({ label: label, pct: pct });
      });
    });
    var scaleList = Object.keys(scale).map(function (k) { return { letter: k, min: scale[k] }; }).sort(function (a, b) { return b.min - a.min; });
    return { items: items, scale: scaleList.length >= 3 ? scaleList : [] };
  }

  // Pairs each Canvas group with the syllabus line that fits it best (one to one).
  function matchSyllabus(groups, items) {
    var pairs = [];
    groups.forEach(function (g, gi) {
      items.forEach(function (it, ii) {
        var sc = similarity(g.name, it.label);
        if (sc >= 0.2) pairs.push({ gi: gi, ii: ii, sc: sc });
      });
    });
    pairs.sort(function (a, b) { return b.sc - a.sc; });
    var gUsed = {}, iUsed = {}, map = {};
    pairs.forEach(function (pr) {
      if (gUsed[pr.gi] || iUsed[pr.ii]) return;
      gUsed[pr.gi] = iUsed[pr.ii] = true;
      map[groups[pr.gi].id] = pr.ii;
    });
    return { map: map, unused: items.filter(function (_, i) { return !iUsed[i]; }) };
  }

  return {
    parseSyllabus: parseSyllabus, matchSyllabus: matchSyllabus,
    DEFAULT_SCALE: DEFAULT_SCALE, analyze: analyze, need: need, neededScore: neededScore,
    letterFor: letterFor, validScale: validScale, normalizePayload: normalizePayload, sampleData: sampleData, isNum: isNum
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Par;

/* =========================================================
   Part 2: the app on the page.
   ========================================================= */
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
  var KEY = 'par:v1';
  var isNum = Par.isNum;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    store: { data: null, prefs: {} },
    storageOk: true,
    animate: true,
    shimmer: false,
    classFilter: null,
    syl: {}
  };

  // ---------- Storage (never crashes if blocked) ----------
  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { state.storageOk = false; return; }
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      var prefs = s && s.prefs && typeof s.prefs === 'object' ? s.prefs : {};
      var data = null;
      if (s && s.data) {
        try { data = Par.normalizePayload(s.data); } catch (e) { data = null; }
      }
      state.store = { data: data, prefs: prefs };
    } catch (e) {
      state.store = { data: null, prefs: {} };
    }
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state.store));
      state.storageOk = true;
    } catch (e) {
      state.storageOk = false;
    }
  }

  function pref(id) {
    var p = state.store.prefs[id];
    if (!p || typeof p !== 'object') p = state.store.prefs[id] = {};
    if (!p.predictions || typeof p.predictions !== 'object') p.predictions = {};
    return p;
  }

  // ---------- Helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function fmt(n, d) {
    if (!isNum(n)) return '';
    d = d == null ? 1 : d;
    var s = n.toFixed(d);
    return d > 0 ? s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : s;
  }
  function fmtPct(n, d) { return isNum(n) ? fmt(n, d) + '%' : ''; }
  function article(letter) { return /^[AEF]/.test(letter) ? 'an' : 'a'; }

  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return 'just now';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    var d = Math.round(h / 24);
    return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dueParts(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d)) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var that = new Date(d); that.setHours(0, 0, 0, 0);
    var diff = Math.round((that - today) / 86400000);
    var rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' :
      diff > 1 && diff < 7 ? DAYS[d.getDay()] : diff < 0 ? Math.abs(diff) + ' days ago' : 'In ' + diff + ' days';
    var hr = d.getHours(), min = d.getMinutes();
    var time = ((hr % 12) || 12) + (min ? ':' + String(min).padStart(2, '0') : '') + (hr < 12 ? ' AM' : ' PM');
    return { month: MONTHS[d.getMonth()], day: d.getDate(), rel: rel, time: time, diff: diff, past: d.getTime() < Date.now() };
  }

  var STATUS = {
    par: { label: 'On par', cls: 'par' },
    push: { label: 'Push', cls: 'push' },
    birdie: { label: 'Need a birdie', cls: 'birdie' },
    out: { label: 'Out of bounds', cls: 'out' },
    locked: { label: 'Locked in', cls: 'locked' }
  };

  function toast(msg, tone) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show ' + (tone || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = ''; }, 3200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }

  function errorDetails(message, extra) {
    return ['Par error', 'What happened: ' + message, extra ? 'Details: ' + extra : '',
      'Page: ' + location.href.split('#')[0] + (location.hash || ''), 'Time: ' + new Date().toString(), 'Browser: ' + navigator.userAgent]
      .filter(Boolean).join('\n');
  }

  function courses() { return state.store.data ? state.store.data.courses : []; }
  function visibleCourses() { return courses().filter(function (c) { return !pref(c.id).hidden; }); }
  function findCourse(id) { return courses().filter(function (c) { return c.id === id; })[0] || null; }
  function canvasHome() {
    var d = state.store.data;
    return d && !d.sample && /^https:\/\//.test(d.origin) ? d.origin : 'https://canvas.calpoly.edu';
  }

  // ---------- Pieces of UI ----------
  function ring(an, size) {
    size = size || 132;
    var sw = size > 100 ? 10 : 7;
    var r = (size - sw) / 2 - 4;
    var c = 2 * Math.PI * r;
    var cur = isNum(an.current) ? Math.max(0, Math.min(100, an.current)) : 0;
    var off = c * (1 - cur / 100);
    var ang = (Math.max(0, Math.min(100, an.target)) / 100) * 2 * Math.PI - Math.PI / 2;
    var cx = size / 2, tx = cx + r * Math.cos(ang), ty = cx + r * Math.sin(ang);
    return '<svg class="ring s-' + STATUS[an.status].cls + '" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle class="ring-track" cx="' + cx + '" cy="' + cx + '" r="' + r + '" stroke-width="' + sw + '"/>' +
      '<circle class="ring-arc" cx="' + cx + '" cy="' + cx + '" r="' + r + '" stroke-width="' + sw + '" stroke-dasharray="' + c.toFixed(2) + '" ' +
      'stroke-dashoffset="' + (state.animate && !reduceMotion ? c.toFixed(2) : off.toFixed(2)) + '" data-off="' + off.toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>' +
      '<circle class="ring-target" cx="' + tx.toFixed(2) + '" cy="' + ty.toFixed(2) + '" r="' + (sw / 2 + 2.5) + '"/>' +
      '</svg>';
  }

  function counter(value, dec, suffix, cls) {
    if (!isNum(value)) return '<span class="' + (cls || '') + '">--</span>';
    var shown = state.animate && !reduceMotion ? (0).toFixed(dec) : value.toFixed(dec);
    return '<span class="num ' + (cls || '') + '" data-count="' + value + '" data-dec="' + dec + '" data-suffix="' + esc(suffix || '') + '">' + shown + esc(suffix || '') + '</span>';
  }

  function pill(an) {
    var s = STATUS[an.status];
    return '<span class="pill ' + s.cls + '"><i></i>' + s.label + '</span>';
  }

  function targetButton(course, an) {
    return '<button class="target-btn" data-action="pick-target" data-course="' + esc(course.id) + '" aria-haspopup="true" title="Change target grade">' +
      '<span class="tb-k">Target</span><span class="tb-v">' + esc(an.targetLetter || fmtPct(an.target)) + '</span>' +
      '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>';
  }

  function parLine(an) {
    if (an.state === 'empty') return { big: fmtPct(an.p * 100), label: 'Aim for on everything' };
    if (an.state === 'done') return { big: fmtPct(an.f0), label: 'Final grade' };
    if (an.state === 'out') return { big: fmtPct(an.f1), label: 'Best possible' };
    if (an.state === 'locked') return { big: '0%', label: 'Needed on the rest' };
    return { big: fmtPct(an.p * 100), label: 'Par on everything left' };
  }

  function headline(an) {
    var L = an.targetLetter;
    if (an.state === 'empty' || (an.noGrades && an.state === 'live')) {
      return 'No grades yet. Aim for ' + fmtPct(an.p * 100) + ' on everything to get ' + article(L) + ' ' + L + '.';
    }
    if (an.state === 'done' && an.remainingCount) return 'What\'s left doesn\'t change your grade (it\'s in 0% groups). Final: ' + fmtPct(an.f0) + '.';
    if (an.state === 'done') return 'Nothing left to grade. Final: ' + fmtPct(an.f0) + '.';
    if (an.state === 'out') {
      return 'Out of reach. The best you can get is ' + fmtPct(an.f1) + ' (' + (Par.letterFor(an.f1, an.scale) || 'F') + ').';
    }
    if (an.state === 'locked') return 'Locked in. You\'d keep ' + article(L) + ' ' + L + ' even with zeros on everything left. Enjoy the 19th hole.';
    return 'Score ' + fmtPct(an.p * 100) + ' on everything left to finish with ' + article(L) + ' ' + L + ' (' + fmtPct(an.target) + ').';
  }

  function needHtml(an, item, compact) {
    var a = item.a;
    if (item.predicted != null) {
      return '<div class="need predicted"><span class="need-k">What-if</span><span class="need-v mono">' + fmt(item.predicted) + '<em> / ' + fmt(a.pts) + '</em></span></div>';
    }
    var n = Par.need(an, a.pts);
    if (n.kind === 'locked') return '<div class="need locked"><span class="need-k">Par</span><span class="need-v mono">0<em> / ' + fmt(a.pts) + '</em></span>' + (compact ? '' : '<span class="need-p">Locked in</span>') + '</div>';
    if (n.kind === 'out') return '<div class="need out"><span class="need-k">Max it</span><span class="need-v mono">' + fmt(a.pts) + '<em> / ' + fmt(a.pts) + '</em></span>' + (compact ? '' : '<span class="need-p">Out of reach</span>') + '</div>';
    if (n.kind !== 'need') return '';
    return '<div class="need ' + STATUS[an.status].cls + '"><span class="need-k">Par</span><span class="need-v mono">' + fmt(n.score) + '<em> / ' + fmt(a.pts) + '</em></span><span class="need-p">' + fmt(n.pct, 0) + '%</span></div>';
  }

  // ---------- Screens ----------
  function viewWelcome() {
    var s = Par.sampleData();
    var rows = s.data.courses.map(function (c) {
      var an = Par.analyze(c, { target: s.targets[c.id] });
      var pl = an.state === 'out' ? 'Max' : fmtPct(an.p * 100, 0);
      return '<div class="lb-row"><span class="lb-code mono">' + esc(c.code) + '</span><span class="lb-name">' + esc(c.name) + '</span>' +
        '<span class="lb-n mono">' + fmt(an.current, 1) + '</span><span class="lb-n mono accent">' + esc(an.targetLetter) + '</span>' +
        '<span class="lb-n mono">' + pl + '</span>' + pill(an) + '</div>';
    }).join('');
    function feat(icon, title, text) {
      return '<div class="feat"><div class="feat-i">' + icon + '</div><h3>' + title + '</h3><p>' + text + '</p></div>';
    }
    var I = {
      flag: '<svg viewBox="0 0 24 24"><path d="M6 21V4m0 0l11 4-11 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      wand: '<svg viewBox="0 0 24 24"><path d="M4 20L15 9m2-5v3m3 0h-3m1.5 5.5v2m1-1h-2M9 4v2M8 5h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
      check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      sync: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
    };
    return '<div class="landing">' +
      '<section class="welcome">' +
        '<div class="w-copy">' +
          '<div class="badge"><span class="dotlive"></span>Works with Canvas<span class="sep"></span>Nothing leaves your browser</div>' +
          '<h1>Every assignment<br>has a <span class="hl">par</span>.</h1>' +
          '<p class="lede">Canvas shows your grade. Par shows what you need next. It pulls your real grades and weights from Canvas, and every assignment left gets a par score, like <span class="mono chip">Par 43 / 50</span>, to keep you on track for the grade you want.</p>' +
          '<div class="cta-row">' +
            '<a class="btn primary big" href="#/setup">Sync my Canvas<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>' +
            '<button class="btn big ghost" data-action="load-sample">Try with sample data</button>' +
          '</div>' +
          '<div class="w-meta mono"><span>Free</span><span>No account</span><span>1 minute setup</span></div>' +
        '</div>' +
        '<div class="w-demo" aria-hidden="true">' + demoCard() + '</div>' +
      '</section>' +

      '<section class="lb panel" aria-label="Sample scorecard">' +
        '<div class="lb-top"><span class="lb-live mono"><span class="dotlive"></span>Scorecard</span><span class="muted small">A sample student, mid-quarter</span></div>' +
        '<div class="lb-row lb-head mono"><span>Class</span><span></span><span class="lb-n">Now</span><span class="lb-n">Target</span><span class="lb-n">Par</span><span>Status</span></div>' +
        rows +
      '</section>' +

      '<section class="l-sec">' +
        '<div class="l-head"><div class="eyebrow">What you get</div><h2>The number Canvas never shows you.</h2></div>' +
        '<div class="feats">' +
          feat(I.flag, 'A par for every assignment', 'Pick a target like A-. Every upcoming assignment shows the exact score you need, across all your classes, sorted by due date.') +
          feat(I.wand, 'What-if scores', 'Know you\'ll ace participation? Type a predicted score and every other par updates instantly.') +
          feat(I.doc, 'Syllabus weights', 'Canvas weights wrong? Paste or upload your syllabus and Par reads the real breakdown.') +
          feat(I.check, 'Checks itself against Canvas', 'Par redoes the math, drop rules included, and tells you when it matches the grade Canvas shows.') +
          feat(I.sync, 'One-click re-sync', 'New grade posted? Click Sync Canvas and every number moves. Your targets and what-ifs stay.') +
          feat(I.lock, 'Private by design', 'No server, no login, no tracking. Your grades are read by your browser and saved only on your device.') +
        '</div>' +
      '</section>' +

      '<section class="l-sec how">' +
        '<div class="l-head"><div class="eyebrow">How it works</div><h2>Set up once. Sync in one click.</h2></div>' +
        '<ol class="how-steps">' +
          '<li><span class="how-n display">01</span><h3>Add the button</h3><p>Drag "Sync Canvas" to your bookmarks bar. No access key needed.</p></li>' +
          '<li><span class="how-n display">02</span><h3>Click it on Canvas</h3><p>It reads your classes with the login you already have.</p></li>' +
          '<li><span class="how-n display">03</span><h3>Play to par</h3><p>Pick your targets and see exactly what every assignment needs.</p></li>' +
        '</ol>' +
      '</section>' +

      '<section class="l-sec math panel">' +
        '<div><div class="eyebrow">The math</div><h2>Straight from your grade weights.</h2>' +
        '<p class="muted">Par finds the one average p that, scored on everything left, lands you exactly on your target. Then each assignment\'s par is p times its points, rounded up.</p></div>' +
        '<div class="math-ex mono">' +
          '<div class="mx-row"><span>Homework 40%</span><span>18 / 20 done, 20 left</span></div>' +
          '<div class="mx-row"><span>Final 60%</span><span>0 / 100 done, 100 left</span></div>' +
          '<div class="mx-row"><span>All zeros</span><span>18%</span></div>' +
          '<div class="mx-row"><span>All perfect</span><span>98%</span></div>' +
          '<div class="mx-row hl-row"><span>Target 90%</span><span>p = (90 - 18) / (98 - 18) = 90%</span></div>' +
          '<div class="mx-row"><span>Par</span><span><b>18 / 20</b> homework, <b>90 / 100</b> final</span></div>' +
        '</div>' +
      '</section>' +

      '<section class="l-final">' +
        '<h2>Know your par before your next assignment.</h2>' +
        '<div class="cta-row"><a class="btn primary big" href="#/setup">Sync my Canvas</a><button class="btn big ghost" data-action="load-sample">Try with sample data</button></div>' +
      '</section>' +
    '</div>';
  }

  function demoCard() {
    var s = Par.sampleData();
    var c = s.data.courses[0];
    var an = Par.analyze(c, { target: 87 });
    var items = [];
    an.groups.forEach(function (g) { g.remaining.forEach(function (r) { items.push(r); }); });
    items.sort(function (a, b) { return Date.parse(a.a.due) - Date.parse(b.a.due); });
    return '<div class="card demo">' + cardInner(c, an, true) +
      '<div class="demo-list">' + items.slice(0, 3).map(function (it) {
        return '<div class="demo-row"><span>' + esc(it.a.name) + '</span>' + needHtml(an, it, true) + '</div>';
      }).join('') + '</div></div>';
  }

  function cardInner(c, an, isDemo) {
    var pl = parLine(an);
    var check = an.matches === true ? '<span class="match ok" title="Par\'s math matches the grade Canvas shows">' + icoCheck() + 'Matches Canvas</span>' :
      an.matches === false ? '<span class="match bad">Doesn\'t match Canvas</span>' : '';
    return '<div class="card-top"><span class="code mono">' + esc(c.code || 'CLASS') + '</span>' + pill(an) + '</div>' +
      '<h3 class="card-name">' + esc(c.name) + '</h3>' +
      '<div class="card-mid">' +
        '<div class="gauge">' + ring(an, 132) +
          '<div class="gauge-in"><div class="gauge-num">' + counter(an.current, 1, '', 'display') + '</div>' +
          '<div class="gauge-sub">' + (an.noGrades ? 'No grades' : esc(an.currentLetter || 'F') + ' now') + '</div></div>' +
        '</div>' +
        '<div class="card-side">' +
          (isDemo ? '<div class="target-btn static"><span class="tb-k">Target</span><span class="tb-v">' + esc(an.targetLetter) + '</span></div>' : targetButton(c, an)) +
          '<div class="par-big"><div class="par-k">' + esc(pl.label) + '</div><div class="par-v display">' + esc(pl.big) + '</div></div>' +
          '<div class="card-meta mono">' + (an.remainingCount ? an.remainingCount + ' left' + (an.state === 'done' ? ', 0% weight' : '') : 'Nothing left') + (an.predictedCount ? ' · ' + an.predictedCount + ' what-if' : '') + '</div>' +
        '</div>' +
      '</div>' +
      (isDemo ? '' : '<div class="card-foot">' + check + (c.error ? '<span class="match bad">' + esc(c.error) + '</span>' : '') + '</div>');
  }

  function icoCheck() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function upNextItems(limitToCourse) {
    var items = [];
    visibleCourses().forEach(function (c) {
      if (limitToCourse && c.id !== limitToCourse) return;
      var an = Par.analyze(c, pref(c.id));
      an.groups.forEach(function (g) {
        g.remaining.forEach(function (r) { items.push({ c: c, an: an, item: r, g: g }); });
      });
    });
    items.sort(function (x, y) {
      var a = x.item.a.due ? Date.parse(x.item.a.due) : Infinity;
      var b = y.item.a.due ? Date.parse(y.item.a.due) : Infinity;
      return a - b;
    });
    return items;
  }

  function upNextRow(x) {
    var a = x.item.a, dp = dueParts(a.due);
    return '<a class="un-row' + (x.item.predicted != null ? ' is-pred' : '') + '" href="#/class/' + encodeURIComponent(x.c.id) + '">' +
      '<div class="un-date">' + (dp ? '<span class="un-m mono">' + dp.month + '</span><span class="un-d display">' + dp.day + '</span>' : '<span class="un-m mono">No</span><span class="un-d small">date</span>') + '</div>' +
      '<div class="un-main"><div class="un-name">' + esc(a.name) + '</div>' +
        '<div class="un-sub"><span class="code mono">' + esc(x.c.code || x.c.name) + '</span>' + (dp ? '<span>' + dp.rel + (dp.diff >= 0 && dp.diff < 7 ? ', ' + dp.time : '') + '</span>' : '') + '</div></div>' +
      needHtml(x.an, x.item, true) +
    '</a>';
  }

  function upNextSplit(items) {
    var now = Date.now();
    var upcoming = items.filter(function (x) { return !x.item.a.due || Date.parse(x.item.a.due) >= now; });
    var waiting = items.filter(function (x) { return x.item.a.due && Date.parse(x.item.a.due) < now; });
    return { upcoming: upcoming, waiting: waiting };
  }

  function viewHome() {
    var list = visibleCourses();
    var hidden = courses().length - list.length;
    var cards = list.map(function (c, i) {
      var an = Par.analyze(c, pref(c.id));
      return '<article class="card class-card' + (state.shimmer ? ' shimmer' : '') + '" style="--i:' + i + '" data-href="#/class/' + encodeURIComponent(c.id) + '" tabindex="0" role="link" aria-label="' + esc(c.name) + '">' + cardInner(c, an) + '</article>';
    }).join('');
    if (!list.length) {
      cards = '<div class="empty card"><h3>All your classes are hidden.</h3><p>Show them again to see your par scores.</p><button class="btn" data-action="unhide-all">Show all classes</button></div>';
    }
    var split = upNextSplit(upNextItems());
    var ans = list.map(function (c) { return Par.analyze(c, pref(c.id)); });
    var onTrack = ans.filter(function (a) { return a.status === 'par' || a.status === 'locked'; }).length;
    var weekAhead = split.upcoming.filter(function (x) { return x.item.a.due && Date.parse(x.item.a.due) - Date.now() < 7 * 86400000; }).length;
    var nextUp = split.upcoming[0];
    var nextNeed = nextUp ? Par.need(nextUp.an, nextUp.item.a.pts) : null;
    var stats = '<div class="stats">' +
      '<div class="stat"><span class="stat-k mono">Classes</span><span class="stat-v display">' + list.length + '</span></div>' +
      '<div class="stat"><span class="stat-k mono">On par</span><span class="stat-v display">' + onTrack + '<em>/' + list.length + '</em></span></div>' +
      '<div class="stat"><span class="stat-k mono">Due in 7 days</span><span class="stat-v display">' + weekAhead + '</span></div>' +
      '<div class="stat wide"><span class="stat-k mono">Next up</span>' + (nextUp ?
        '<span class="stat-next"><b>' + esc(nextUp.item.a.name) + '</b><span class="muted small">' + esc(nextUp.c.code || nextUp.c.name) + ' · ' + esc((dueParts(nextUp.item.a.due) || {}).rel || 'No date') + '</span></span>' +
        (nextUp.item.predicted == null && nextNeed && nextNeed.kind === 'need' ? '<span class="stat-par mono">Par ' + fmt(nextNeed.score) + '/' + fmt(nextUp.item.a.pts) + '</span>' : '') :
        '<span class="muted">Nothing upcoming</span>') + '</div>' +
    '</div>';
    var side = split.upcoming.slice(0, 7).map(upNextRow).join('') ||
      '<div class="muted pad">Nothing upcoming. Enjoy it.</div>';
    return stats + '<div class="dash">' +
      '<section class="dash-main">' +
        '<div class="sec-head"><h2>Your classes</h2><span class="muted small">' + list.length + ' class' + (list.length === 1 ? '' : 'es') +
          (hidden ? ' · <button class="linklike" data-action="unhide-all">' + hidden + ' hidden, show</button>' : '') + '</span></div>' +
        '<div class="cards">' + cards + '</div>' +
      '</section>' +
      '<aside class="dash-side">' +
        '<div class="panel">' +
          '<div class="sec-head"><h2>Up next</h2><a class="linklike" href="#/next">See all</a></div>' +
          '<div class="un-list">' + side + '</div>' +
        '</div>' +
        legend() +
      '</aside>' +
    '</div>';
  }

  function legend() {
    return '<div class="panel legend"><div class="sec-head"><h2>Scorecard key</h2></div>' +
      '<div class="lg"><span class="pill par"><i></i>On par</span><span>Need under 85% on what\'s left</span></div>' +
      '<div class="lg"><span class="pill push"><i></i>Push</span><span>Need 85% to 95%</span></div>' +
      '<div class="lg"><span class="pill birdie"><i></i>Need a birdie</span><span>Need over 95%</span></div>' +
      '<div class="lg"><span class="pill out"><i></i>Out of bounds</span><span>Target is out of reach</span></div>' +
      '<div class="lg"><span class="pill locked"><i></i>Locked in</span><span>You keep it even with zeros</span></div>' +
    '</div>';
  }

  function viewNext() {
    var items = upNextItems(state.classFilter);
    var split = upNextSplit(items);
    var filters = '<div class="filters"><button class="fchip' + (!state.classFilter ? ' on' : '') + '" data-action="filter" data-course="">All classes</button>' +
      visibleCourses().map(function (c) {
        return '<button class="fchip' + (state.classFilter === c.id ? ' on' : '') + '" data-action="filter" data-course="' + esc(c.id) + '">' + esc(c.code || c.name) + '</button>';
      }).join('') + '</div>';
    return '<section class="page">' +
      '<div class="page-head"><div><div class="eyebrow">Every class, sorted by due date</div><h1>Up next</h1></div></div>' +
      filters +
      '<div class="panel"><div class="un-list big">' + (split.upcoming.map(upNextRow).join('') || '<div class="muted pad">Nothing upcoming. Enjoy it.</div>') + '</div></div>' +
      (split.waiting.length ? '<div class="sec-head mt"><h2>Waiting on grades</h2><span class="muted small">Past due, no score in Canvas yet</span></div>' +
        '<div class="panel"><div class="un-list big">' + split.waiting.map(upNextRow).join('') + '</div></div>' : '') +
    '</section>';
  }

  function viewClass(id) {
    var c = findCourse(id);
    if (!c) {
      return '<section class="page"><div class="empty card"><h3>That class isn\'t here.</h3><p>It may have been removed in your last sync.</p><a class="btn" href="#/">Back to dashboard</a></div></section>';
    }
    var p = pref(c.id);
    var an = Par.analyze(c, p);
    var pl = parLine(an);

    var matchBox = '';
    if (an.matches === true) {
      matchBox = '<span class="match ok">' + icoCheck() + 'Matches Canvas (' + fmtPct(an.canvasScore, 2) + ')</span>';
    } else if (an.matches === false) {
      matchBox = '<div class="notice warn"><b>Doesn\'t match Canvas, check your weights.</b> Canvas shows ' + fmtPct(an.canvasScore, 2) + ' but Par gets ' + fmtPct(an.current, 2) +
        '. Your syllabus may use weights that aren\'t set up in Canvas. <button class="linklike" data-action="scroll-to" data-target="syllabus">Add your syllabus</button> or <button class="linklike" data-action="scroll-to" data-target="weights">edit weights</button>.</div>';
    }

    var extra = '';
    if (an.state === 'out' && an.bestTarget) {
      extra = '<button class="btn small" data-action="set-target" data-course="' + esc(c.id) + '" data-value="' + an.bestTarget.min + '">Switch target to ' + esc(an.bestTarget.letter) + ' (' + an.bestTarget.min + '%), still possible</button>';
    } else if (an.state === 'out') {
      extra = '<span class="muted small">No letter on your scale is still reachable. Every point still helps.</span>';
    }

    var groupsHtml = an.groups.map(function (g) {
      var head = '<div class="g-head"><div><h3>' + esc(g.name) + '</h3>' +
        '<div class="g-sub mono">' + (an.weighted ? fmtPct(g.weight) + ' of grade' + (Math.abs(g.share - g.weight) > 0.05 ? ' (counts as ' + fmtPct(g.share) + ')' : '') : 'Points') +
        (g.current != null ? ' · You: ' + fmtPct(g.current) : '') + '</div></div></div>';
      var dropBits = [];
      if (g.dropLow) dropBits.push('your lowest ' + (g.dropLow === 1 ? 'score' : g.dropLow + ' scores'));
      if (g.dropHigh) dropBits.push('your highest ' + (g.dropHigh === 1 ? 'score' : g.dropHigh + ' scores'));
      var drop = g.drops ? '<div class="notice tiny">This group drops ' + dropBits.join(' and ') + '. Par drops them the same way Canvas does.</div>' : '';
      var zero = an.weighted && g.weight === 0 && (g.R > 0 || g.G > 0) ? '<div class="notice tiny">This group has 0% weight, so it doesn\'t change your grade.</div>' : '';
      var rows = [];
      g.remaining.slice().sort(function (x, y) { return (Date.parse(x.a.due) || Infinity) - (Date.parse(y.a.due) || Infinity); }).forEach(function (r) {
        var dp = dueParts(r.a.due);
        rows.push('<div class="a-row rem' + (r.predicted != null ? ' is-pred' : '') + '">' +
          '<div class="a-name"><span>' + esc(r.a.name) + '</span><span class="a-due">' + (dp ? (dp.past ? 'Was due ' : 'Due ') + dp.month + ' ' + dp.day : 'No due date') + '</span></div>' +
          needHtml(an, r) +
          '<label class="whatif"><span>What-if</span><input type="text" inputmode="decimal" autocomplete="off" id="wi-' + esc(r.a.id) + '" data-action="whatif" data-course="' + esc(c.id) + '" data-aid="' + esc(r.a.id) + '" data-pts="' + r.a.pts + '" placeholder="--" value="' + (r.predicted != null ? esc(fmt(r.predicted, 2)) : '') + '" aria-label="What-if score for ' + esc(r.a.name) + '"><em>/ ' + fmt(r.a.pts) + '</em></label>' +
        '</div>');
      });
      g.graded.forEach(function (r) {
        var pct = r.a.pts > 0 ? r.a.score / r.a.pts * 100 : null;
        rows.push('<div class="a-row done"><div class="a-name"><span>' + esc(r.a.name) + '</span><span class="a-due">Graded</span></div>' +
          '<div class="score mono"><b>' + fmt(r.a.score, 2) + '</b> / ' + fmt(r.a.pts) + (pct != null ? '<span>' + fmt(pct, 0) + '%</span>' : '<span>Extra</span>') + '</div><div></div></div>');
      });
      g.skipped.forEach(function (r) {
        rows.push('<div class="a-row skip"><div class="a-name"><span>' + esc(r.a.name) + '</span><span class="a-due">' + esc(r.why) + '</span></div><div class="score mono muted">Skipped</div><div></div></div>');
      });
      if (!rows.length) rows.push('<div class="muted pad small">No assignments in this group yet.</div>');
      return '<section class="panel group">' + head + drop + zero + '<div class="a-list">' + rows.join('') + '</div></section>';
    }).join('');

    if (!an.groups.length) {
      groupsHtml = '<div class="panel pad"><b>No assignments yet.</b> <span class="muted">When your professor posts assignments in Canvas, sync again and they\'ll show up here.</span></div>';
    }

    var anyPred = an.predictedCount > 0;

    return '<section class="page class-page">' +
      '<a class="back" href="#/"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Dashboard</a>' +
      '<div class="hero panel' + (state.shimmer ? ' shimmer' : '') + '">' +
        '<div class="hero-l">' +
          '<div class="card-top"><span class="code mono">' + esc(c.code || 'CLASS') + '</span>' + pill(an) + '</div>' +
          '<h1>' + esc(c.name) + '</h1>' +
          '<p class="headline">' + esc(headline(an)) + '</p>' +
          '<div class="hero-actions">' + targetButton(c, an) + extra + (anyPred ? '<button class="btn small ghost" data-action="clear-whatif" data-course="' + esc(c.id) + '">Clear what-ifs</button>' : '') + '</div>' +
          matchBox +
        '</div>' +
        '<div class="hero-r">' +
          '<div class="gauge lg">' + ring(an, 188) +
            '<div class="gauge-in"><div class="gauge-num">' + counter(an.current, 1, '', 'display') + '</div><div class="gauge-sub">' + (an.noGrades ? 'No grades yet' : 'Current, ' + esc(an.currentLetter || 'F')) + '</div></div>' +
          '</div>' +
          '<div class="hero-par"><div class="par-k">' + esc(pl.label) + '</div><div class="par-v display">' + esc(pl.big) + '</div>' +
            (anyPred && isNum(an.projected) ? '<div class="muted small">With what-ifs: ' + fmtPct(an.projected) + ' so far</div>' : '') + '</div>' +
        '</div>' +
      '</div>' +
      (anyPred ? '<div class="notice pred">Scores in <span class="pred-sample">dashed boxes</span> are your what-if guesses, not real grades yet. Par treats them as graded.</div>' : '') +
      '<div class="groups">' + groupsHtml + '</div>' +
      syllabusHtml(c, p, an) +
      settingsHtml(c, p, an) +
    '</section>';
  }

  function syllabusHtml(c, p, an) {
    var d = state.syl[c.id];
    var saved = typeof p.syllabus === 'string' ? p.syllabus : '';
    var result = '';
    if (d && d.error) {
      result = '<div class="notice warn">' + esc(d.error) + '</div>';
    } else if (d) {
      var rows = an.groups.map(function (g) {
        var r = d.rows[g.id] || { value: 0 };
        return '<div class="syl-row' + (r.label ? '' : ' miss') + '"><div class="syl-g"><b>' + esc(g.name) + '</b>' +
          '<span class="syl-src' + (r.guess ? ' guess' : '') + '">' + (r.label ? (r.guess ? 'Best guess: "' : 'Syllabus: "') + esc(r.label) + '"' : 'Not found in syllabus') + '</span></div>' +
          '<span class="w-in"><input type="text" inputmode="decimal" data-syl-weight="' + esc(g.id) + '" data-course="' + esc(c.id) + '" value="' + esc(fmt(r.value, 2)) + '"><em>%</em></span>' +
          '<span class="syl-was mono">Canvas: ' + fmtPct(g.canvasWeight) + '</span></div>';
      }).join('');
      var total = an.groups.reduce(function (s2, g) { return s2 + ((d.rows[g.id] || {}).value || 0); }, 0);
      var chips = d.items.map(function (it) {
        return '<span class="syl-chip' + (d.unusedLabels.indexOf(it.label) >= 0 ? ' unused' : '') + '">' + esc(it.label) + ' <b class="mono">' + fmt(it.pct, 2) + '%</b></span>';
      }).join('');
      result =
        '<div class="syl-found"><span class="muted small">Found in your syllabus:</span>' + chips + '</div>' +
        (d.unusedLabels.length ? '<p class="muted small">Dimmed items didn\'t match a Canvas group. Add their weight to the right group below if they belong together.</p>' : '') +
        '<form data-form="syl-apply" data-course="' + esc(c.id) + '"><div class="syl-rows">' + rows + '</div>' +
        '<div class="w-foot"><span class="mono small ' + (Math.abs(total - 100) > 0.01 ? 'warn-text' : 'muted') + '">Total: ' + fmt(total, 2) + '%' + (Math.abs(total - 100) > 0.01 ? ' (usually adds to 100)' : '') + '</span>' +
        (d.scale.length ? '<label class="check"><input type="checkbox" name="scale" checked> Also use the syllabus letter scale (' + d.scale.map(function (x) { return esc(x.letter) + ' ' + fmt(x.min, 2); }).join(', ') + ')</label>' : '') +
        '<span class="w-btns"><button type="button" class="btn small ghost" data-action="syl-cancel" data-course="' + esc(c.id) + '">Cancel</button><button class="btn small primary">Use these weights</button></span></div></form>';
    }
    return '<section class="panel syllabus" id="syllabus">' +
      '<div class="syl-head"><div><div class="sec-head"><h2>Syllabus weights</h2>' + (p.sylApplied ? '<span class="pill par"><i></i>Using syllabus</span>' : '') + '</div>' +
      '<p class="muted small">Canvas weights wrong or missing? Paste the grading part of your syllabus, or upload the PDF. Par finds lines like "Homework 20%" and matches them to your Canvas groups. It all happens in this browser.</p></div></div>' +
      '<textarea id="syl-' + esc(c.id) + '" data-syl-text="' + esc(c.id) + '" rows="5" spellcheck="false" placeholder="Example:\nHomework 20%\nQuizzes 10%\nMidterm Exam 30%\nFinal Exam 40%">' + esc(saved) + '</textarea>' +
      '<div class="syl-actions"><label class="btn small ghost file-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0l-4 4m4-4l4 4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Upload PDF<input type="file" accept=".pdf,.txt,application/pdf,text/plain" data-syl-file="' + esc(c.id) + '"></label>' +
      '<button class="btn small primary" data-action="syl-read" data-course="' + esc(c.id) + '">Find weights</button>' +
      '<span class="muted small" id="sylStatus-' + esc(c.id) + '"></span></div>' +
      result +
    '</section>';
  }

  function readSyllabus(id, text) {
    var c = findCourse(id);
    if (!c) return;
    var p = pref(id);
    p.syllabus = String(text || '').slice(0, 60000);
    save();
    if (!p.syllabus.trim()) { state.syl[id] = { error: 'The syllabus box is empty. Paste the grading section, or upload the PDF.' }; render({ keepScroll: true }); return; }
    var parsed = Par.parseSyllabus(p.syllabus);
    if (!parsed.items.length) {
      state.syl[id] = { error: 'Par couldn\'t find any percentages. Paste just the grading breakdown, with lines like "Homework 20%". If your syllabus uses points instead of percents, type the weights in the Grade weights box below.' };
      render({ keepScroll: true });
      return;
    }
    var m = Par.matchSyllabus(c.groups, parsed.items);
    var rows = {};
    var openGroups = c.groups.filter(function (g) { return m.map[g.id] == null && g.assignments.length; });
    if (openGroups.length === 1 && m.unused.length === 1) {
      m.map[openGroups[0].id] = parsed.items.indexOf(m.unused[0]);
      m.guess = openGroups[0].id;
      m.unused = [];
    }
    c.groups.forEach(function (g) {
      var ii = m.map[g.id];
      rows[g.id] = ii != null ? { value: parsed.items[ii].pct, label: parsed.items[ii].label, guess: m.guess === g.id } : { value: 0 };
    });
    state.syl[id] = { items: parsed.items, rows: rows, scale: parsed.scale, unusedLabels: m.unused.map(function (x) { return x.label; }) };
    render({ keepScroll: true });
    var box = document.getElementById('syllabus');
    if (box && box.scrollIntoView) box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  var pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      sc.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('PDF reader missing')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      sc.onerror = function () { pdfjsPromise = null; reject(new Error('Could not load the PDF reader')); };
      document.head.appendChild(sc);
    });
    return pdfjsPromise;
  }

  function pdfToText(file) {
    return Promise.all([loadPdfJs(), file.arrayBuffer()]).then(function (res) {
      return res[0].getDocument({ data: res[1] }).promise;
    }).then(function (doc) {
      var pages = [];
      for (var i = 1; i <= Math.min(doc.numPages, 40); i++) pages.push(i);
      return Promise.all(pages.map(function (n) {
        return doc.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var out = '', lastY = null;
          tc.items.forEach(function (it) {
            var y = it.transform ? Math.round(it.transform[5]) : null;
            if (lastY != null && y != null && Math.abs(y - lastY) > 2) out += '\n';
            else if (out && !/\s$/.test(out)) out += ' ';
            out += it.str;
            if (it.hasEOL) out += '\n';
            lastY = y;
          });
          return out;
        });
      }));
    }).then(function (texts) { return texts.join('\n'); });
  }

  function handleSyllabusFile(input) {
    var id = input.getAttribute('data-syl-file');
    var file = input.files && input.files[0];
    if (!file) return;
    var status = document.getElementById('sylStatus-' + id);
    var box = document.getElementById('syl-' + id);
    if (file.size > 25e6) { toast('That file is too big. Try a PDF under 25 MB.'); return; }
    var isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (status) status.textContent = 'Reading ' + file.name + '...';
    var job = isPdf ? pdfToText(file) : file.text();
    job.then(function (text) {
      if (!text || !text.trim()) throw new Error('empty');
      if (box) box.value = text;
      readSyllabus(id, text);
      toast('Read ' + file.name + '. Check the weights below.', 'ok');
    }).catch(function (err) {
      if (status) status.textContent = '';
      state.syl[id] = { error: err && err.message === 'empty' ?
        'That PDF has no readable text (it may be a scanned image). Copy the grading section from the syllabus and paste it in the box instead.' :
        'Par couldn\'t read that file. Open the syllabus, copy the grading section, and paste it in the box instead.' };
      render({ keepScroll: true });
    });
    input.value = '';
  }

  function settingsHtml(c, p, an) {
    var hasCanvasWeights = c.groups.some(function (g) { return isNum(g.weight) && g.weight > 0; });
    var sum = an.groups.reduce(function (s, g) { return s + g.weight; }, 0);
    var weightRows = an.groups.map(function (g) {
      return '<label class="w-row"><span>' + esc(g.name) + '</span><span class="w-in"><input type="text" inputmode="decimal" data-weight="' + esc(g.id) + '" value="' + esc(fmt(g.weight, 2)) + '"><em>%</em></span></label>';
    }).join('');
    var scale = an.scale.map(function (s, i) {
      return '<label class="s-cell"><span class="mono">' + esc(s.letter) + '</span><input type="text" inputmode="decimal" data-scale="' + i + '" data-letter="' + esc(s.letter) + '" value="' + esc(fmt(s.min, 2)) + '"></label>';
    }).join('');
    return '<section class="settings" id="weights">' +
      '<div class="panel">' +
        '<div class="sec-head"><h2>Grade weights</h2>' +
          '<label class="switch"><input type="checkbox" data-action="toggle-weights" data-course="' + esc(c.id) + '"' + (an.useWeights ? ' checked' : '') + '><span class="sw"></span><span>Use weights</span></label></div>' +
        '<p class="muted small">' + (hasCanvasWeights ? 'These came from Canvas. ' : 'Canvas has no weights for this class. ') +
          'If your syllabus says something like Homework 20%, Midterm 30%, Final 50%, type it here and turn on Use weights. Saved for this class, even after you re-sync.</p>' +
        (an.groups.length ? '<form class="w-form" data-form="weights" data-course="' + esc(c.id) + '">' + weightRows +
          '<div class="w-foot"><span class="mono small ' + (Math.abs(sum - 100) > 0.01 && an.useWeights ? 'warn-text' : 'muted') + '">Total: ' + fmt(sum, 2) + '%' + (Math.abs(sum - 100) > 0.01 && an.useWeights ? ' (usually adds to 100)' : '') + '</span>' +
          '<span class="w-btns"><button type="button" class="btn small ghost" data-action="reset-weights" data-course="' + esc(c.id) + '">Reset to Canvas</button><button class="btn small primary">Save weights</button></span></div></form>' :
          '<p class="muted small">No assignment groups yet.</p>') +
        (an.weightsBroken ? '<div class="notice warn">Every group has 0% weight, so Par is using plain points for now. Type in your weights above.</div>' : '') +
      '</div>' +
      '<div class="panel">' +
        '<div class="sec-head"><h2>Letter scale</h2><button class="linklike" data-action="reset-scale" data-course="' + esc(c.id) + '">Reset</button></div>' +
        '<p class="muted small">Minimum percent for each letter. Change it if your syllabus is different.</p>' +
        '<form class="s-form" data-form="scale" data-course="' + esc(c.id) + '"><div class="s-grid">' + scale + '</div><button class="btn small primary">Save scale</button></form>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="sec-head"><h2>Custom target</h2></div>' +
        '<form class="t-form" data-form="target" data-course="' + esc(c.id) + '"><label class="w-in big"><input type="text" inputmode="decimal" name="t" value="' + esc(fmt(an.target, 2)) + '" aria-label="Target percent"><em>%</em></label><button class="btn small primary">Set target</button></form>' +
        '<div class="sec-head mt"><h2>Hide class</h2></div>' +
        '<p class="muted small">Not a real class, like a club or advising page? Hide it from your dashboard.</p>' +
        '<button class="btn small ghost" data-action="hide" data-course="' + esc(c.id) + '">Hide this class</button>' +
      '</div>' +
    '</section>';
  }

  function viewSetup() {
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    var keys = mac ? '<kbd>⌘ Cmd</kbd><kbd>Shift</kbd><kbd>B</kbd>' : '<kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>B</kbd>';
    return '<section class="page setup">' +
      '<div class="page-head"><div><div class="eyebrow">One time, about a minute</div><h1>Set up one-click sync</h1>' +
        '<p class="lede">Cal Poly doesn\'t let students make Canvas access keys, so Par uses a bookmark instead. You click it while you\'re on Canvas, it reads your grades using the login you already have, and hands them to Par. Nothing goes to any server.</p></div></div>' +
      '<ol class="steps">' +
        '<li class="panel step"><div class="step-n display">1</div><div class="step-b"><h3>Show your bookmarks bar</h3>' +
          '<p>Press ' + keys + ' in Chrome. A thin bar appears under the address bar.</p>' +
          '<div class="viz viz-bar"><div class="vb-url"><span class="vb-dot"></span><span class="vb-dot"></span><span class="vb-dot"></span><span class="vb-addr mono">canvas.calpoly.edu</span></div><div class="vb-bar"><span class="vb-bm">Bookmarks bar</span></div></div></div></li>' +
        '<li class="panel step"><div class="step-n display">2</div><div class="step-b"><h3>Drag this button up to that bar</h3>' +
          '<p>Click and hold the button, drag it onto the bookmarks bar, and let go. Don\'t just click it.</p>' +
          '<div class="drag-zone"><a class="bookmarklet" id="bookmarklet" href="#" draggable="true" data-action="bm-click">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Sync Canvas</a>' +
            '<div class="drag-hint"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M2 20C12 20 20 14 30 4M30 4h-8M30 4v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Drag me up</div></div>' +
          '<p class="muted small">You should now see "Sync Canvas" on your bookmarks bar.</p></div></li>' +
        '<li class="panel step"><div class="step-n display">3</div><div class="step-b"><h3>Open Canvas and click it</h3>' +
          '<p>Go to <a class="linklike" href="' + esc(canvasHome()) + '" target="_blank" rel="noopener">' + esc(canvasHome().replace('https://', '')) + '</a>, log in, then click <b>Sync Canvas</b> on your bookmarks bar. Par opens in a new tab with your classes.</p>' +
          '<p class="muted small">New grade posted? Click it again any time. Your targets, weights and what-ifs are kept.</p></div></li>' +
      '</ol>' +
      '<div class="setup-grid">' +
        '<div class="panel" id="paste"><div class="sec-head"><h2>Paste sync data</h2></div>' +
          '<p class="muted small">Backup plan. If the sync says "Copied. Go to Par and click Paste sync data," paste it here.</p>' +
          '<form data-form="paste"><textarea id="pasteBox" rows="5" placeholder="Paste here (Cmd+V or Ctrl+V)" spellcheck="false"></textarea>' +
          '<div id="pasteMsg"></div><button class="btn primary">Load my classes</button></form></div>' +
        '<div class="panel"><div class="sec-head"><h2>No Canvas handy?</h2></div>' +
          '<p class="muted small">Explore Par with a sample student: four classes, a mix of on track, push, and out of reach.</p>' +
          '<button class="btn" data-action="load-sample">Try with sample data</button>' +
          (state.store.data ? '<div class="sec-head mt"><h2>Start over</h2></div><p class="muted small">Delete all classes and settings from this browser.</p><button class="btn ghost danger" data-action="clear-all">Clear everything</button>' : '') +
        '</div>' +
      '</div>' +
    '</section>';
  }

  // ---------- Top bar, banner, rendering ----------
  function renderTop() {
    var d = state.store.data;
    var tr = $('#topRight');
    if (!d) {
      tr.innerHTML = '<button class="btn small ghost hide-sm" data-action="load-sample">Try the demo</button><a class="btn small primary" href="#/setup">Get started</a>';
      return;
    }
    tr.innerHTML = '<span class="synced mono"><span class="dotlive"></span>' + (d.sample ? 'Sample data' : 'Synced ' + ago(d.syncedAt)) + '</span>' +
      '<button class="btn small primary" data-action="sync-help">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Sync</button>';
  }

  function renderBanner() {
    var b = $('#banner');
    var html = '';
    if (state.store.data && state.store.data.sample) {
      html += '<div class="wrap"><div class="banner"><span><b>Sample data.</b> This is a made-up student so you can try Par. Nothing here is real.</span>' +
        '<span class="banner-btns"><a class="btn small primary" href="#/setup">Sync my Canvas</a><button class="btn small ghost" data-action="clear-sample">Clear sample data</button></span></div></div>';
    }
    if (!state.storageOk) {
      html += '<div class="wrap"><div class="banner warn"><span><b>Heads up:</b> your browser is blocking storage, so Par will forget your classes when you close this tab. Private windows often do this.</span></div></div>';
    }
    b.innerHTML = html;
  }

  function route() {
    var h = (location.hash || '').replace(/^#/, '');
    if (h === 'sync') return { name: 'home' };
    var m = h.match(/^\/class\/(.+)$/);
    if (m) { var id; try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; } return { name: 'class', id: id }; }
    if (h === '/next') return { name: 'next' };
    if (h === '/setup') return { name: 'setup' };
    return { name: 'home' };
  }

  var lastRoute = '';
  function render(opts) {
    opts = opts || {};
    var r = route();
    var app = $('#app');
    var focusId = document.activeElement && document.activeElement.id;
    var sel = null;
    try { if (focusId && document.activeElement.selectionStart != null) sel = [document.activeElement.selectionStart, document.activeElement.selectionEnd]; } catch (e) {}
    var routeKey = r.name + ':' + (r.id || '');
    var changed = routeKey !== lastRoute;
    lastRoute = routeKey;

    var hasData = !!state.store.data;
    var html;
    try {
      if (r.name === 'setup') html = viewSetup();
      else if (!hasData) html = viewWelcome();
      else if (r.name === 'next') html = viewNext();
      else if (r.name === 'class') html = viewClass(r.id);
      else html = viewHome();
    } catch (err) {
      html = '<section class="page"><div class="card empty"><h3>Something went wrong showing this page.</h3><p>Your data is safe. Try going back to the dashboard. If it keeps happening, copy the details and send them to the person who built this.</p>' +
        '<div class="cta-row"><a class="btn" href="#/">Dashboard</a><button class="btn ghost" data-action="copy-error" data-details="' + esc(errorDetails('Render failed', err && err.stack)) + '">Copy error details</button></div></div></section>';
    }
    document.body.classList.toggle('no-data', !hasData);
    app.innerHTML = html;
    $$('#tabs a').forEach(function (a) {
      var on = a.getAttribute('data-tab') === (r.name === 'class' ? 'home' : r.name);
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderTop();
    renderBanner();
    if (r.name === 'setup') wireBookmarklet();
    if (changed && !opts.keepScroll) window.scrollTo(0, 0);

    if (focusId && !changed) {
      var el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {}
      }
    }
    runAnimations();
  }

  function runAnimations() {
    var animate = state.animate && !reduceMotion;
    state.animate = false;
    if (!animate) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $$('.ring-arc').forEach(function (el) { el.style.strokeDashoffset = el.getAttribute('data-off'); });
      });
    });
    var els = $$('[data-count]');
    var start = performance.now(), dur = 1100;
    function frame(t) {
      var k = Math.min(1, (t - start) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      els.forEach(function (el) {
        var v = parseFloat(el.getAttribute('data-count'));
        var d = parseInt(el.getAttribute('data-dec'), 10) || 0;
        el.textContent = (v * e).toFixed(d) + (el.getAttribute('data-suffix') || '');
      });
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (state.shimmer) setTimeout(function () {
      state.shimmer = false;
      $$('.shimmer').forEach(function (el) { el.classList.remove('shimmer'); });
    }, 1400);
  }

  function wireBookmarklet() {
    var a = $('#bookmarklet');
    if (!a) return;
    var src = window.PAR_BOOKMARKLET_SOURCE;
    if (!src) { a.classList.add('broken'); return; }
    var parUrl = location.origin + location.pathname.replace(/index\.html$/, '');
    a.href = 'javascript:' + encodeURIComponent(src.replace('__PAR_URL__', parUrl));
  }

  // ---------- Modals and popovers ----------
  function closeLayer() {
    $('#layer').innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeLayer(); }

  function modal(html, opts) {
    opts = opts || {};
    $('#layer').innerHTML = '<div class="scrim' + (opts.locked ? ' locked' : '') + '" data-action="' + (opts.locked ? '' : 'close-layer') + '"></div>' +
      '<div class="modal panel" role="dialog" aria-modal="true">' + html + '</div>';
    if (!opts.locked) document.addEventListener('keydown', escClose);
    var f = $('#layer .modal [data-autofocus]') || $('#layer .modal button');
    if (f) f.focus();
  }

  function openTargetPicker(btn) {
    var id = btn.getAttribute('data-course');
    var c = findCourse(id);
    if (!c) return;
    var an = Par.analyze(c, pref(id));
    var rect = btn.getBoundingClientRect();
    var opts = an.scale.map(function (s) {
      var probe = Par.analyze(c, Object.assign({}, pref(id), { target: s.min }));
      var tag = probe.state === 'out' ? 'Out of reach' : probe.state === 'locked' ? 'Locked in' : probe.state === 'done' ? (probe.status === 'locked' ? 'Got it' : 'Missed') : fmtPct(probe.p * 100) + ' needed';
      return '<button class="pk-opt' + (Math.abs(s.min - an.target) < 1e-9 ? ' on' : '') + ' s-' + STATUS[probe.status].cls + '" data-action="set-target" data-course="' + esc(id) + '" data-value="' + s.min + '">' +
        '<span class="pk-l display">' + esc(s.letter) + '</span><span class="pk-m mono">' + fmt(s.min, 2) + '%+</span><span class="pk-t">' + tag + '</span></button>';
    }).join('');
    $('#layer').innerHTML = '<div class="scrim clear" data-action="close-layer"></div><div class="picker panel" role="menu">' +
      '<div class="pk-h">Target grade for ' + esc(c.code || c.name) + '</div><div class="pk-list">' + opts + '</div></div>';
    var pk = $('#layer .picker');
    var w = Math.min(300, window.innerWidth - 24);
    pk.style.width = w + 'px';
    var left = Math.min(Math.max(12, rect.left), window.innerWidth - w - 12);
    var below = window.innerHeight - rect.bottom;
    pk.style.left = left + 'px';
    if (below > 380 || below > rect.top) { pk.style.top = (rect.bottom + 8) + 'px'; pk.style.maxHeight = (below - 20) + 'px'; }
    else { pk.style.bottom = (window.innerHeight - rect.top + 8) + 'px'; pk.style.maxHeight = (rect.top - 20) + 'px'; }
    document.addEventListener('keydown', escClose);
    var on = $('.pk-opt.on', pk) || $('.pk-opt', pk);
    if (on) on.focus();
  }

  function syncHelp() {
    var d = state.store.data;
    var sample = d && d.sample;
    modal('<h2>Sync with Canvas</h2>' +
      (sample ? '<p>You\'re looking at sample data. To see your real classes, set up the Sync Canvas bookmark. It takes about a minute.</p>' +
        '<div class="cta-row"><a class="btn primary" href="#/setup" data-action="close-layer">Set up sync</a><button class="btn ghost" data-action="close-layer">Not now</button></div>' :
      '<ol class="mini-steps"><li>Go to your Canvas tab (or open it below).</li><li>Click <b>Sync Canvas</b> on your bookmarks bar.</li><li>Par opens with fresh numbers. Your targets, weights and what-ifs stay.</li></ol>' +
        '<div class="cta-row"><a class="btn primary" href="' + esc(canvasHome()) + '" target="_blank" rel="noopener" data-autofocus>Open Canvas</a><a class="btn" href="#/setup" data-action="close-layer">I need the bookmark</a></div>' +
        '<p class="muted small">Last synced ' + esc(ago(d.syncedAt)) + '.</p>'));
  }

  // ---------- Loading data ----------
  function applyData(data, opts) {
    opts = opts || {};
    var incoming = Par.normalizePayload(data);
    if (!incoming.sample && state.store.data && state.store.data.sample) clearSamplePrefs();
    state.store.data = incoming;
    if (opts.targets) Object.keys(opts.targets).forEach(function (id) { pref(id).target = opts.targets[id]; });
    save();
    state.animate = true;
    state.shimmer = true;
    return incoming;
  }

  function clearSamplePrefs() {
    Object.keys(state.store.prefs).forEach(function (k) { if (/^sample-/.test(k)) delete state.store.prefs[k]; });
  }

  function loadSample() {
    var s = Par.sampleData();
    clearSamplePrefs();
    applyData(s.data, { targets: s.targets });
    closeLayer();
    if (location.hash === '#/' || location.hash === '' ) render(); else location.hash = '#/';
    toast('Sample student loaded. Tap a target grade to play with it.');
  }

  // ---------- Receiving data from the bookmarklet ----------
  function looksLikeCanvasOrigin(origin) {
    var u;
    try { u = new URL(origin); } catch (e) { return false; }
    var localPar = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (localPar && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return true;
    if (u.protocol !== 'https:') return false;
    return /(^|\.)instructure\.com$/i.test(u.hostname) || /canvas/i.test(u.hostname);
  }

  var syncSession = null;
  function startSyncSession() {
    if (!window.opener) {
      history.replaceState(null, '', location.pathname + location.search + '#/');
      return;
    }
    syncSession = { got: false, started: Date.now() };
    showSyncModal('Waiting for Canvas...', 'Reading your classes from Canvas. Keep this tab open.', null);
    var ping = function () {
      if (!syncSession || syncSession.got) return;
      try { window.opener && window.opener.postMessage({ type: 'par-ready' }, '*'); } catch (e) {}
      if (Date.now() - syncSession.started > 45000) {
        syncFailed('Par didn\'t hear back from Canvas.', 'Go back to your Canvas tab and click Sync Canvas again. If it keeps happening, use the Paste sync data box on the Setup page.');
        return;
      }
      setTimeout(ping, 400);
    };
    ping();
  }

  function showSyncModal(title, sub, progress) {
    var pct = progress && progress.total ? Math.round(progress.done / progress.total * 100) : null;
    var html = '<div class="sync-modal"><div class="sync-ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="sr-track"/><circle cx="32" cy="32" r="26" class="sr-arc" style="stroke-dashoffset:' +
      (pct == null ? 120 : (163.4 * (1 - pct / 100)).toFixed(1)) + '"/></svg></div>' +
      '<h2>' + esc(title) + '</h2><p class="muted" id="syncSub">' + esc(sub) + '</p></div>';
    if (!$('#layer .sync-modal')) modal(html, { locked: true });
    else $('#layer .modal').innerHTML = html;
    if (pct == null) $('#layer .sync-ring').classList.add('spin');
  }

  function syncFailed(message, fix, details) {
    if (syncSession) syncSession.got = true;
    var full = errorDetails(message, details);
    modal('<h2>Sync didn\'t finish</h2><p><b>' + esc(message) + '</b></p><p class="muted">' + esc(fix) + '</p>' +
      '<div class="cta-row"><a class="btn primary" href="#/setup" data-action="close-layer">Open Setup</a><button class="btn" data-action="copy-error" data-details="' + esc(full) + '">Copy error details</button><button class="btn ghost" data-action="close-layer">Close</button></div>');
    history.replaceState(null, '', location.pathname + location.search + '#/');
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string' || d.type.indexOf('par-') !== 0) return;
    if (d.type === 'par-ready' || d.type === 'par-received' || d.type === 'par-rejected') return;
    if (!looksLikeCanvasOrigin(e.origin)) {
      try { e.source && e.source.postMessage({ type: 'par-rejected' }, e.origin); } catch (err) {}
      return;
    }
    if (d.type === 'par-progress') {
      if (!syncSession || syncSession.got) return;
      syncSession.started = Date.now();
      showSyncModal('Par is syncing your classes...', d.total ? d.done + ' of ' + d.total + ' classes loaded' : 'Finding your classes',
        d.total ? { done: d.done, total: d.total } : null);
    } else if (d.type === 'par-error') {
      syncFailed(typeof d.message === 'string' ? d.message.slice(0, 300) : 'Canvas sync failed.', 'Fix that, then click Sync Canvas on your Canvas tab again.', typeof d.details === 'string' ? d.details.slice(0, 4000) : '');
    } else if (d.type === 'par-sync') {
      var data;
      try {
        if (!d.payload || d.payload.origin !== e.origin) throw new Error('Origin mismatch');
        data = applyData(d.payload);
      } catch (err) {
        try { e.source.postMessage({ type: 'par-rejected' }, e.origin); } catch (x) {}
        syncFailed(err && err.friendly ? err.message : 'The data from Canvas didn\'t look right.', 'Try syncing again from your Canvas tab.', err && err.stack);
        return;
      }
      if (syncSession) syncSession.got = true;
      try { e.source.postMessage({ type: 'par-received' }, e.origin); } catch (x) {}
      var n = data.courses.length;
      showSyncModal('Synced ' + n + ' class' + (n === 1 ? '' : 'es'), 'Updating your par scores...', { done: 1, total: 1 });
      $('#layer .sync-modal').classList.add('done');
      setTimeout(function () {
        closeLayer();
        history.replaceState(null, '', location.pathname + location.search + '#/');
        state.animate = true; state.shimmer = true;
        render();
        toast('Synced ' + n + ' class' + (n === 1 ? '' : 'es') + ' from Canvas.', 'ok');
      }, 900);
    }
  });

  // ---------- Clicks and forms ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) {
      var card = e.target.closest('[data-href]');
      if (card) location.hash = card.getAttribute('data-href');
      return;
    }
    var act = t.getAttribute('data-action');
    var id = t.getAttribute('data-course');
    switch (act) {
      case 'close-layer': closeLayer(); break;
      case 'load-sample': e.preventDefault(); loadSample(); break;
      case 'clear-sample':
        clearSamplePrefs(); state.store.data = null; save(); closeLayer();
        location.hash = '#/'; render(); toast('Sample data cleared.'); break;
      case 'clear-all':
        if (confirm('Delete all your classes and settings from this browser? You can sync again any time.')) {
          state.store = { data: null, prefs: {} }; save(); location.hash = '#/'; render(); toast('Everything cleared.');
        }
        break;
      case 'pick-target': e.stopPropagation(); openTargetPicker(t); break;
      case 'set-target': {
        var v = parseFloat(t.getAttribute('data-value'));
        if (isNum(v) && findCourse(id)) { pref(id).target = v; save(); }
        closeLayer(); render({ keepScroll: true }); break;
      }
      case 'sync-help': syncHelp(); break;
      case 'filter': state.classFilter = id || null; render({ keepScroll: true }); break;
      case 'clear-whatif': pref(id).predictions = {}; save(); render({ keepScroll: true }); toast('What-if scores cleared.'); break;
      case 'reset-weights': delete pref(id).weights; delete pref(id).weighted; delete pref(id).sylApplied; save(); render({ keepScroll: true }); toast('Weights reset to what Canvas has.'); break;
      case 'reset-scale': delete pref(id).scale; save(); render({ keepScroll: true }); toast('Letter scale reset.'); break;
      case 'hide': pref(id).hidden = true; save(); location.hash = '#/'; toast('Class hidden. Show it again from the dashboard.'); break;
      case 'unhide-all': courses().forEach(function (c) { delete pref(c.id).hidden; }); save(); render(); break;
      case 'copy-error':
        copyText(t.getAttribute('data-details') || '').then(function (ok) { toast(ok ? 'Error details copied. Paste them to whoever is helping you.' : 'Could not copy. Select the text and copy it by hand.'); });
        break;
      case 'syl-read': {
        var ta = document.getElementById('syl-' + id);
        readSyllabus(id, ta ? ta.value : '');
        break;
      }
      case 'scroll-to': {
        var el = document.getElementById(t.getAttribute('data-target'));
        if (el) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        break;
      }
      case 'syl-cancel': delete state.syl[id]; render({ keepScroll: true }); break;
      case 'bm-click':
        e.preventDefault();
        toast('Drag this button to your bookmarks bar instead of clicking it.');
        break;
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-href]')) {
      e.preventDefault(); location.hash = e.target.getAttribute('data-href');
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-syl-file')) { handleSyllabusFile(t); return; }
    if (t.getAttribute('data-action') === 'toggle-weights') {
      var p = pref(t.getAttribute('data-course'));
      p.weighted = t.checked;
      save(); render({ keepScroll: true });
      toast(t.checked ? 'Weights are on for this class.' : 'Weights are off. Using plain points.');
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-syl-weight')) {
      var d = state.syl[t.getAttribute('data-course')];
      var gid = t.getAttribute('data-syl-weight');
      if (d && d.rows) { d.rows[gid] = d.rows[gid] || { value: 0 }; d.rows[gid].value = parseFloat(t.value) || 0; }
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-syl-text')) {
      var sp = pref(t.getAttribute('data-syl-text'));
      sp.syllabus = t.value.slice(0, 60000);
      save();
      return;
    }
    if (t.getAttribute('data-action') !== 'whatif') return;
    var id = t.getAttribute('data-course'), aid = t.getAttribute('data-aid');
    var pts = parseFloat(t.getAttribute('data-pts'));
    var raw = t.value.trim();
    var p = pref(id);
    if (raw === '') delete p.predictions[aid];
    else {
      var v = parseFloat(raw);
      if (!/^\d*\.?\d*$/.test(raw) || !isNum(v)) { t.classList.add('bad'); return; }
      if (v > pts * 2) { t.classList.add('bad'); toast('That\'s more than double the points possible. Check the number.'); return; }
      p.predictions[aid] = v;
    }
    t.classList.remove('bad');
    save();
    render({ keepScroll: true });
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    var kind = f.getAttribute('data-form');
    if (!kind) return;
    e.preventDefault();
    var id = f.getAttribute('data-course');
    if (kind === 'paste') {
      var box = $('#pasteBox'), msg = $('#pasteMsg');
      try {
        var data = applyData(box.value);
        box.value = '';
        location.hash = '#/';
        toast('Loaded ' + data.courses.length + ' class' + (data.courses.length === 1 ? '' : 'es') + '.', 'ok');
      } catch (err) {
        var text = err && err.friendly ? err.message : 'Something went wrong reading that. Try syncing again.';
        msg.innerHTML = '<div class="notice warn">' + esc(text) + ' <button type="button" class="linklike" data-action="copy-error" data-details="' + esc(errorDetails(text, err && err.stack)) + '">Copy error details</button></div>';
      }
    } else if (kind === 'weights') {
      var w = {}, bad = false;
      $$('[data-weight]', f).forEach(function (inp) {
        var v = parseFloat(inp.value);
        if (inp.value.trim() === '') v = 0;
        if (!isNum(v) || v < 0 || v > 1000) { bad = true; inp.classList.add('bad'); } else w[inp.getAttribute('data-weight')] = v;
      });
      if (bad) { toast('Weights need to be numbers like 20 or 12.5.'); return; }
      var p = pref(id);
      p.weights = w; p.weighted = true; save(); render({ keepScroll: true });
      toast('Weights saved and turned on.', 'ok');
    } else if (kind === 'scale') {
      var scale = [], badS = false;
      $$('[data-scale]', f).forEach(function (inp) {
        var v = parseFloat(inp.value);
        if (!isNum(v) || v < 0 || v > 200) { badS = true; inp.classList.add('bad'); } else scale.push({ letter: inp.getAttribute('data-letter'), min: v });
      });
      if (badS) { toast('Each letter needs a number, like 93.'); return; }
      pref(id).scale = scale; save(); render({ keepScroll: true }); toast('Letter scale saved.', 'ok');
    } else if (kind === 'syl-apply') {
      var sw = {}, sbad = false;
      $$('[data-syl-weight]', f).forEach(function (inp) {
        var v = inp.value.trim() === '' ? 0 : parseFloat(inp.value);
        if (!isNum(v) || v < 0 || v > 1000) { sbad = true; inp.classList.add('bad'); } else sw[inp.getAttribute('data-syl-weight')] = v;
      });
      if (sbad) { toast('Weights need to be numbers like 20 or 12.5.'); return; }
      var sp2 = pref(id);
      sp2.weights = sw; sp2.weighted = true; sp2.sylApplied = true;
      var draft = state.syl[id];
      var useScale = f.querySelector('input[name="scale"]');
      if (draft && draft.scale.length && useScale && useScale.checked) {
        var merged = {};
        (Par.validScale(sp2.scale) || Par.DEFAULT_SCALE).forEach(function (x) { merged[x.letter] = x.min; });
        draft.scale.forEach(function (x) { merged[x.letter] = x.min; });
        sp2.scale = Object.keys(merged).map(function (k) { return { letter: k, min: merged[k] }; }).sort(function (a, b) { return b.min - a.min; });
      }
      delete state.syl[id];
      save();
      state.animate = true;
      render({ keepScroll: true });
      toast('Using your syllabus weights for this class.', 'ok');
    } else if (kind === 'target') {
      var tv = parseFloat(f.querySelector('input').value);
      if (!isNum(tv) || tv <= 0 || tv > 150) { toast('Type a target like 90 or 87.5.'); return; }
      pref(id).target = tv; save(); render({ keepScroll: true }); toast('Target set to ' + fmt(tv, 2) + '%.', 'ok');
    }
  });

  window.addEventListener('hashchange', function () {
    if (location.hash === '#sync') { render(); startSyncSession(); return; }
    closeLayer(); render();
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) { load(); render({ keepScroll: true }); } });
  setInterval(renderTop, 60000);

  // ---------- Start ----------
  load();
  render();
  if (location.hash === '#sync') startSyncSession();
})();
