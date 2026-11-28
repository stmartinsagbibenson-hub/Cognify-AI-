(() => {
  const screen = document.getElementById("introScreen");
  const video = document.getElementById("introVideo");
  if (!screen || !video) return;

  document.documentElement.classList.add("intro-playing");
  let finished = false;
  let fallbackTimer;

  function finishIntro() {
    if (finished) return;
    finished = true;
    window.clearTimeout(fallbackTimer);
    screen.classList.add("is-leaving");
    document.documentElement.classList.remove("intro-playing");
    video.pause();
    window.setTimeout(() => screen.remove(), 500);
  }

  video.addEventListener("ended", finishIntro, { once: true });
  video.addEventListener("error", finishIntro, { once: true });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishIntro();
    return;
  }

  // Fallback in case playback cannot start or the video stalls.
 video.pause();
video.currentTime = 0;

video.addEventListener("loadedmetadata", () => {
  video.currentTime = 0;
  video.play().catch(finishIntro);
}, { once: true });

fallbackTimer = window.setTimeout(finishIntro, 30000);

function startVideo() {
  video.currentTime = 0;

  const playback = video.play();
  if (playback && typeof playback.catch === "function") {
    playback.catch(finishIntro);
  }
}

if (video.readyState >= 1) {
  startVideo();
} else {
  video.addEventListener("loadedmetadata", startVideo, { once: true });
}
})();