/*
 * Replication of Patil & Duncan (2018), Psychological Science 29(1), Experiment 1:
 * "Lingering cognitive states shape fundamental mnemonic abilities."
 *
 * Design summary
 *   IV       Preceding judgment ("old" vs "new" on the previous retrieval trial), within subjects,
 *            not manipulated directly: it is the participant's own previous response. Crossed with
 *            stimulus category (scene vs object), also within subjects.
 *   DVs      Retrieval trials (task "retrieval"): item memory from `judgment` vs `is_old` (d'),
 *            associative memory from `response_label` vs `studied_word` (`assoc_correct`), RT in
 *            `rt`. The preceding trial is recorded on each row (`prev_judgment`,
 *            `prev_response_label`, `prev_is_old`, `prev_rt`), so the analysis needs no re-joining.
 *   Trials   Encoding: 8 blocks (4 scene, 4 object, alternating), each trial = 1 s fixation,
 *            3 s image + word, 1.5 s vividness rating (H J K L). Retrieval: 4 blocks; each trial =
 *            2 s image (D new, F old/can't recall word, J ancient, K plain, L safe), 1 s fixation ISI.
 *   Random   Per participant: which half of each category is studied, image-word pairing (each word
 *            used equally often within category), encoding order, which category starts encoding
 *            (`first_encoding_category`, random assignment) and retrieval (`first_retrieval_category`).
 *            Retrieval alternates scene/object; at most 4 new images in a row; old/new transition
 *            probability ~.50.
 *   Exclude  Paper: prior participation in similar studies, drowsiness throughout (post-study
 *            questions, task "post_study"). Analysis removes trials whose correct word equals the
 *            previous response (`studied_word === prev_response_label`).
 *
 * Timeline
 *   1. consent            course-wide consent text (required first)
 *   2. preload            all 484 images
 *   3. welcome
 *   4. demographics
 *   5. encoding           instructions, then 8 blocks with self-paced breaks
 *   6. retrieval          instructions, then 4 blocks with self-paced breaks
 *   7. post-study         strategy, drowsiness, prior participation
 *   8. feedback           Likert + free text
 *   9. debrief            saves data, then shows thanks or redirects to Prolific (required last)
 *
 * Images are placeholders until the original stimuli are available: scenes from Konkle et al.
 * (2010) and objects from Brady et al. (2008); see stimuli/manifest.csv. To swap in the originals,
 * replace the files in stimuli/scenes and stimuli/objects (keep the names, or edit the lists below).
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
window.TEMPLATE_VERSION = "0.1.0";

const EXPERIMENT = {
  // Firestore path: experiments/<id>/participants/... Change it when you start a new study
  // so pilot data and real data never mix (e.g. "smith2016-pilot-a", "smith2016-final").
  id: "patil2018-pilot-a",

  // Trials per Firestore write. 1 = save every trial the moment it finishes (dropouts leave
  // partial data). The free tier allows 20,000 writes/day. This study records ~1,000 rows per
  // participant, so 20 per write gives ~55 writes per participant.
  chunk_size: 20,

  // Also store the complete jsPsych dataset on the participant document at the end.
  // Costs one extra write and makes export robust; turn off if trials are very large.
  save_full_data_at_end: true,

  // Prolific: if set, participants are redirected to Prolific when they finish.
  // Leave empty for local testing or non-Prolific samples.
  prolific_completion_code: "",

  // Contact shown in consent and debrief.
  contact_email: "stanfordpsych251@gmail.com",

  // Does this study need a physical keyboard? Yes: every encoding and retrieval response is a key.
  requires_keyboard: true,

  // Images per category (scenes and objects each). Half are studied, half are new at test.
  // Experiment 1 used 242 of each (484 total). Must be even, and at most the number of files.
  n_per_category: 242,
  n_encoding_blocks_per_category: 4, // 8 encoding blocks in total, alternating category
  n_retrieval_blocks: 4,

  // Timing in ms, from the paper's Method.
  timing: {
    encoding_fixation: 1000,
    encoding_pair: 3000,
    encoding_rating: 1500,
    retrieval_image: 2000,
    retrieval_isi: 1000,
  },
};

// The three words and the retrieval keys, as in the paper.
const WORDS = ["ancient", "plain", "safe"];
const RETRIEVAL_KEYS = { d: "new", f: "skip", j: "ancient", k: "plain", l: "safe" };
const VIVIDNESS_KEYS = ["h", "j", "k", "l"]; // h = very vivid (1) ... l = not vivid at all (4)
const N_IMAGE_FILES = 242;                     // files per category in stimuli/

// True on anything with a mouse, trackpad, or stylus, including laptops with touchscreens.
// False on phones and tablets without a pointing device, which are also the devices with no
// physical keyboard. See docs/student-guide.md "Devices".
function hasFinePointer() {
  return !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches);
}

// `?emulator=1` in the URL sends data to the local emulator instead of the real project.
// Used by `npm test`; handy for development too (start it with `npm run emulators`).
const URL_PARAMS = new URLSearchParams(window.location.search);
const USE_EMULATOR = URL_PARAMS.get("emulator") === "1";
// `?chunk_size=N` overrides the setting above; used by the test suite to exercise chunked writes.
const CHUNK_SIZE = Number(URL_PARAMS.get("chunk_size")) || EXPERIMENT.chunk_size;
// Test-only: `?cc=CODE` sets a Prolific completion code during emulator runs, so the test
// suite can check the screen a participant sees once you have set yours. Ignored in live runs.
if (USE_EMULATOR && URL_PARAMS.get("cc")) EXPERIMENT.prolific_completion_code = URL_PARAMS.get("cc");
// Test-only: `?n=N` shrinks the study to N images per category and `?timescale=X` multiplies
// every duration by X, so the robot can play the whole flow in seconds. Honoured only in
// emulator runs or on localhost, never on the live site.
const TEST_OVERRIDES = USE_EMULATOR || ["localhost", "127.0.0.1"].includes(window.location.hostname);
if (TEST_OVERRIDES && URL_PARAMS.get("n")) EXPERIMENT.n_per_category = Number(URL_PARAMS.get("n"));
const TIMESCALE = (TEST_OVERRIDES && Number(URL_PARAMS.get("timescale"))) || 1;
const T = Object.fromEntries(Object.entries(EXPERIMENT.timing).map(([k, v]) => [k, Math.round(v * TIMESCALE)]));

// ---------------------------------------------------------------------------
// Boot: connect the saver first so even a crash in the first trial gets logged.
// ---------------------------------------------------------------------------
(async function main() {
  const deviceSupported = !EXPERIMENT.requires_keyboard || hasFinePointer();

  const saver = await DataSaver.init({
    experiment_id: EXPERIMENT.id,
    chunk_size: CHUNK_SIZE,
    save_full_data_at_end: EXPERIMENT.save_full_data_at_end,
    use_emulator: USE_EMULATOR,
    contact_email: EXPERIMENT.contact_email,
  });
  window.__saver = saver; // for debugging and the automated test

  // Record the device verdict on the participant document before anything else, so a
  // participant turned away below is still visible in the data rather than simply absent.
  saver.updateParticipant({ device_supported: deviceSupported, requires_keyboard: EXPERIMENT.requires_keyboard });

  if (!deviceSupported) {
    document.body.innerHTML =
      '<div id="device-unsupported" class="jspsych-content" style="max-width:640px;margin:15vh auto;font:16px/1.6 system-ui,sans-serif;">' +
      "<h2>Please use a computer</h2>" +
      "<p>This study needs a computer with a physical keyboard, because part of it is answered " +
      "by pressing keys. Phones and tablets cannot be used.</p>" +
      "<p>Please reopen this link on a laptop or desktop computer. If you were sent here from " +
      "Prolific, you can return the study and take it later on a computer; nothing has been recorded " +
      "against you.</p>" +
      "<p>Questions: <a href=\"mailto:" + EXPERIMENT.contact_email + "\">" + EXPERIMENT.contact_email + "</a></p></div>";
    return;
  }

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_data_update: (trial) => saver.onTrial(trial),
    on_finish: async () => {
      const el = jsPsych.getDisplayElement();
      el.innerHTML = '<div id="finish-message"><p class="thanks">Saving your responses…</p></div>';
      // Browser interactions jsPsych tracked during the session (leaving/returning to the tab or
      // window, fullscreen changes), each with trial index and time. Saved once on the participant
      // document; exported to participants.csv as JSON. Sessions abandoned midway do not have it.
      const interactions = jsPsych.data.getInteractionData().values().slice(0, 2000);
      saver.updateParticipant({
        interaction_data: JSON.stringify(interactions),
        n_blur: interactions.filter((e) => e.event === "blur").length,
        n_focus: interactions.filter((e) => e.event === "focus").length,
      });
      // finish() flushes remaining trials, marks the participant complete, and (only if
      // saving failed) appends a download-fallback box to the display element.
      const result = await saver.finish(jsPsych);
      const consentRow = jsPsych.data.get().filter({ task: "consent" }).values()[0];
      const consented = !consentRow || consentRow.consented !== false;
      const msg = document.getElementById("finish-message");

      if (!consented) {
        msg.innerHTML = "<h2 class='thanks'>Thank you</h2><p class='thanks'>You chose not to participate. " +
          "You may close this window" + (EXPERIMENT.prolific_completion_code ? " and return the study on Prolific" : "") + ".</p>";
        return;
      }
      if (result.ok && EXPERIMENT.prolific_completion_code && !USE_EMULATOR) {
        msg.innerHTML = "<p class='thanks'>Saved. Returning you to Prolific…</p>";
        window.location.href =
          "https://app.prolific.com/submissions/complete?cc=" + EXPERIMENT.prolific_completion_code;
        return;
      }
      // In emulator/test runs we stay on the page instead of navigating to Prolific, so that
      // setting a completion code can never turn `npm test` or CI red. Live runs redirect above.
      msg.innerHTML =
        "<h2 class='thanks'>All done</h2>" +
        (result.ok ? "<p class='thanks'>Your responses were saved. Thank you for participating!</p>" : "") +
        (EXPERIMENT.prolific_completion_code
          ? "<p class='thanks'>Your completion code is <strong>" + EXPERIMENT.prolific_completion_code + "</strong>.</p>"
          : "");
    },
  });

  // Record the participant id and URL parameters on every trial row.
  jsPsych.data.addProperties({
    // Must be the run-scoped document id, so trial rows join to participants.csv on export.
    participant_id: saver.docId,
    prolific_pid: saver.params.PROLIFIC_PID || null,
    experiment_id: EXPERIMENT.id,
  });

  // -------------------------------------------------------------------------
  // Stimulus lists and randomization (all per participant)
  // -------------------------------------------------------------------------
  const R = jsPsych.randomization;
  const N = EXPERIMENT.n_per_category;
  if (N % 2 !== 0 || N > N_IMAGE_FILES) throw new Error("n_per_category must be even and <= " + N_IMAGE_FILES);
  const pad = (i) => String(i).padStart(3, "0");
  const CATEGORIES = ["scene", "object"];

  // For each category: sample N images, study half (with a balanced word for each), keep half new.
  const studied = {}; // category -> [{ image, category, studied_word }]
  const unstudied = {};
  for (const cat of CATEGORIES) {
    const files = R.sampleWithoutReplacement(
      Array.from({ length: N_IMAGE_FILES }, (_, i) => `stimuli/${cat}s/${cat}_${pad(i + 1)}.jpg`), N);
    const half = N / 2;
    // Each word appears an equal number of times (within one, if half is not divisible by 3).
    const words = R.shuffle(Array.from({ length: half }, (_, i) => WORDS[i % WORDS.length]));
    studied[cat] = files.slice(0, half).map((image, i) => ({ image, category: cat, studied_word: words[i] }));
    unstudied[cat] = files.slice(half).map((image) => ({ image, category: cat, studied_word: null }));
  }

  // Which category starts encoding is counterbalanced by random assignment; retrieval likewise.
  const firstEncoding = R.sampleWithoutReplacement(CATEGORIES, 1)[0];
  const firstRetrieval = R.sampleWithoutReplacement(CATEGORIES, 1)[0];
  jsPsych.data.addProperties({ first_encoding_category: firstEncoding, first_retrieval_category: firstRetrieval });
  saver.updateParticipant({ first_encoding_category: firstEncoding, first_retrieval_category: firstRetrieval });

  // Split items into k near-equal consecutive chunks (121 -> 31, 30, 30, 30).
  function chunks(items, k) {
    const out = [];
    let start = 0;
    for (let b = 0; b < k; b++) {
      const size = Math.floor(items.length / k) + (b < items.length % k ? 1 : 0);
      out.push(items.slice(start, start + size));
      start += size;
    }
    return out;
  }

  // Encoding blocks alternate category, starting with firstEncoding.
  const nEnc = EXPERIMENT.n_encoding_blocks_per_category;
  const encChunks = Object.fromEntries(CATEGORIES.map((c) => [c, chunks(R.shuffle(studied[c]), nEnc)]));
  const otherCat = (c) => (c === "scene" ? "object" : "scene");
  const encodingBlocks = [];
  for (let b = 0; b < nEnc * 2; b++) {
    const cat = b % 2 === 0 ? firstEncoding : otherCat(firstEncoding);
    encChunks[cat][Math.floor(b / 2)].forEach((item) => (item.encoding_block = b + 1));
    encodingBlocks.push(encChunks[cat][Math.floor(b / 2)]);
  }

  // Retrieval sequence: categories alternate; old/new is drawn trial by trial in proportion to
  // what is left in that category, never more than 4 new in a row, and the sequence is accepted
  // only if its old/new switch rate is within about 1% of .50 (at least 2 switches of slack).
  function buildRetrievalSequence() {
    const L = 2 * N;
    const targetSwitches = 0.5 * (L - 1);
    const slack = Math.max(2, 0.01 * L);
    for (let attempt = 0; attempt < 20000; attempt++) {
      const left = Object.fromEntries(CATEGORIES.map((c) => [c, { old: N / 2, new: N / 2 }]));
      const seq = [];
      let newRun = 0;
      let failed = false;
      for (let i = 0; i < L; i++) {
        const cat = i % 2 === 0 ? firstRetrieval : otherCat(firstRetrieval);
        const l = left[cat];
        let isOld;
        if (newRun >= 4) isOld = true;
        else isOld = Math.random() < l.old / (l.old + l.new);
        if (isOld && l.old === 0) isOld = false;
        if (!isOld && l.new === 0) isOld = true;
        if ((isOld && l.old === 0) || (!isOld && newRun >= 4)) { failed = true; break; }
        isOld ? l.old-- : l.new--;
        newRun = isOld ? 0 : newRun + 1;
        seq.push({ category: cat, is_old: isOld });
      }
      if (failed) continue;
      let switches = 0;
      for (let i = 1; i < L; i++) if (seq[i].is_old !== seq[i - 1].is_old) switches++;
      if (Math.abs(switches - targetSwitches) <= slack) return seq;
    }
    throw new Error("Could not build a retrieval sequence that meets the constraints");
  }
  const oldPool = Object.fromEntries(CATEGORIES.map((c) => [c, R.shuffle(studied[c])]));
  const newPool = Object.fromEntries(CATEGORIES.map((c) => [c, R.shuffle(unstudied[c])]));
  const retrievalItems = buildRetrievalSequence().map((slot, i) => {
    const item = slot.is_old ? oldPool[slot.category].pop() : newPool[slot.category].pop();
    return { ...item, is_old: slot.is_old, retrieval_position: i + 1 };
  });
  const retrievalBlocks = chunks(retrievalItems, EXPERIMENT.n_retrieval_blocks);
  retrievalBlocks.forEach((block, b) => block.forEach((item, j) => {
    item.retrieval_block = b + 1;
    item.trial_in_block = j + 1;
  }));

  // -------------------------------------------------------------------------
  // 1. Consent (course-wide IRB text; edit only the contact address)
  // -------------------------------------------------------------------------
  const consent = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="consent">
        <h2>Consent</h2>
        <p>By answering the following questions, you are participating in a study being performed by
        cognitive scientists in the Stanford Department of Psychology. If you have questions about
        this research, please contact us at <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.
        You must be at least 18 years old to participate. Your participation in this research is
        voluntary. You may decline to answer any or all of the following questions. You may decline
        further participation, at any time, without adverse consequences. Your anonymity is assured;
        the researchers who have requested your participation will not receive any personal
        information about you.</p>
      </div>`,
    choices: ["I agree to participate", "I do not agree"],
    data: { task: "consent" },
    on_finish: (data) => {
      data.consented = data.response === 0;
      if (!data.consented) {
        // No end message here: jsPsych would paint it over the screen that on_finish renders.
        jsPsych.abortExperiment();
      }
    },
  };

  // -------------------------------------------------------------------------
  // 2. Preload every image this participant will see
  // -------------------------------------------------------------------------
  const preload = {
    type: jsPsychPreload,
    images: retrievalItems.map((it) => it.image),
    message: "<p>Loading images…</p>",
    show_progress_bar: true,
    continue_after_error: false,
    error_message: "<p>The images could not be loaded. Please check your connection and reload the page.</p>",
    max_load_time: 120000,
    data: { task: "preload" },
  };

  // -------------------------------------------------------------------------
  // 3. Welcome
  // -------------------------------------------------------------------------
  const welcome = {
    type: jsPsychInstructions,
    pages: [
      `<h2>Welcome</h2>
       <p>This is a study about memory for pictures. It has two main parts. First you will see
       pictures of scenes and objects, each paired with a word. Then your memory for them will be
       tested. At the end there are a few short questions.</p>
       <p>The study takes about 60 minutes. There are short breaks between blocks.</p>`,
      `<p>Please complete the study in one sitting, in a quiet place, on a laptop or desktop
       computer with a keyboard. Close other tabs and silence your phone. Use the buttons or the
       arrow keys to move between pages.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  };

  // -------------------------------------------------------------------------
  // 4. Demographics (survey plugin: one page, several question types)
  // -------------------------------------------------------------------------
  const demographics = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [
        {
          elements: [
            // The consent text promises participants may decline any question, so nothing here is required.
            { type: "text", name: "age", title: "How old are you?", inputType: "number", min: 18, max: 120 },
            {
              type: "radiogroup", name: "gender", title: "What is your gender?",
              choices: ["Woman", "Man", "Non-binary"], showOtherItem: true, showNoneItem: true, noneText: "Prefer not to say",
            },
            { type: "boolean", name: "native_english", title: "Is English your first language?", labelTrue: "Yes", labelFalse: "No" },
          ],
        },
      ],
    },
    data: { task: "demographics" },
  };

  // -------------------------------------------------------------------------
  // 5. Encoding: image-word pairs, vividness rating
  // -------------------------------------------------------------------------
  const keyRow = (pairs) =>
    `<div class="key-reminder">${pairs.map(([k, label]) => `<span><kbd>${k}</kbd> ${label}</span>`).join("")}</div>`;
  const vividReminder = keyRow([["H", "very vivid"], ["J", ""], ["K", ""], ["L", "not vivid at all"]]);
  const retrievalReminder = keyRow([["D", "new"], ["F", "old?"], ["J", "ancient"], ["K", "plain"], ["L", "safe"]]);

  const encodingInstructions = {
    type: jsPsychInstructions,
    pages: [
      `<h2>Part 1: Study</h2>
       <p>You will see a series of pictures, one at a time. Some are <strong>scenes</strong> (places,
       indoors and outdoors) and some are <strong>objects</strong>. Each picture is shown with one of
       three words: <strong>ancient</strong>, <strong>plain</strong> or <strong>safe</strong>.</p>
       <p>For each pair, <strong>vividly imagine a scenario in which the word could describe the
       picture</strong>. Each pair is on the screen for 3 seconds.</p>`,
      `<p>After each pair disappears, rate how vivid the scenario you imagined was, using four keys:</p>
       ${vividReminder}
       <p>H means very vivid and L means not vivid at all; J and K are in between. You have 1.5
       seconds to answer, so keep your fingers on H, J, K and L.</p>`,
      `<p><strong>Your memory for the pictures and their words will be tested later.</strong></p>
       <p>This part has ${encodingBlocks.length} short blocks, alternating between scenes and objects,
       with a break after each one. Press <strong>Next</strong> to begin.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  };

  const encFixation = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div class="fixation">+</div>',
    choices: "NO_KEYS",
    trial_duration: T.encoding_fixation,
    css_classes: ["task-screen"],
    record_data: false, // pure timing filler; dropping ~730 rows keeps full_data under Firestore's 1 MiB limit
  };
  const encPair = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: () => `
      <div class="study-pair" data-word="${jsPsych.evaluateTimelineVariable("studied_word")}">
        <img class="stim-img" src="${jsPsych.evaluateTimelineVariable("image")}" alt="">
        <div class="study-word">${jsPsych.evaluateTimelineVariable("studied_word")}</div>
      </div>`,
    choices: "NO_KEYS",
    trial_duration: T.encoding_pair,
    css_classes: ["task-screen"],
    save_trial_parameters: { stimulus: false },
    data: {
      task: "encoding",
      image: jsPsych.timelineVariable("image"),
      category: jsPsych.timelineVariable("category"),
      studied_word: jsPsych.timelineVariable("studied_word"),
      encoding_block: jsPsych.timelineVariable("encoding_block"),
    },
  };
  const encRating = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="rating-prompt" data-screen="vividness"><p>How vivid was the scenario you imagined?</p>${vividReminder}</div>`,
    choices: VIVIDNESS_KEYS,
    trial_duration: T.encoding_rating,
    response_ends_trial: false, // fixed 1.5 s window, so every trial has the same timing
    css_classes: ["task-screen"],
    save_trial_parameters: { stimulus: false },
    data: {
      task: "vividness",
      image: jsPsych.timelineVariable("image"),
      category: jsPsych.timelineVariable("category"),
      studied_word: jsPsych.timelineVariable("studied_word"),
      encoding_block: jsPsych.timelineVariable("encoding_block"),
    },
    on_finish: (data) => {
      data.timed_out = data.response === null;
      // 1 = very vivid (H) ... 4 = not vivid at all (L)
      data.vividness_rating = data.timed_out ? null : VIVIDNESS_KEYS.indexOf(data.response) + 1;
    },
  };

  const breakScreen = (text, extra) => ({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="break-screen"><p>${text}</p><p>Press the <strong>space bar</strong> when you are ready to continue.</p></div>`,
    choices: [" "],
    css_classes: ["task-screen"],
    data: { task: "break", ...extra },
  });

  const encoding = [encodingInstructions];
  encodingBlocks.forEach((block, b) => {
    const cat = block[0].category;
    encoding.push(breakScreen(
      `Study block ${b + 1} of ${encodingBlocks.length}: <strong>${cat}s</strong>.<br>Imagine a scenario in which the word describes the picture, then rate how vivid it was.`,
      { phase: "encoding", block: b + 1, block_category: cat }));
    encoding.push({ timeline: [encFixation, encPair, encRating], timeline_variables: block });
  });

  // -------------------------------------------------------------------------
  // 6. Retrieval: old/new + associative judgment in one key press
  // -------------------------------------------------------------------------
  const retrievalInstructions = {
    type: jsPsychInstructions,
    pages: [
      `<h2>Part 2: Memory test</h2>
       <p>Now you will see pictures one at a time, alternating between scenes and objects. Some of
       them you studied in Part 1 (<strong>old</strong>); others you have never seen (<strong>new</strong>).</p>`,
      `<p>For each picture, press <strong>one</strong> key:</p>
       <ul class="key-list">
         <li><kbd>D</kbd> if the picture is <strong>new</strong></li>
         <li>If the picture is <strong>old</strong>, the word it was paired with:
           <kbd>J</kbd> ancient, <kbd>K</kbd> plain, <kbd>L</kbd> safe</li>
         <li><kbd>F</kbd> if you think the picture is old but you cannot remember its word</li>
       </ul>
       <p>Keep your fingers on D, F, J, K and L.</p>`,
      `<p>Each picture is shown for only <strong>2 seconds</strong>, and you must answer while it is on
       the screen, so respond quickly. Only your first key press counts. A reminder of the keys is
       shown under each picture:</p>
       ${retrievalReminder}
       <p>This part has ${retrievalBlocks.length} blocks with a break after each. Press <strong>Next</strong> to begin.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  };

  // The previous retrieval trial in the same block, for the preceding-judgment fields.
  let prevRetrieval = null;
  const retrievalTrial = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: () => `
      <div class="retrieval" data-old="${jsPsych.evaluateTimelineVariable("is_old")}"
           data-word="${jsPsych.evaluateTimelineVariable("studied_word") || ""}">
        <img class="stim-img" src="${jsPsych.evaluateTimelineVariable("image")}" alt="">
        ${retrievalReminder}
      </div>`,
    choices: Object.keys(RETRIEVAL_KEYS),
    trial_duration: T.retrieval_image,
    response_ends_trial: false, // the image stays up for the full 2 s, as in the paper
    css_classes: ["task-screen"],
    save_trial_parameters: { stimulus: false },
    data: {
      task: "retrieval",
      image: jsPsych.timelineVariable("image"),
      category: jsPsych.timelineVariable("category"),
      is_old: jsPsych.timelineVariable("is_old"),
      studied_word: jsPsych.timelineVariable("studied_word"),
      retrieval_block: jsPsych.timelineVariable("retrieval_block"),
      trial_in_block: jsPsych.timelineVariable("trial_in_block"),
      retrieval_position: jsPsych.timelineVariable("retrieval_position"),
    },
    on_finish: (data) => {
      data.timed_out = data.response === null;
      data.response_label = data.timed_out ? null : RETRIEVAL_KEYS[data.response]; // new/skip/ancient/plain/safe
      data.judgment = data.timed_out ? null : data.response_label === "new" ? "new" : "old";
      data.item_correct = data.timed_out ? null : (data.judgment === "old") === data.is_old;
      // Associative hit: old image, correct word. Defined only when an old image was called old.
      data.assoc_correct = data.is_old && data.judgment === "old" ? data.response_label === data.studied_word : null;
      // Preceding trial, within the block (the first trial after a break has no preceding trial).
      const p = data.trial_in_block > 1 ? prevRetrieval : null;
      data.prev_judgment = p ? p.judgment : null;
      data.prev_response_label = p ? p.response_label : null;
      data.prev_is_old = p ? p.is_old : null;
      data.prev_rt = p ? p.rt : null;
      prevRetrieval = { judgment: data.judgment, response_label: data.response_label, is_old: data.is_old, rt: data.rt };
    },
  };
  const retrievalIsi = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div class="fixation">+</div>',
    choices: "NO_KEYS",
    trial_duration: T.retrieval_isi,
    css_classes: ["task-screen"],
    record_data: false, // pure timing filler; dropping ~730 rows keeps full_data under Firestore's 1 MiB limit
  };

  const retrieval = [retrievalInstructions];
  retrievalBlocks.forEach((block, b) => {
    retrieval.push(breakScreen(
      `Memory test block ${b + 1} of ${retrievalBlocks.length}.<br>D = new, F = old but can't remember the word, J = ancient, K = plain, L = safe.`,
      { phase: "retrieval", block: b + 1 }));
    retrieval.push({ timeline: [retrievalIsi, retrievalTrial], timeline_variables: block });
  });

  // -------------------------------------------------------------------------
  // 7. Post-study questions (the paper's exclusions: drowsiness, prior participation)
  // -------------------------------------------------------------------------
  const postStudy = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [
        {
          elements: [
            {
              type: "comment", name: "strategy", rows: 3,
              title: "In Part 1, how did you try to remember the pictures and their words?",
            },
            {
              type: "radiogroup", name: "drowsiness", title: "Did you feel drowsy or sleepy during the study?",
              choices: ["Not at all", "At some points", "Throughout most of the study"],
            },
            {
              type: "radiogroup", name: "prior_participation",
              title: "Have you taken part in another study in which you studied pictures paired with the words \"ancient\", \"plain\" and \"safe\"?",
              choices: ["Yes", "No", "Not sure"],
            },
          ],
        },
      ],
    },
    data: { task: "post_study" },
  };

  // -------------------------------------------------------------------------
  // 8. Feedback
  // -------------------------------------------------------------------------
  const feedback = {
    type: jsPsychSurveyLikert,
    questions: [
      {
        prompt: "How clear were the instructions?", name: "instructions_clear", required: false,
        labels: ["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"],
      },
    ],
    data: { task: "feedback_likert" },
  };
  const comments = {
    type: jsPsychSurveyText,
    questions: [{ prompt: "Any comments about the study? (optional)", name: "comments", rows: 4 }],
    data: { task: "feedback_text" },
  };

  // -------------------------------------------------------------------------
  // 9. Debrief
  // -------------------------------------------------------------------------
  const debrief = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h2>Debrief</h2>
      <p>Thank you. This study looks at whether the memory decision you have just made changes the
      next one. Earlier research found that people remembered a picture's word better right after
      recognising a different picture as old than right after judging one as new, while recognising
      the pictures themselves was unaffected. We are testing whether that finding holds up. Nothing
      in the study was designed to deceive you; the order of old and new pictures was simply
      arranged in advance.</p>
      <p>If you have questions about this research, contact
      <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.
      Press the button to save your responses and finish.</p>`,
    choices: ["Finish"],
    data: { task: "debrief" },
  };

  await jsPsych.run([
    consent,
    preload,
    welcome,
    demographics,
    ...encoding,
    ...retrieval,
    postStudy,
    feedback,
    comments,
    debrief,
  ]);
})();
