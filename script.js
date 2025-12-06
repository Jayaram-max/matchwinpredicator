// Simple cricket win-probability heuristic
// The goal is not perfect accuracy but a believable, tunable model with
// clearly separated concerns for UX and math.

const form = document.getElementById("predict-form");
const predictBtn = document.getElementById("predictBtn");
const probabilityPercentEl = document.getElementById("probabilityPercent");
const predictionSummaryEl = document.getElementById("predictionSummary");
const runRateAnalysisEl = document.getElementById("runRateAnalysis");
const wicketsAnalysisEl = document.getElementById("wicketsAnalysis");
const oversAnalysisEl = document.getElementById("oversAnalysis");
const chaseStateChip = document.getElementById("chaseStateChip");
const pressureChip = document.getElementById("pressureChip");
const momentumChip = document.getElementById("momentumChip");
const ring = document.querySelector(".probability-ring");
const ringFg = document.querySelector(".ring-fg");
const modeToggle = document.querySelector(".mode-toggle");

// Circumference of ring path (approx for r=64)
const RING_CIRCUMFERENCE = 402;

function parseNumber(id) {
  const input = document.getElementById(id);
  return { input, value: input.value.trim() === "" ? NaN : Number(input.value) };
}

function setError(id, message) {
  const input = document.getElementById(id);
  const errorEl = document.querySelector(`[data-error-for="${id}"]`);
  if (message) {
    input.classList.add("input-invalid");
    if (errorEl) errorEl.textContent = message;
  } else {
    input.classList.remove("input-invalid");
    if (errorEl) errorEl.textContent = "";
  }
}

function validateInputs() {
  let valid = true;

  const { value: target } = parseNumber("targetRuns");
  const { value: score } = parseNumber("currentScore");
  const { value: wickets } = parseNumber("wicketsLost");
  const { value: overs } = parseNumber("oversRemaining");
  const { value: crr } = parseNumber("currentRunRate");
  const { value: rrr } = parseNumber("requiredRunRate");

  // Target
  if (!Number.isFinite(target) || target <= 0) {
    setError("targetRuns", "Enter a positive target.");
    valid = false;
  } else {
    setError("targetRuns", "");
  }

  // Score
  if (!Number.isFinite(score) || score < 0) {
    setError("currentScore", "Enter a non-negative score.");
    valid = false;
  } else if (Number.isFinite(target) && score >= target) {
    setError("currentScore", "Score already meets or exceeds target.");
    valid = false;
  } else {
    setError("currentScore", "");
  }

  // Wickets
  if (!Number.isFinite(wickets) || wickets < 0 || wickets > 10) {
    setError("wicketsLost", "Wickets must be between 0 and 10.");
    valid = false;
  } else {
    setError("wicketsLost", "");
  }

  // Overs
  if (!Number.isFinite(overs) || overs < 0) {
    setError("oversRemaining", "Overs remaining cannot be negative.");
    valid = false;
  } else {
    setError("oversRemaining", "");
  }

  // Run rates
  if (!Number.isFinite(crr) || crr < 0) {
    setError("currentRunRate", "Enter a non-negative run rate.");
    valid = false;
  } else {
    setError("currentRunRate", "");
  }

  if (!Number.isFinite(rrr) || rrr < 0) {
    setError("requiredRunRate", "Enter a non-negative required rate.");
    valid = false;
  } else {
    setError("requiredRunRate", "");
  }

  return {
    valid,
    target,
    score,
    wickets,
    overs,
    crr,
    rrr,
  };
}

