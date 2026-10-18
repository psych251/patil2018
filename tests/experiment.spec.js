// End-to-end test: a robot participant runs the whole experiment.
//
// Two modes:
//   - Emulator mode (EMULATOR=1, set automatically by `npm test`): data must land in the
//     local Firestore emulator, the security rules must reject forbidden requests, and
//     client errors must be logged.
//   - Offline mode (plain `npx playwright test`): the experiment must still run to the end
//     and offer the JSON download fallback.
//
// If you change the timeline in experiment.js, update `runThroughExperiment` below so the
// robot still knows which buttons to press. That is a feature: the test documents the flow.

const { test, expect, devices } = require("@playwright/test");

const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-psych251";
const EXPERIMENT_ID = "patil2018-pilot-a";
const FS = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
// Test-only shrink: 8 images per category (4 studied, 4 new) at 0.3x speed, so a full run takes
// about half a minute. experiment.js honours these only on the emulator or localhost.
const FAST = "n=8&timescale=0.3";
const N_ENCODING_BLOCKS = 8;
const N_RETRIEVAL = 16;
const N_RETRIEVAL_BLOCKS = 4;
const WORD_KEYS = { ancient: "j", plain: "k", safe: "l" };

// Plays everything up to (not including) the debrief. The robot deliberately lets the first
// vividness rating and the first retrieval trial time out, and answers the second retrieval
// trial wrong, so the timed_out and item_correct fields are exercised.
async function runToDebrief(page) {
  // 1. consent (2. preload advances by itself)
  await page.getByRole("button", { name: "I agree to participate" }).click();
  // 3. welcome (two pages)
  await page.locator("#jspsych-instructions-next").click();
  await page.locator("#jspsych-instructions-next").click();
  // 4. demographics (SurveyJS)
  await page.locator('input[type="number"]').fill("34");
  await page.getByText("Woman", { exact: true }).click();
  // SurveyJS boolean switches render "Yes" twice once toggled; scope to the question.
  await page.locator('[data-name="native_english"]').getByText("Yes", { exact: true }).first().click();
  await page.locator('input[value="Continue"]').click();
  // 5. encoding: three instruction pages, then 8 blocks (break screen + 1 trial each at n=8)
  for (let i = 0; i < 3; i++) await page.locator("#jspsych-instructions-next").click();
  for (let b = 0; b < N_ENCODING_BLOCKS; b++) {
    await page.locator(".break-screen").waitFor({ state: "visible" });
    await page.keyboard.press(" ");
    await page.locator(".study-pair").waitFor({ state: "visible" });
    const rating = page.locator('[data-screen="vividness"]');
    await rating.waitFor({ state: "visible" });
    if (b > 0) await page.keyboard.press("h");
    await rating.waitFor({ state: "detached" });
  }
  // 6. retrieval: three instruction pages, then 4 blocks of 4 trials
  for (let i = 0; i < 3; i++) await page.locator("#jspsych-instructions-next").click();
  let t = 0;
  for (let b = 0; b < N_RETRIEVAL_BLOCKS; b++) {
    await page.locator(".break-screen").waitFor({ state: "visible" });
    await page.keyboard.press(" ");
    for (let j = 0; j < N_RETRIEVAL / N_RETRIEVAL_BLOCKS; j++, t++) {
      const stim = page.locator(".retrieval");
      await stim.waitFor({ state: "visible" });
      const isOld = (await stim.getAttribute("data-old")) === "true";
      const word = await stim.getAttribute("data-word");
      if (t === 1) await page.keyboard.press(isOld ? "d" : "f");           // wrong on purpose
      else if (t > 1) await page.keyboard.press(isOld ? WORD_KEYS[word] : "d");
      await stim.waitFor({ state: "detached" });
    }
  }
  // 7. post-study questions
  await page.locator('[data-name="strategy"] textarea').fill("Made up little stories.");
  await page.locator('[data-name="drowsiness"]').getByText("Not at all", { exact: true }).click();
  await page.locator('[data-name="prior_participation"]').getByText("No", { exact: true }).click();
  await page.locator('input[value="Continue"]').click();
  // 8. feedback
  await page.locator('input[name="Q0"][value="4"]').check();
  await page.locator("#jspsych-survey-likert-next").click();
  await page.locator("textarea").fill("Robot participant says hi.");
  await page.locator("#jspsych-survey-text-next").click();
}

async function runThroughExperiment(page) {
  await runToDebrief(page);
  // 9. debrief
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });
}

