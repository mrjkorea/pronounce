/* MRJ score sheet — ONE book for every program (Jay 28SEP2026)
   Sheet: MRJ Classroom Metrics
   https://docs.google.com/spreadsheets/d/1bpgekxlektvwpsef1PmIkxPiDuHrkVXFaAy-OmwqL5c
   Nothing else. No tunnels. No per-app side sheet.
   Safe on file:// (posts use text/plain so Apps Script needs no CORS preflight).
*/
(function (root) {
  "use strict";

  var ENDPOINT =
    "https://script.google.com/macros/s/AKfycbx677Fg8Q0GpH13Fcrw9aRqsKt7Eo5i29dZRh5goDbTM3KpyYfs6HMJiIMYRx3sjvVG4A/exec";
  var SHEET_ID = "1bpgekxlektvwpsef1PmIkxPiDuHrkVXFaAy-OmwqL5c";

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function localDate(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function uid(prefix) {
    return (
      (prefix || "mrj") +
      "-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function idKey(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function signedIn() {
    try {
      return root.MRJ_AUTH && root.MRJ_AUTH.student
        ? String(root.MRJ_AUTH.student() || "").trim()
        : "";
    } catch (e) {
      return "";
    }
  }

  /* One finished item -> one row in ClassroomMetrics. */
  function post(opts) {
    opts = opts || {};
    var student = signedIn() || String(opts.student || "").trim();
    if (!student) return Promise.resolve({ status: "skipped", error: "no student" });
    var key = idKey(student);
    var itemId = String(opts.itemId || uid("item"));
    var when = opts.when ? new Date(opts.when) : new Date();
    var pct =
      typeof opts.scorePct === "number"
        ? opts.scorePct
        : opts.scoreMax
          ? Math.round((Number(opts.scoreValue || 0) / Number(opts.scoreMax)) * 100)
          : "";

    var event = {
      event_id: opts.eventId || uid(opts.program || "mrj"),
      event_kind: opts.eventKind || "learning_result",
      source: opts.source || "mrj-web",
      curriculum_program: opts.program || "unknown",
      app_name: opts.appName || opts.program || "MRJ",
      book_title: opts.bookTitle || "",
      unit_title: opts.unitTitle || "",
      item_id: itemId,
      item_type: opts.itemType || "activity",
      score_value: typeof opts.scoreValue === "number" ? opts.scoreValue : "",
      score_max: typeof opts.scoreMax === "number" ? opts.scoreMax : "",
      score_pct: pct,
      correctness: opts.correctness || "",
      completed: opts.completed !== false,
      duration_seconds: opts.durationSeconds || "",
      local_date: localDate(when),
      identity_method: "mrj_signin",
      identity_confidence: "high",
      metadata_json: JSON.stringify(opts.metadata || {}),
    };

    var body = {
      student_email: student.indexOf("@") > 0 ? student : key,
      student_name: student,
      session_id: [opts.program || "mrj", key, localDate(when)].join("-"),
      events: [event],
    };

    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
    })
      .then(function (res) {
        return res.json().catch(function () {
          return { status: "sent, not confirmed" };
        });
      })
      .catch(function (err) {
        // offline: keep it on the device, flush later
        try {
          var q = JSON.parse(localStorage.getItem("mrj.score.queue") || "[]");
          q.push(body);
          localStorage.setItem("mrj.score.queue", JSON.stringify(q.slice(-200)));
        } catch (e) {}
        return { status: "queued", error: String(err && err.message) };
      });
  }

  function flush() {
    var q;
    try {
      q = JSON.parse(localStorage.getItem("mrj.score.queue") || "[]");
    } catch (e) {
      return Promise.resolve();
    }
    if (!q.length) return Promise.resolve();
    var keep = [];
    var chain = Promise.resolve();
    q.forEach(function (body) {
      chain = chain.then(function () {
        return fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(body),
          redirect: "follow",
        })
          .then(function (r) {
            if (!r.ok) keep.push(body);
          })
          .catch(function () {
            keep.push(body);
          });
      });
    });
    return chain.then(function () {
      try {
        localStorage.setItem("mrj.score.queue", JSON.stringify(keep));
      } catch (e) {}
    });
  }

  root.MRJ_SCORES = {
    ENDPOINT: ENDPOINT,
    SHEET_ID: SHEET_ID,
    SHEET_URL:
      "https://docs.google.com/spreadsheets/d/" +
      SHEET_ID +
      "/edit",
    post: post,
    flush: flush,
    uid: uid,
    localDate: localDate,
  };

  if (root.addEventListener) {
    root.addEventListener("online", function () {
      flush();
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
