let video;
let bodyPose;
let poses = [];
let connections = [];
let modelIsReady = false;

let currentStatue = 0;
let redLight = false;
let score = 0;
let alreadyScored = false;
let poseSwitchPending = false;

// CHANGED: replaced the frame counter "timeInPose" with a real-time hold (200 ms).
const HOLD_TIME_MS = 200;
let poseStartTime = null;

// CHANGED: added so the pending auto-switch to the next statue can be cancelled.
let nextStatueTimeout = null;

// CHANGED: replaced "cycleSecondsRemaining" with clock-based timer variables.
const GREEN_SECONDS = 5;
const RED_SECONDS = 3;
let autoTimerRunning = false;
let msRemaining = GREEN_SECONDS * 1000;
let lightEndsAt = 0;
let timerInterval = null;

const statues = [
  {
    name: "Standing Woman",
    photo: "standing-woman.jpg",
    instruction: "Stand upright and fold your arms across your body.",
    matchesPose: function (points) {
      const wristsAreClose =
        Math.abs(points.leftWrist.x - points.rightShoulder.x) < 180 &&
        Math.abs(points.rightWrist.x - points.leftShoulder.x) < 180;
      const wristsAreSimilarHeight =
        Math.abs(points.leftWrist.y - points.rightWrist.y) < 180;

      return wristsAreClose && wristsAreSimilarHeight;
    }
  },
  {
    name: "The Thinker",
    photo: "thinker.jpg",
    instruction: "Bring one hand near your face and lean forward slightly.",
    matchesPose: function (points) {
      const leftHandIsRaised = points.leftWrist.y < points.leftShoulder.y + 65;
      const rightHandIsRaised = points.rightWrist.y < points.rightShoulder.y + 65;
      const leftHandIsNearBody =
        Math.abs(points.leftWrist.x - points.leftShoulder.x) < 250;
      const rightHandIsNearBody =
        Math.abs(points.rightWrist.x - points.rightShoulder.x) < 250;

      return (leftHandIsRaised || rightHandIsRaised) &&
        (leftHandIsNearBody || rightHandIsNearBody);
    }
  },
  {
    name: "Discus Thrower",
    photo: "discus-thrower.jpg",
    instruction: "Lean forward and extend one arm away from your body.",
    matchesPose: function (points) {
      const leftArmIsOut =
        Math.abs(points.leftWrist.x - points.leftShoulder.x) > 75;
      const rightArmIsOut =
        Math.abs(points.rightWrist.x - points.rightShoulder.x) > 75;

      return leftArmIsOut || rightArmIsOut;
    }
  }
];

async function setup() {
  const canvas = createCanvas(640, 480);
  canvas.parent("canvas-holder");

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  document.querySelector("#feedback").textContent =
    "Loading pose detection. Allow camera access if asked.";

  try {
    bodyPose = await ml5.bodyPose("BlazePose");

    bodyPose.detectStart(video, function (results) {
      poses = results;
    });

    connections = bodyPose.getSkeleton();
    modelIsReady = true;
    document.querySelector("#feedback").textContent =
      "Ready! Try copying the first statue.";
  } catch (error) {
    console.log(error);
    document.querySelector("#feedback").textContent =
      "The pose model did not load. Check your internet and camera permission.";
  }
}

function draw() {
  background(215);

  if (video && video.elt.readyState >= 2) {
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();
  } else {
    fill(40);
    textAlign(CENTER, CENTER);
    textSize(17);
    text("Waiting for camera...", width / 2, height / 2);
  }

  if (!modelIsReady || poses.length === 0) {
    return;
  }

  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];

    for (let j = 0; j < connections.length; j++) {
      const firstPoint = pose.keypoints[connections[j][0]];
      const secondPoint = pose.keypoints[connections[j][1]];

      if (firstPoint && secondPoint &&
          firstPoint.confidence > 0.1 && secondPoint.confidence > 0.1) {
        stroke(38, 145, 100);
        strokeWeight(3);
        line(width - firstPoint.x, firstPoint.y,
             width - secondPoint.x, secondPoint.y);
      }
    }

    for (let j = 0; j < pose.keypoints.length; j++) {
      const point = pose.keypoints[j];

      if (point.confidence > 0.1) {
        noStroke();
        fill(255, 215, 130);
        circle(width - point.x, point.y, 9);
      }
    }

    checkPose(pose.keypoints);
  }
}

