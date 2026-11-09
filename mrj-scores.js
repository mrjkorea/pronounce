/* MRJ score sheet — ONE book for every program (Jay 28SEP2026)
   Sheet: MRJ Classroom Metrics
   https://docs.google.com/spreadsheets/d/1bpgekxlektvwpsef1PmIkxPiDuHrkVXFaAy-OmwqL5c
   Nothing else. No tunnels. No per-app side sheet.
   Safe on file:// (posts use text/plain so Apps Script needs no CORS preflight).

   Client 2026-11-10-course-unit (Reg/Metrics):
   post() now passes courseName -> course_name, assignmentId -> assignment_id,
   unitId -> unit_id, lessonId -> lesson_id. The receiver writes any key that
   matches a header, so these four land in their own columns.
   unitTitle still has NO column in the sheet (receiver HEADERS): it is copied
   into metadata_json as unitTitle so the unit name is never lost.
*/
(function (root) {
  "use strict";

  /* Receiver 2026-11-10 (Reg/Metrics): two deployments are live. The old one
     (AKfycbwIBPz…) answers receiver_version 5.0.0 and rejects a bare site id_key
     in student_email with "invalid student_email". The current one (AKfycbx677…)
     answers 5.1.0 and accepts the id_key, so the book keeps the real student
     instead of "unknown". We use 5.1.0. An app can pin another endpoint by
     setting window.MRJ_SCORES_ENDPOINT before this file loads. */
  var ENDPOINT =
    (root && root.MRJ_SCORES_ENDPOINT) ||
    "https://script.google.com/macros/s/AKfycbx677Fg8Q0GpH13Fcrw9aRqsKt7Eo5i29dZRh5goDbTM3KpyYfs6HMJiIMYRx3sjvVG4A/exec";
  var SHEET_ID = "1bpgekxlektvwpsef1PmIkxPiDuHrkVXFaAy-OmwqL5c";

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /* One identity for one student. The same normalisation the book uses. */
  function idKey(s) {
    return String(s == null ? "" : s)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
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

  /* One finished item -> one row in ClassroomMetrics. */
  function post(opts) {
    opts = opts || {};
    var student = signedIn() || String(opts.student || "").trim();
    /* No student, no row: a score must never land as an orphan. */
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

    /* unit_title has no column in the sheet: keep the name in metadata instead. */
    var meta = {};
    for (var mk in opts.metadata || {}) {
      if (Object.prototype.hasOwnProperty.call(opts.metadata, mk)) meta[mk] = opts.metadata[mk];
    }
    if (opts.unitTitle && !meta.unitTitle) meta.unitTitle = opts.unitTitle;

    var body = {
      /* The site identity is a bare id_key (no @). Receiver 5.1.0 stores it as is;
         "unknown" is only for a post with no student at all. */
      student_email: (student.indexOf("@") > 0 ? student : key).slice(0, 320),
      student_name: student,
      session_id: [opts.program || "mrj", key, localDate(when)].join("-"),
      events: [
        {
          event_id: opts.eventId || uid(opts.program || "mrj"),
          event_kind: opts.eventKind || "learning_result",
          source: opts.source || "mrj-web",
          curriculum_program: opts.program || "unknown",
          app_name: opts.appName || opts.program || "MRJ",
          course_name: opts.courseName || "",
          assignment_id: opts.assignmentId || "",
          unit_id: opts.unitId || "",
          lesson_id: opts.lessonId || "",
          book_title: opts.bookTitle || "",
          /* Receiver 5.1.0 keeps only the columns it knows. unit_title has no
             column, so send it only when the app really set it. */
          unit_title: opts.unitTitle || undefined,
          item_id: itemId,
          item_type: opts.itemType || "activity",
          score_value: typeof opts.scoreValue === "number" ? opts.scoreValue : "",
          score_max: typeof opts.scoreMax === "number" ? opts.scoreMax : "",
          score_pct: pct,
          correctness: opts.correctness || "",
          /* Never invent a value the app did not set. A missing duration is
             omitted; the receiver writes 0 for an absent duration too, so the
             receiver must also learn to leave the cell empty. */
          completed: typeof opts.completed === "boolean" ? opts.completed : undefined,
          duration_seconds:
            typeof opts.durationSeconds === "number" ? opts.durationSeconds : undefined,
          local_date: localDate(when),
          /* Provenance for the book: how the student was identified. */
          identity_method: "mrj_signin",
          identity_confidence: "high",
          metadata_json: JSON.stringify(meta),
        },
      ],
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
      })
      .then(function (res) {
        /* Day 5 and the other page apps keep a local progress copy for the
           teacher view. Fire it only when the host app provides the hook, so
           the shared client stays safe everywhere else. */
        if (root.MRJ_AUTH && typeof root.MRJ_AUTH.noteScore === "function") {
          try {
            root.MRJ_AUTH.noteScore({
              program: opts.program || "mrj",
              itemId: itemId,
              scoreValue: typeof opts.scoreValue === "number" ? opts.scoreValue : "",
              scoreMax: typeof opts.scoreMax === "number" ? opts.scoreMax : "",
              scorePct: pct,
              localDate: localDate(when),
            });
          } catch (e) {}
        }
        return res;
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
})(window);