// Win probability model: combine factors with simple weights.
function computeWinProbability({ target, score, wickets, overs, crr, rrr }) {
  const runsRemaining = Math.max(target - score, 0);
  const ballsRemaining = overs * 6;

  // Ratio of current vs required run rate
  let runRateScore = 0.5;
  if (rrr > 0) {
    const ratio = crr / rrr; // >1 good, <1 bad
    runRateScore = 1 / (1 + Math.exp(-3 * (ratio - 1))); // logistic
  }

  // Wicket factor: severe penalty after 6+ down
  const wicketsRemaining = Math.max(10 - wickets, 0);
  const wicketsRatio = wicketsRemaining / 10;
  const wicketsScore = Math.pow(wicketsRatio, 0.8);

  // Overs / required runs factor: if required rate is huge with low overs, penalize
  let oversScore = 0.5;
  if (overs > 0 && runsRemaining > 0) {
    const pressureRate = runsRemaining / overs; // implied RRR from remaining
    const pressureRatio = pressureRate / (rrr || pressureRate || 1);
    const x = 1 - Math.min(pressureRate / 14, 2); // 14 rpo is "extremely hard"
    oversScore = 1 / (1 + Math.exp(-2.2 * x));
  }

  // Combine scores with weights
  const combined = 0.45 * runRateScore + 0.3 * wicketsScore + 0.25 * oversScore;
  let probability = combined * 100;

  // Clamp and handle trivial cases
  if (runsRemaining === 0) probability = 99;
  if (ballsRemaining === 0 && runsRemaining > 0) probability = 0;
  if (wickets >= 10 && runsRemaining > 0) probability = 0;

  probability = Math.max(0, Math.min(99.9, probability));

  return {
    probability,
    runsRemaining,
    ballsRemaining,
    runRateScore,
    wicketsScore,
    oversScore,
  };
}

function animateRingTo(probability) {
  const pct = probability / 100;
  const offset = RING_CIRCUMFERENCE * (1 - pct);
  ring.classList.add("active");
  ringFg.style.strokeDashoffset = `${offset}`;
}

function updateChips({ probability, runRateScore, wicketsScore, oversScore, runsRemaining }) {
  const scoreText = runsRemaining > 0 ? `Need ${runsRemaining} more` : "Level scores";
  chaseStateChip.textContent = scoreText;

  const probs = probability;
  let pressureLabel = "Balanced";
  let pressureClass = "chip-neutral";

  if (probs >= 70) {
    pressureLabel = "Batting ahead";
    pressureClass = "chip-positive";
  } else if (probs <= 30) {
    pressureLabel = "Bowling on top";
    pressureClass = "chip-negative";
  }

  pressureChip.textContent = pressureLabel;
  pressureChip.classList.remove("chip-positive", "chip-negative", "chip-neutral");
  pressureChip.classList.add(pressureClass);

  const momentum = runRateScore * 0.45 + wicketsScore * 0.3 + oversScore * 0.25;
  let momentumLabel = "Even";
  let momentumClass = "chip-neutral";

  if (momentum >= 0.65) {
    momentumLabel = "Momentum with chase";
    momentumClass = "chip-positive";
  } else if (momentum <= 0.4) {
    momentumLabel = "Momentum with bowlers";
    momentumClass = "chip-negative";
  }

  momentumChip.textContent = momentumLabel;
  momentumChip.classList.remove("chip-positive", "chip-negative", "chip-neutral");
  momentumChip.classList.add(momentumClass);
}

function describeRunRate(runRateScore, crr, rrr) {
  if (!Number.isFinite(crr) || !Number.isFinite(rrr)) return "Run rate data incomplete.";
  const diff = crr - rrr;
  if (diff >= 1.5) return "Current scoring rate is comfortably above the requirement, giving the batters a strong cushion.";
  if (diff >= 0.3) return "Batting side is slightly ahead of the rate, allowing some room to absorb dot balls.";
  if (diff > -0.3) return "Current run rate is almost identical to the requirement; the chase is finely balanced.";
  if (diff > -1.5) return "Batting side is a touch behind the required rate, but a short burst of boundaries can restore control.";
  return "Required run rate is significantly higher than the current scoring, demanding aggressive, high-risk batting.";
}

function describeWickets(wicketsScore, wickets) {
  if (!Number.isFinite(wickets)) return "Wickets information missing.";
  if (wickets === 0) return "All ten wickets in hand: batters have full license to settle and then accelerate.";
  if (wickets <= 2) return "Top order mostly intact, offering stability with plenty of batting resources still to come.";
  if (wickets <= 5) return "Middle overs phase with a moderate fall of wickets; the next partnership is crucial to control the chase.";
  if (wickets <= 7) return "Lower-middle order exposed; any further collapse could swing the match sharply to the bowling side.";
  if (wickets < 10) return "Tail is in; survival and smart strike rotation are vital to keep faint hopes alive.";
  return "All out with runs still needed; win probability effectively zero.";
}