function getBodyPoint(keypoints, pointName, backupIndex) {
  return keypoints.find(function (point) {
    return point.name === pointName;
  }) || keypoints[backupIndex];
}

function checkPose(keypoints) {
  const leftShoulder = getBodyPoint(keypoints, "left_shoulder", 11);
  const rightShoulder = getBodyPoint(keypoints, "right_shoulder", 12);
  const leftWrist = getBodyPoint(keypoints, "left_wrist", 15);
  const rightWrist = getBodyPoint(keypoints, "right_wrist", 16);

  const importantPoints = [
    leftShoulder, rightShoulder, leftWrist, rightWrist
  ];

  const pointsAreVisible = importantPoints.every(function (point) {
    return point && point.confidence > 0.25;
  });

  if (!pointsAreVisible) {
    // CHANGED: reset the hold timer when the player goes out of view.
    poseStartTime = null;
    document.querySelector("#feedback").textContent =
      "Move back so the camera can see both shoulders and wrists.";
    return;
  }

  const playerPoints = {
    leftShoulder: leftShoulder,
    rightShoulder: rightShoulder,
    leftWrist: leftWrist,
    rightWrist: rightWrist
  };

  const poseMatches = statues[currentStatue].matchesPose(playerPoints);

  if (poseMatches) {
    // CHANGED: hold time is measured in milliseconds instead of counting frames.
    if (poseStartTime === null) {
      poseStartTime = performance.now();
    }

    // CHANGED: "hold that pose" message no longer overwrites the "+10 points" message.
    if (!alreadyScored && !poseSwitchPending) {
      document.querySelector("#feedback").textContent =
        "Looking good! Hold that pose for a moment…";
    }

    const heldFor = performance.now() - poseStartTime;

    if (heldFor >= HOLD_TIME_MS && !alreadyScored && !poseSwitchPending) {
      score += 10;
      document.querySelector("#score").textContent = score;
      alreadyScored = true;
      poseSwitchPending = true;
      document.querySelector("#feedback").textContent =
        "Pose matched! +10 points — loading the next statue…";

      // CHANGED: the timeout is stored so chooseStatue() can cancel it.
      nextStatueTimeout = window.setTimeout(function () {
        nextStatueTimeout = null;
        chooseStatue((currentStatue + 1) % statues.length);
      }, 1200);
    }
  } else {
    poseStartTime = null;
    if (!alreadyScored && !poseSwitchPending) {
      document.querySelector("#feedback").textContent = redLight
        ? "Red light! Get into the pose and hold still."
        : "Try copying the statue. You only need to hold the pose briefly.";
    }
  }
}

function chooseStatue(index) {
  // CHANGED: cancel a pending auto-switch so manual picks don't skip an extra statue.
  if (nextStatueTimeout) {
    clearTimeout(nextStatueTimeout);
    nextStatueTimeout = null;
  }

  currentStatue = index;
  const statue = statues[index];

  document.querySelector("#statue-photo").src = statue.photo;
  document.querySelector("#statue-photo").alt = statue.name;
  document.querySelector("#statue-name").textContent = statue.name;
  document.querySelector("#statue-instruction").textContent =
    statue.instruction;
  // CHANGED: uses statues.length instead of a hard-coded 3.
  document.querySelector("#round-label").textContent =
    "Statue " + (index + 1) + " of " + statues.length;

  document.querySelectorAll(".choice").forEach(function (button, buttonIndex) {
    button.classList.toggle("selected", buttonIndex === index);
  });

  poseStartTime = null;
  alreadyScored = false;
  poseSwitchPending = false;
  document.querySelector("#feedback").textContent =
    "Copy this statue and hold the pose briefly to earn 10 points. The next statue switches automatically.";
}

