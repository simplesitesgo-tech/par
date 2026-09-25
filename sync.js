// Par "Sync Canvas" bookmarklet source.
// build-bookmarklet.js turns this file into the draggable link on the Setup screen.
// Only lines that start with // are removed when building, so never put comments after code.
(function () {
  var PAR_URL = '__PAR_URL__';
  var PAR_ORIGIN = new URL(PAR_URL).origin;
  var FORMAT = 1;

  var step = 'starting';
  var host, box;
  if (!window.__parSyncRunning) {
    var old = document.getElementById('par-sync-overlay');
    if (old) old.remove();
  }

  // ---------- Small floating overlay on the Canvas page ----------
  function overlay(title, detail, buttons, tone) {
    if (!host) {
      host = document.createElement('div');
      host.id = 'par-sync-overlay';
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var st = document.createElement('style');
      st.textContent =
        '.b{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0A0F1A;color:#E8ECF4;' +
        'border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:16px 18px;width:320px;box-shadow:0 20px 50px rgba(0,0,0,.45)}' +
        '.h{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px}' +
        '.dot{width:10px;height:10px;border-radius:50%;background:#C6FF3D;flex:none}' +
        '.bad .dot{background:#F87171}.ok .dot{background:#34D399}' +
        '.busy .dot{animation:p 1s ease-in-out infinite}@keyframes p{50%{opacity:.25}}' +
        '.d{color:#9AA4B8;margin-top:6px;white-space:pre-line}' +
        '.r{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}' +
        'button{font:600 13px/1 inherit;font-family:inherit;border-radius:999px;padding:9px 14px;cursor:pointer;border:1px solid rgba(255,255,255,.18);background:transparent;color:#E8ECF4}' +
        'button.p{background:#C6FF3D;color:#0A0F1A;border-color:#C6FF3D}' +
        'button:hover{filter:brightness(1.1)}';
      root.appendChild(st);
      box = document.createElement('div');
      root.appendChild(box);
      document.body.appendChild(host);
    }
    box.className = 'b ' + (tone || 'busy');
    box.innerHTML = '';
    var h = document.createElement('div');
    h.className = 'h';
    h.innerHTML = '<span class="dot"></span>';
    h.appendChild(document.createTextNode(title));
    box.appendChild(h);
    if (detail) {
      var d = document.createElement('div');
      d.className = 'd';
      d.textContent = detail;
      box.appendChild(d);
    }
    var row = document.createElement('div');
    row.className = 'r';
    (buttons || []).forEach(function (b) {
      var el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.className = 'p';
      el.onclick = function () { b.onClick(el); };
      row.appendChild(el);
    });
    row.appendChild(closeButton());
    box.appendChild(row);
  }

  function closeButton() {
    var el = document.createElement('button');
    el.textContent = 'Close';
    el.onclick = function () {
      if (host) host.remove();
      host = null;
      window.__parSyncRunning = false;
    };
    return el;
  }

  function copyText(text) {
    var ok = false;
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch (e) {}
    if (!ok && navigator.clipboard) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(ok);
  }

  function copyButton(label, text) {
    return {
      label: label,
      primary: true,
      onClick: function (el) {
        copyText(text).then(function (ok) {
          el.textContent = ok ? 'Copied!' : 'Copy failed, try again';
        });
      }
    };
  }

  function showError(message, err) {
    var details = [
      'Par sync error',
      'What happened: ' + message,
      'Step: ' + step,
      'Page: ' + location.origin + location.pathname,
      'Time: ' + new Date().toString(),
      'Browser: ' + navigator.userAgent,
      'Technical: ' + (err && (err.stack || err.message || String(err)) || 'none')
    ].join('\n');
    overlay('Sync did not work', message, [copyButton('Copy error details', details)], 'bad');
    post({ type: 'par-error', message: message, details: details });
  }

  // ---------- Not on Canvas? ----------
  function looksLikeCanvas() {
    if (location.origin === PAR_ORIGIN) return false;
    if (/canvas|instructure/i.test(location.hostname)) return true;
    return !!(window.ENV && (window.INST || document.getElementById('application')));
  }

  if (!looksLikeCanvas()) {
    overlay('Open Canvas first, then click Sync Canvas.',
      'This button only works on a Canvas page where you are logged in, like canvas.calpoly.edu.', [], 'bad');
    return;
  }

  if (window.__parSyncRunning) return;
  window.__parSyncRunning = true;

  // ---------- Open Par right away, while the click still counts (so popup blockers allow it) ----------
  var win = null;
  try { win = window.open(PAR_URL + '#sync', 'par-app'); } catch (e) { win = null; }

  var parReady = false;
  var payload = null;
  var delivered = false;

  function post(msg) {
    if (!win || win.closed) return;
    try { win.postMessage(msg, PAR_ORIGIN); } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== PAR_ORIGIN || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'par-ready') {
      parReady = true;
      trySend();
    } else if (e.data.type === 'par-received') {
      delivered = true;
      var n = payload ? payload.courses.length : 0;
      overlay('Synced ' + n + ' class' + (n === 1 ? '' : 'es') + '.', 'Your grades are in the Par tab. Nothing was sent to any server.', [], 'ok');
      window.__parSyncRunning = false;
      setTimeout(function () { if (host) host.remove(); host = null; }, 6000);
    } else if (e.data.type === 'par-rejected') {
      fallback('Par could not accept the data automatically.');
    }
  });

  function trySend() {
    if (parReady && payload && !delivered) post({ type: 'par-sync', payload: payload });
  }

  function fallback(reason) {
    if (delivered) return;
    window.__parSyncRunning = false;
    var text = JSON.stringify(payload);
    copyText(text).then(function (ok) {
      overlay(ok ? 'Copied. Go to Par and click Paste sync data.' : 'Almost done. Copy your data, then paste it in Par.',
        reason + '\nOpen Par, go to Setup, click "Paste sync data", and paste.',
        [copyButton(ok ? 'Copy again' : 'Copy sync data', text), {
          label: 'Open Par',
          onClick: function () { window.open(PAR_URL + '#/setup', '_blank'); }
        }], ok ? 'ok' : 'busy');
    });
  }

  // ---------- Talking to the Canvas API with your existing login ----------
  function friendly(msg) { var e = new Error(msg); e.friendly = true; return e; }

  function nextLink(header) {
    if (!header) return null;
    var parts = header.split(',');
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/<([^>]+)>\s*;\s*rel="?next"?/);
      if (m) return m[1];
    }
    return null;
  }

  function getPage(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      if (r.status === 401) throw friendly('Canvas says you are not logged in. Log in to Canvas, then click Sync Canvas again.');
      if (!r.ok) {
        var err = friendly('Canvas returned an error (code ' + r.status + ').');
        err.status = r.status;
        throw err;
      }
      return r.text().then(function (t) {
        var json;
        try { json = JSON.parse(t.replace(/^\s*while\(1\);/, '')); } catch (e) {
          throw friendly('Canvas sent back something Par could not read. Make sure you are logged in and try again.');
        }
        return { json: json, next: nextLink(r.headers.get('Link')) };
      });
    });
  }

  function getAll(url) {
    var out = [];
    var pages = 0;
    function go(u) {
      return getPage(u).then(function (res) {
        pages++;
        out = out.concat(Array.isArray(res.json) ? res.json : []);
        return res.next && pages < 50 ? go(res.next) : out;
      });
    }
    return go(url);
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function slimCourse(c) {
    var enr = (c.enrollments || []).filter(function (e) { return /student/i.test(e.type || e.role || ''); })[0] || (c.enrollments || [])[0] || {};
    return {
      id: c.id,
      name: c.name || c.course_code || ('Course ' + c.id),
      code: c.course_code || '',
      weighted: !!c.apply_assignment_group_weights,
      canvasScore: num(enr.computed_current_score),
      canvasGrade: enr.computed_current_grade || null,
      groups: []
    };
  }

  function slimGroups(groups) {
    return groups.map(function (g) {
      return {
        id: g.id,
        name: g.name || 'Assignments',
        weight: num(g.group_weight),
        rules: g.rules || {},
        assignments: (g.assignments || []).map(function (a) {
          var s = a.submission || {};
          return {
            id: a.id,
            name: a.name || 'Untitled',
            pts: num(a.points_possible),
            due: a.due_at || null,
            omit: !!a.omit_from_final_grade,
            score: num(s.score),
            excused: !!s.excused,
            state: s.workflow_state || null
          };
        })
      };
    });
  }

  var base = location.origin + '/api/v1';
  overlay('Par is syncing your classes...', 'Finding your classes', []);
  post({ type: 'par-progress', done: 0, total: 0 });

  step = 'loading classes';
  getAll(base + '/users/self/courses?enrollment_state=active&include[]=total_scores&per_page=100')
    .then(function (courses) {
      courses = courses.filter(function (c) { return c && c.id && !c.access_restricted_by_date; });
      var asStudent = courses.filter(function (c) {
        return (c.enrollments || []).some(function (e) { return /student/i.test(e.type || e.role || ''); });
      });
      if (asStudent.length) courses = asStudent;
      if (!courses.length) throw friendly('Canvas did not list any active classes for you. If that seems wrong, open your Canvas Dashboard and try again.');

      step = 'loading assignments';
      var total = courses.length;
      var done = 0;
      function tick() {
        overlay('Par is syncing your classes...', done + ' of ' + total + ' classes loaded', []);
        post({ type: 'par-progress', done: done, total: total });
      }
      tick();
      return Promise.all(courses.map(function (c) {
        var slim = slimCourse(c);
        return getAll(base + '/courses/' + c.id + '/assignment_groups?include[]=assignments&include[]=submission&per_page=100')
          .then(function (groups) { slim.groups = slimGroups(groups); }, function (err) {
            slim.error = err && err.status ? 'Canvas blocked assignments for this class (code ' + err.status + ').' : 'Could not load assignments for this class.';
          })
          .then(function () { done++; tick(); return slim; });
      }));
    })
    .then(function (courses) {
      step = 'sending to Par';
      payload = { par: FORMAT, origin: location.origin, syncedAt: new Date().toISOString(), courses: courses };
      var n = courses.length;
      overlay('Synced ' + n + ' class' + (n === 1 ? '' : 'es') + '.', 'Sending to Par...', []);
      if (!win || win.closed) {
        fallback('Your browser blocked the Par tab from opening.');
        return;
      }
      trySend();
      setTimeout(function () {
        if (!delivered) fallback(parReady ? 'Par did not confirm it got the data.' : 'Par did not answer.');
      }, 12000);
    })
    .catch(function (err) {
      window.__parSyncRunning = false;
      showError(err && err.friendly ? err.message : 'Something went wrong while talking to Canvas. Refresh the page and try again.', err);
    });
})();