async function fsGet(path) {
  // "Bearer owner" is the emulator's admin token: it bypasses security rules, like the Admin SDK.
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

// Unwrap Firestore REST "fields" encoding into plain JS.
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decode(fields[k]);
  return out;
}

test.describe("experiment", () => {
  test("runs to the end and saves data", async ({ page }) => {
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(EMULATOR ? `/?emulator=1&chunk_size=1&PROLIFIC_PID=robot123&STUDY_ID=s1&SESSION_ID=sess1&${FAST}` : `/?${FAST}`);
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const mode = await page.evaluate(() => window.__saver.mode);
    expect(mode).toBe(EMULATOR ? "emulator" : "offline");

    await runToDebrief(page);
    // Simulate the participant leaving the tab and coming back, for the interaction log.
    await page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });

    // No uncaught errors from the experiment itself.
    expect(consoleErrors, "uncaught page errors").toEqual([]);

    const uid = await page.evaluate(() => window.__saver.docId);
    const stats = await page.evaluate(() => window.__saver.stats);

    if (!EMULATOR) {
      // Offline: banner + download fallback, nothing else to check.
      await expect(page.locator("#data-saver-banner")).toHaveAttribute("data-kind", "offline");
      await expect(page.locator("#data-saver-fallback")).toBeVisible();
      return;
    }

    expect(stats.writes_failed).toBe(0);
    await expect(page.locator("#data-saver-fallback")).toHaveCount(0);

    // Participant document is complete and carries the counterbalancing + Prolific ids.
    const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`);
    expect(p.status).toBe(200);
    const pdoc = decodeFields(p.body.fields);
    expect(pdoc.completed).toBe(true);
    expect(["scene", "object"]).toContain(pdoc.first_encoding_category);
    expect(["scene", "object"]).toContain(pdoc.first_retrieval_category);
    expect(pdoc.prolific_pid).toBe("robot123");
    expect(pdoc.n_trials).toBeGreaterThan(10);
    expect(typeof pdoc.full_data).toBe("string");
    // Browser interaction log (jsPsych's blur/focus/fullscreen events) is saved at the end.
    const interactions = JSON.parse(pdoc.interaction_data);
    expect(interactions.some((e) => e.event === "blur" && typeof e.trial === "number")).toBe(true);
    expect(pdoc.n_blur).toBeGreaterThanOrEqual(1);
    expect(pdoc.n_focus).toBeGreaterThanOrEqual(1);
    const full = JSON.parse(pdoc.full_data);
    expect(full.length).toBe(pdoc.n_trials);

    // One chunk per trial (chunk_size = 1), each carrying the trial data.
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    expect(chunks.status).toBe(200);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(pdoc.n_trials);
    const trials = docs.flatMap((d) => d.trials);
    // Encoding: 4 studied images per category, words balanced within category, one rating timed out.
    const enc = trials.filter((t) => t.task === "encoding").sort((a, b) => a.trial_index - b.trial_index);
    expect(enc.length).toBe(8);
    expect(enc.every((t) => ["ancient", "plain", "safe"].includes(t.studied_word))).toBe(true);
    expect(enc.map((t) => t.category)).toEqual(
      Array.from({ length: 8 }, (_, i) => (i % 2 === 0) === (pdoc.first_encoding_category === "scene") ? "scene" : "object"));
    const viv = trials.filter((t) => t.task === "vividness");
    expect(viv.length).toBe(8);
    expect(viv.filter((t) => t.timed_out).length).toBe(1);
    expect(viv.filter((t) => !t.timed_out).every((t) => t.vividness_rating === 1)).toBe(true);
    expect(trials.filter((t) => t.task === "fixation").length).toBe(0); // record_data: false

    // Retrieval: every image once, categories alternate, half old, preceding-trial fields filled.
    const ret = trials.filter((t) => t.task === "retrieval").sort((a, b) => a.retrieval_position - b.retrieval_position);
    expect(ret.length).toBe(N_RETRIEVAL);
    expect(new Set(ret.map((t) => t.image)).size).toBe(N_RETRIEVAL);
    expect(ret.filter((t) => t.is_old).length).toBe(N_RETRIEVAL / 2);
    for (let i = 1; i < ret.length; i++) expect(ret[i].category).not.toBe(ret[i - 1].category);
    expect(ret[0].category).toBe(pdoc.first_retrieval_category);
    const studiedImages = new Set(enc.map((t) => t.image));
    expect(ret.every((t) => t.is_old === studiedImages.has(t.image))).toBe(true);
    expect(ret[0].timed_out).toBe(true);
    expect(ret[0].item_correct).toBe(null);
    expect(ret[1].item_correct).toBe(false);
    expect(ret.slice(2).every((t) => t.item_correct === true)).toBe(true);
    expect(ret.slice(2).filter((t) => t.is_old).every((t) => t.assoc_correct === true)).toBe(true);
    expect(ret.filter((t) => !t.is_old).every((t) => t.assoc_correct === null)).toBe(true);
    for (const r of ret) {
      if (r.trial_in_block === 1) expect(r.prev_judgment).toBe(null);
      else {
        const prev = ret[r.retrieval_position - 2];
        expect(r.prev_judgment).toBe(prev.judgment);
        expect(r.prev_response_label).toBe(prev.response_label);
        expect(r.prev_is_old).toBe(prev.is_old);
      }
    }
    const post = trials.find((t) => t.task === "post_study");
    expect(post.response.drowsiness).toBe("Not at all");
    expect(post.response.prior_participation).toBe("No");
    const demo = trials.find((t) => t.task === "demographics");
    expect(demo.response.age).toBe(34);

    // Every trial row must carry the same participant id as its participant document,
    // otherwise trials.csv and participants.csv cannot be joined in the analysis.
    expect([...new Set(trials.map((t) => t.participant_id))]).toEqual([uid]);
  });

  test("chunked writes (chunk_size > 1) save every trial", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto(`/?emulator=1&chunk_size=5&${FAST}`);
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page);
    const uid = await page.evaluate(() => window.__saver.docId);
    const p = decodeFields((await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`)).body.fields);
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(Math.ceil(p.n_trials / 5));
    const indices = docs.flatMap((d) => d.trials).map((t) => t.trial_index).sort((a, b) => a - b);
    // Fixations are not recorded (record_data: false), so trial_index has gaps; compare with the
    // complete dataset instead of 0..n-1.
    const expected = JSON.parse(p.full_data).map((t) => t.trial_index).sort((a, b) => a - b);
    expect(indices).toEqual(expected);
    expect(indices.length).toBe(p.n_trials);
  });

  test("declining consent ends the study without a thank-you-for-your-data message", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I do not agree" }).click();
    await expect(page.getByText("You chose not to participate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  });

  test("losing the connection at the end offers the download fallback instead of hanging", async ({ page, context }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);
    // Run the real flow up to the last click, then cut the connection before "Finish".
    await page.goto(`/?emulator=1&${FAST}`);
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runToDebrief(page);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("#data-saver-fallback")).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("connection to the server was lost")).toBeVisible();
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("a second run in the same browser is a new participant and saves cleanly", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);

    const ids = [];
    for (let run = 0; run < 2; run++) {
      // Same page/context both times: the anonymous auth session persists, exactly as it
      // does for a student testing twice in one browser or a participant who reloads.
      await page.goto(`/?emulator=1&chunk_size=1&${FAST}&PROLIFIC_PID=rerun` + run);
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      await runThroughExperiment(page);
      const info = await page.evaluate(() => ({
        uid: window.__saver.uid, docId: window.__saver.docId, stats: window.__saver.stats,
      }));
      expect(info.stats.writes_failed, "run " + run + " had failed writes").toBe(0);
      await expect(page.locator("#data-saver-fallback")).toHaveCount(0);
      ids.push(info);
    }

    expect(ids[0].uid).toBe(ids[1].uid);          // same browser, same anonymous identity
    expect(ids[0].docId).not.toBe(ids[1].docId);  // but a separate participant record

    // Both runs survive intact, with their own Prolific id and their own trials.
    for (let run = 0; run < 2; run++) {
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}`);
      expect(p.status).toBe(200);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.completed, "run " + run + " completed").toBe(true);
      expect(pdoc.prolific_pid).toBe("rerun" + run);
      const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}/trials?pageSize=500`);
      expect((chunks.body.documents || []).length).toBe(pdoc.n_trials);
    }
  });

  test("setting a Prolific completion code does not break the test run", async ({ page }) => {
    // Regression test for the failure students hit right before launch: with a completion
    // code set, the live page redirects to Prolific, but a test run must stay put so that
    // `npm test` and CI keep passing.
    const navigations = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    await page.goto(EMULATOR ? `/?emulator=1&cc=QA123CODE&${FAST}` : `/?cc=QA123CODE&${FAST}`);
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await runThroughExperiment(page);

    expect(navigations.some((u) => u.includes("prolific.com")), "must not navigate to Prolific").toBe(false);
    if (EMULATOR) await expect(page.getByText("QA123CODE")).toBeVisible();
  });

  test("phones and tablets are turned away before consent", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto("http://localhost:8017/?emulator=1");
    await expect(page.locator("#device-unsupported")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: "I agree to participate" })).toHaveCount(0);

    if (EMULATOR) {
      // The turned-away visit is still recorded, so phone traffic is visible in the data.
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      const docId = await page.evaluate(() => window.__saver.docId);
      await page.evaluate(() => window.__saver._settle());
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${docId}`);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.device_supported).toBe(false);
      expect(pdoc.completed).toBe(false);
    }
    await context.close();
  });

  test("a desktop browser is not turned away", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible();
    await expect(page.locator("#device-unsupported")).toHaveCount(0);
  });

  test("a write the database refuses is announced on the page, not only in the console", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    // Regression test for the state a student is in when they skip publishing the rules, or
    // once test-mode rules expire: sign-in succeeds, so the page used to look perfectly
    // healthy from consent to debrief and only admitted the problem on the last screen.
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    // Emulator runs carry an informational banner; what must be absent is a failure banner.
    await expect(page.locator('#data-saver-banner[data-kind="offline"]')).toHaveCount(0);

    // Force a genuine permission-denied on a normal save path by aiming the participant
    // document at someone else's id, which the rules refuse exactly as deny-all rules would.
    await page.evaluate(async () => {
      window.__saver.docId = "someone-else-deadbeef";
      await window.__saver.updateParticipant({ blocked: true });
    });

    const banner = page.locator("#data-saver-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "offline");
    await expect(banner).toContainText("NOT being saved");
    await expect(banner).toContainText("permission-denied");
    await expect(banner).toContainText("2.3");
    expect(await page.evaluate(() => window.__saver.stats.writes_failed)).toBeGreaterThan(0);
  });

  test("the download fallback tells the participant where to send the file", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await page.evaluate(() => window.__saver._offerDownload(null, "[]"));
    const box = page.locator("#data-saver-fallback");
    await expect(box).toBeVisible();
    await expect(box).toContainText("@");                       // a contact address is present
    await expect(box).toContainText("you will be paid");
    await expect(box.getByRole("link")).toHaveAttribute("href", /^mailto:/);
  });

  test("security rules reject reads and writes to other participants", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);

    const results = await page.evaluate(async () => {
      const s = window.__saver;
      const fb = s.fb;
      const out = {};
      const attempt = async (name, fn) => {
        try { await fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code || e.message; }
      };
      await attempt("read own doc", () =>
        fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId)));
      await attempt("write other participant", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else"), { hacked: true }));
      await attempt("write other participant trials", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else", "trials", "c0"), { trials: [] }));
      await attempt("write unrelated collection", () =>
        fb.setDoc(fb.doc(s.db, "spam", "doc"), { spam: true }));
      await attempt("error doc with wrong uid", () =>
        fb.addDoc(fb.collection(s.db, "experiments", s.opts.experiment_id, "errors"), { uid: "not-me", message: "x" }));
      await attempt("own chunk (should be allowed)", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId, "trials", "chunk-test"), { trials: [{ a: 1 }] }));
      await attempt("participant doc without the run suffix", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid), { sneaky: true }));
      await attempt("another browser's run id", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd1234"), { sneaky: true }));
      return out;
    });

    expect(results["read own doc"]).toBe("permission-denied");
    expect(results["write other participant"]).toBe("permission-denied");
    expect(results["write other participant trials"]).toBe("permission-denied");
    expect(results["write unrelated collection"]).toBe("permission-denied");
    expect(results["error doc with wrong uid"]).toBe("permission-denied");
    expect(results["own chunk (should be allowed)"]).toBe("allowed");
    expect(results["participant doc without the run suffix"]).toBe("permission-denied");
    expect(results["another browser's run id"]).toBe("permission-denied");
  });

  test("uncaught errors are logged to the errors collection", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const uid = await page.evaluate(() => window.__saver.uid);

    // Simulate a bug in a trial: an uncaught exception.
    await page.evaluate(() => {
      setTimeout(() => { throw new Error("simulated bug in trial code"); }, 0);
    });
    await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    const errs = await fsGet(`experiments/${EXPERIMENT_ID}/errors?pageSize=100`);
    const mine = (errs.body.documents || []).map((d) => decodeFields(d.fields)).filter((d) => d.uid === uid);
    expect(mine.length).toBe(1);
    expect(mine[0].message).toContain("simulated bug");
    expect(mine[0].context.kind).toBe("uncaught");
  });
});