function describeOvers(oversScore, overs, runsRemaining, rrr) {
  if (!Number.isFinite(overs) || overs <= 0) {
    return runsRemaining > 0
      ? "No overs remaining with runs still needed; the chase is effectively over."
      : "No overs remaining but target reached; chase completed at the last moment.";
  }
  if (runsRemaining <= 0) return "Target achieved with overs to spare; outstanding control of the chase.";

  if (rrr <= 6) return "Healthy bank of overs with a manageable asking rate; batting side can build calmly with low risk.";
  if (rrr <= 8.5) return "Run chase is entering a pressurised window, but there are still enough overs for calculated aggression.";
  if (rrr <= 11) return "Requiring more than a run-a-ball places premium on every over; one quiet spell could prove costly.";
  return "Overs are running out quickly relative to the asking rate, forcing high-intensity batting and creative stroke play.";
}

function updateSummary(probability, runsRemaining, ballsRemaining) {
  const balls = Math.round(ballsRemaining);
  const oversLeft = (balls / 6).toFixed(1);
  if (probability <= 1) {
    predictionSummaryEl.textContent = `Chances are extremely slim. Need ${runsRemaining} with only ${oversLeft} overs left.`;
  } else if (probability < 30) {
    predictionSummaryEl.textContent = `Bowling side holds a strong advantage. Batters must take calculated risks to chase ${runsRemaining} more.`;
  } else if (probability < 60) {
    predictionSummaryEl.textContent = `Match is finely balanced. ${runsRemaining} needed in ${oversLeft} overs; small shifts in momentum will decide it.`;
  } else if (probability < 85) {
    predictionSummaryEl.textContent = `Batting side is ahead in the chase, needing ${runsRemaining} with control over tempo and risk.`;
  } else {
    predictionSummaryEl.textContent = `Batting side is overwhelmingly ahead. Only ${runsRemaining} required with plenty of resources remaining.`;
  }
}

function updateUIFromModel(input, model) {
  const { probability, runRateScore, wicketsScore, oversScore, runsRemaining, ballsRemaining } = model;

  // Animate probability text
  const rounded = probability.toFixed(1);
  probabilityPercentEl.textContent = rounded;
  animateRingTo(probability);

  updateChips({ probability, runRateScore, wicketsScore, oversScore, runsRemaining });

  runRateAnalysisEl.textContent = describeRunRate(runRateScore, input.crr, input.rrr);
  wicketsAnalysisEl.textContent = describeWickets(wicketsScore, input.wickets);
  oversAnalysisEl.textContent = describeOvers(oversScore, input.overs, runsRemaining, input.rrr);
  updateSummary(probability, runsRemaining, ballsRemaining);
}

function handleSubmit(event) {
  event.preventDefault();

  const result = validateInputs();
  if (!result.valid) return;

  predictBtn.disabled = true;
  predictBtn.style.opacity = "0.7";

  // Slight delay for micro-interaction and potential future Monte Carlo extension
  window.setTimeout(() => {
    const model = computeWinProbability(result);
    updateUIFromModel(result, model);

    predictBtn.disabled = false;
    predictBtn.style.opacity = "1";
  }, 220);
}

form.addEventListener("submit", handleSubmit);

// Light/dark toggle with local storage persistence
function applyStoredTheme() {
  const stored = window.localStorage.getItem("cwp-theme");
  if (stored === "light" || stored === "dark") {
    document.body.setAttribute("data-theme", stored);
  } else {
    document.body.setAttribute("data-theme", "dark");
  }
}

applyStoredTheme();

modeToggle.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.body.setAttribute("data-theme", next);
  window.localStorage.setItem("cwp-theme", next);
});

// Initialize ring to 0
ringFg.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
ringFg.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
