document.addEventListener("DOMContentLoaded", () => {
  const heartCta = document.querySelector(".heart-cta");
  if (!heartCta) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function spawnFloatingHearts(x, y, count = 14) {
    if (prefersReducedMotion.matches) return;

    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      el.className = "floating-heart";
      el.textContent = "❤";

      const dx = (Math.random() - 0.5) * 160; // horizontal spread
      const dy = -80 - Math.random() * 140; // upward distance
      const rot = (Math.random() - 0.5) * 90; // rotation
      const dur = 1200 + Math.round(Math.random() * 900); // ms
      const hue = 320 + Math.round(Math.random() * 80);

      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.setProperty("--dx", `${dx}px`);
      el.style.setProperty("--dy", `${dy}px`);
      el.style.setProperty("--rot", `${rot}deg`);
      el.style.setProperty("--dur", `${dur}ms`);
      el.style.setProperty("--hue", `${hue}deg`);

      document.body.appendChild(el);
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }
  }

  heartCta.addEventListener("click", () => {
    const rect = heartCta.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    spawnFloatingHearts(centerX, centerY);
  });
});