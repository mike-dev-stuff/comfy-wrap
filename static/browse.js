// ── Browse page ────────────────────────────────────────────────────────────────

let offset = 0;
let loading = false;
let hasMore = true;
const LIMIT = 20;

document.addEventListener("DOMContentLoaded", () => {
  loadMore();
  initLightbox();
  initScroll();
});

function viewUrl(item) {
  return `/api/view?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(item.subfolder || "")}&type=${item.type || "output"}`;
}

function initScroll() {
  const main = document.querySelector(".browse-main");
  main.addEventListener("scroll", () => {
    if (loading || !hasMore) return;
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 200) {
      loadMore();
    }
  });
  // Also handle window scroll for non-fixed layouts
  window.addEventListener("scroll", () => {
    if (loading || !hasMore) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
      loadMore();
    }
  });
}

async function loadMore() {
  if (loading || !hasMore) return;
  loading = true;

  const grid = document.getElementById("browse-grid");
  const placeholder = document.getElementById("browse-placeholder");

  try {
    const resp = await fetch(`/api/outputs?offset=${offset}&limit=${LIMIT}`);
    const data = await resp.json();
    const items = data.items || [];
    hasMore = data.has_more;

    if (items.length === 0 && offset === 0) {
      placeholder.textContent = "No outputs yet";
      loading = false;
      return;
    }

    if (placeholder) placeholder.remove();

    for (const item of items) {
      const cell = document.createElement("div");
      cell.className = "browse-cell";

      if (item.media === "video") {
        const video = document.createElement("video");
        video.src = viewUrl(item);
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "metadata";
        // Seek to 0.1s once metadata loads to force a visible thumbnail frame
        video.addEventListener("loadedmetadata", () => { video.currentTime = 0.1; }, { once: true });
        cell.addEventListener("mouseenter", () => video.play());
        cell.addEventListener("mouseleave", () => { video.pause(); video.currentTime = 0.1; });
        cell.appendChild(video);
        const badge = document.createElement("span");
        badge.className = "browse-badge";
        badge.textContent = "VIDEO";
        cell.appendChild(badge);
      } else {
        const img = document.createElement("img");
        img.src = viewUrl(item);
        img.loading = "lazy";
        cell.appendChild(img);
      }

      cell.addEventListener("click", () => openLightbox(item));
      grid.appendChild(cell);
    }

    offset += items.length;
  } catch (err) {
    console.error("Failed to load outputs:", err);
    if (offset === 0 && placeholder) {
      placeholder.textContent = "Failed to load outputs";
    }
  }

  loading = false;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function initLightbox() {
  const lightbox = document.getElementById("lightbox");
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}

function openLightbox(item) {
  const lightbox = document.getElementById("lightbox");
  const content = document.getElementById("lightbox-content");
  content.innerHTML = "";

  if (item.media === "video") {
    const video = document.createElement("video");
    video.src = viewUrl(item);
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    content.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = viewUrl(item);
    content.appendChild(img);
  }

  lightbox.classList.add("active");
}

function closeLightbox() {
  const lightbox = document.getElementById("lightbox");
  const content = document.getElementById("lightbox-content");
  lightbox.classList.remove("active");
  content.innerHTML = "";
}