function changeLight() {
  redLight = !redLight;

  const lightStatus = document.querySelector("#light-status");
  const lightInstruction = document.querySelector("#light-instruction");
  const lightButton = document.querySelector("#light-button");

  if (redLight) {
    lightStatus.textContent = "RED LIGHT";
    lightStatus.classList.add("red");
    lightInstruction.textContent = "Hold your pose and try not to move.";
    lightButton.textContent = "Green Light";
  } else {
    lightStatus.textContent = "GREEN LIGHT";
    lightStatus.classList.remove("red");
    lightInstruction.textContent = "Move into the pose.";
    lightButton.textContent = "Red Light";
  }

  poseStartTime = null;
  alreadyScored = false;

  // CHANGED: every light change resets the countdown, even when the auto timer is off.
  resetLightCountdown();
}

// CHANGED: new function.
function currentLightLength() {
  return (redLight ? RED_SECONDS : GREEN_SECONDS) * 1000;
}

// CHANGED: new function.
function resetLightCountdown() {
  msRemaining = currentLightLength();
  if (autoTimerRunning) {
    lightEndsAt = performance.now() + msRemaining;
  }
  updateTimerDisplay();
}

// CHANGED: new function; time left comes from the real clock so it doesn't drift.
function tickTimer() {
  msRemaining = lightEndsAt - performance.now();

  if (msRemaining <= 0) {
    changeLight();
  } else {
    updateTimerDisplay();
  }
}

function updateTimerDisplay() {
  const countdown = document.querySelector("#timer-countdown");
  const caption = document.querySelector("#timer-caption");

  // CHANGED: shows whole seconds from msRemaining.
  if (countdown) {
    countdown.textContent = Math.max(0, Math.ceil(msRemaining / 1000));
  }
  // CHANGED: adds "(auto timer off)" when the timer isn't running.
  if (caption) {
    let text = redLight
      ? "seconds until green light"
      : "seconds until red light";
    if (!autoTimerRunning) {
      text += " (auto timer off)";
    }
    caption.textContent = text;
  }
}

// CHANGED: new function; the timer button now pauses and resumes.
function toggleAutoTimer() {
  if (autoTimerRunning) {
    stopAutoTimer();
  } else {
    startAutoTimer();
  }
}

// CHANGED: rewritten to resume from the paused time instead of restarting.
function startAutoTimer() {
  if (autoTimerRunning) return;

  autoTimerRunning = true;
  lightEndsAt = performance.now() + msRemaining;
  timerInterval = setInterval(tickTimer, 100);

  document.querySelector("#timer-button").textContent = "Pause Auto Timer";
  updateTimerDisplay();
}

// CHANGED: rewritten to save the time left and show "Resume Auto Timer".
function stopAutoTimer() {
  if (!autoTimerRunning) return;

  msRemaining = Math.max(0, lightEndsAt - performance.now());
  autoTimerRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;

  document.querySelector("#timer-button").textContent = "Resume Auto Timer";
  updateTimerDisplay();
}

window.addEventListener("load", function () {
  // CHANGED: light button calls changeLight() directly; timer button uses toggleAutoTimer().
  document.querySelector("#light-button").addEventListener("click", changeLight);
  document.querySelector("#timer-button").addEventListener("click", toggleAutoTimer);
  updateTimerDisplay();

  document.querySelectorAll(".choice").forEach(function (button) {
    button.addEventListener("click", function () {
      chooseStatue(Number(button.dataset.index));
    });
  });

  document.querySelector("#next-button").addEventListener("click", function () {
    chooseStatue((currentStatue + 1) % statues.length);
  });
});
