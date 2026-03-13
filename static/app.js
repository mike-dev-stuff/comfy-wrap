// ── State ──────────────────────────────────────────────────────────────────────
let loraOptions = [];
let ws = null;
let wsClientId = null;
let currentPromptId = null;
let currentWorkflowType = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initUpload();
  initSidebarToggle();
  initOutputToggle();
  loadModels();
  loadLoras();
  loadSamplers();
  loadUnetModels();
  loadI2vLoras();
  connectWebSocket();

  document.getElementById("generate-btn").addEventListener("click", generate);
  document.getElementById("t2i-add-lora").addEventListener("click", addLoraRow);

  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });
});

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────
function initSidebarToggle() {
  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");

  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
    toggle.classList.remove("open");
  }

  toggle.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    overlay.classList.toggle("open", isOpen);
    toggle.classList.toggle("open", isOpen);
  });

  overlay.addEventListener("click", closeSidebar);
}

// ── Output panel toggle (mobile) ─────────────────────────────────────────────
function initOutputToggle() {
  const btn = document.getElementById("output-toggle");
  const panel = document.getElementById("main-panel");
  btn.addEventListener("click", () => {
    panel.classList.toggle("open");
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

// ── Load dropdowns (independent fetches) ──────────────────────────────────────
async function loadModels() {
  try {
    const resp = await fetch("/api/models");
    const data = await resp.json();
    populateSelect("t2i-model", data.models);
  } catch (err) {
    console.error("Failed to load models:", err);
    setSelectError("t2i-model", "Failed to load");
  }
}

async function loadLoras() {
  try {
    const resp = await fetch("/api/loras");
    const data = await resp.json();
    loraOptions = data.loras || [];
  } catch (err) {
    console.error("Failed to load LoRAs:", err);
  }
}

async function loadUnetModels() {
  try {
    const resp = await fetch("/api/unet_models");
    const data = await resp.json();
    populateSelect("i2v-high-model", data.models, "DasiwaWAN22I2V14BLightspeed_synthseductionHighV9.safetensors");
    populateSelect("i2v-low-model", data.models, "DasiwaWAN22I2V14BLightspeed_synthseductionLowV9.safetensors");
  } catch (err) {
    console.error("Failed to load UNET models:", err);
    setSelectError("i2v-high-model", "Failed to load");
    setSelectError("i2v-low-model", "Failed to load");
  }
}

async function loadI2vLoras() {
  try {
    const resp = await fetch("/api/i2v_loras");
    const data = await resp.json();
    populateSelect("i2v-high-lora", data.loras, "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors");
    populateSelect("i2v-low-lora", data.loras, "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors");
  } catch (err) {
    console.error("Failed to load I2V LoRAs:", err);
    setSelectError("i2v-high-lora", "Failed to load");
    setSelectError("i2v-low-lora", "Failed to load");
  }
}

async function loadSamplers() {
  try {
    const resp = await fetch("/api/samplers");
    const data = await resp.json();
    populateSelect("t2i-sampler", data.samplers, "euler");
    populateSelect("t2i-scheduler", data.schedulers, "normal");
  } catch (err) {
    console.error("Failed to load samplers:", err);
    setSelectError("t2i-sampler", "Failed to load");
    setSelectError("t2i-scheduler", "Failed to load");
  }
}

function populateSelect(id, items, defaultVal) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";
  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    if (item === defaultVal) opt.selected = true;
    sel.appendChild(opt);
  });
}

function setSelectError(id, msg) {
  const sel = document.getElementById(id);
  sel.innerHTML = `<option>${msg}</option>`;
}

// ── LoRA rows ─────────────────────────────────────────────────────────────────
function addLoraRow() {
  const container = document.getElementById("t2i-lora-list");
  const row = document.createElement("div");
  row.className = "lora-row";

  const sel = document.createElement("select");
  sel.className = "lora-select";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "-- Select LoRA --";
  sel.appendChild(noneOpt);
  loraOptions.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  const strength = document.createElement("input");
  strength.type = "number";
  strength.className = "lora-strength";
  strength.value = "1.0";
  strength.step = "0.1";
  strength.min = "-2";
  strength.max = "2";

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove";
  removeBtn.textContent = "\u00d7";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(sel, strength, removeBtn);
  container.appendChild(row);
}

function getSelectedLoras() {
  const rows = document.querySelectorAll("#t2i-lora-list .lora-row");
  const loras = [];
  rows.forEach(row => {
    const name = row.querySelector(".lora-select").value;
    const strength = parseFloat(row.querySelector(".lora-strength").value);
    if (name) loras.push({ name, strength });
  });
  return loras;
}

// ── Image upload ──────────────────────────────────────────────────────────────
function initUpload() {
  const area = document.getElementById("i2v-upload-area");
  const input = document.getElementById("i2v-image");
  const nameSpan = document.getElementById("i2v-image-name");

  area.addEventListener("dragover", e => { e.preventDefault(); area.classList.add("dragover"); });
  area.addEventListener("dragleave", () => area.classList.remove("dragover"));
  area.addEventListener("drop", e => {
    e.preventDefault();
    area.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      nameSpan.textContent = e.dataTransfer.files[0].name;
    }
  });

  input.addEventListener("change", () => {
    if (input.files.length) nameSpan.textContent = input.files[0].name;
  });
}

async function uploadImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await resp.json();
  return data.name;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWSMessage(data);
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// ── Visibility change (mobile app switch recovery) ───────────────────────────
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Force a repaint — iOS Safari can freeze rendering after tab switch
    document.body.style.display = "none";
    document.body.offsetHeight; // force reflow
    document.body.style.display = "";

    // Reconnect WebSocket if it was dropped
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
    // Check if a generation finished while we were away
    if (currentPromptId) {
      checkResult(currentPromptId);
    }
  }
});

async function checkResult(promptId) {
  try {
    const resp = await fetch(`/api/history/${promptId}`);
    const data = await resp.json();
    if (data[promptId] && data[promptId].outputs) {
      fetchResult(promptId);
    }
  } catch (_) {
    // Network error — will retry on next visibility change
  }
}

function handleWSMessage(data) {
  if (data.type === "client_id") {
    wsClientId = data.client_id;
  } else if (data.type === "progress") {
    const pct = Math.round((data.data.value / data.data.max) * 100);
    showProgress(pct);
  } else if (data.type === "executing") {
    if (data.data.node === null && data.data.prompt_id === currentPromptId) {
      showProgress(100);
      fetchResult(currentPromptId);
    }
  }
}

// ── Progress ──────────────────────────────────────────────────────────────────
function showProgress(pct) {
  const bar = document.getElementById("header-progress");
  const fill = document.getElementById("header-progress-fill");
  bar.classList.add("active");
  fill.style.width = pct + "%";
}

function hideProgress() {
  const bar = document.getElementById("header-progress");
  const fill = document.getElementById("header-progress-fill");
  bar.classList.remove("active");
  fill.style.width = "0%";
}

// ── Generate ──────────────────────────────────────────────────────────────────
function generate() {
  const activeTab = document.querySelector(".tab-content.active");
  if (activeTab.id === "t2i") generateT2I();
  else if (activeTab.id === "i2v") generateI2V();
}

function setGenerating(state) {
  document.getElementById("generate-btn").disabled = state;
}

async function generateT2I() {
  const params = {
    type: "t2i",
    model: document.getElementById("t2i-model").value,
    positive: document.getElementById("t2i-positive").value,
    negative: document.getElementById("t2i-negative").value,
    loras: getSelectedLoras(),
    width: parseInt(document.getElementById("t2i-width").value),
    height: parseInt(document.getElementById("t2i-height").value),
    steps: parseInt(document.getElementById("t2i-steps").value),
    cfg: parseFloat(document.getElementById("t2i-cfg").value),
    seed: parseInt(document.getElementById("t2i-seed").value),
    sampler_name: document.getElementById("t2i-sampler").value,
    scheduler: document.getElementById("t2i-scheduler").value,
    denoise: parseFloat(document.getElementById("t2i-denoise").value),
  };

  currentWorkflowType = "t2i";
  await submitGeneration(params);
}

async function generateI2V() {
  const fileInput = document.getElementById("i2v-image");
  if (!fileInput.files.length) {
    alert("Please select an input image.");
    return;
  }

  setGenerating(true);
  showProgress(0);

  let imageName;
  try {
    imageName = await uploadImage(fileInput.files[0]);
  } catch (err) {
    alert("Image upload failed: " + err.message);
    setGenerating(false);
    hideProgress();
    return;
  }

  const params = {
    type: "i2v",
    positive: document.getElementById("i2v-positive").value,
    negative: document.getElementById("i2v-negative").value,
    image: imageName,
    high_model: document.getElementById("i2v-high-model").value,
    low_model: document.getElementById("i2v-low-model").value,
    high_lora: document.getElementById("i2v-high-lora").value,
    low_lora: document.getElementById("i2v-low-lora").value,
    width: parseInt(document.getElementById("i2v-width").value),
    height: parseInt(document.getElementById("i2v-height").value),
    length: parseInt(document.getElementById("i2v-length").value),
    fps: parseInt(document.getElementById("i2v-fps").value),
    seed: parseInt(document.getElementById("i2v-seed").value),
  };

  currentWorkflowType = "i2v";
  await submitGeneration(params);
}

async function submitGeneration(params) {
  setGenerating(true);
  showProgress(0);

  try {
    params.client_id = wsClientId;
    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await resp.json();

    if (data.error) {
      alert("Error: " + JSON.stringify(data.error));
      setGenerating(false);
      hideProgress();
      return;
    }

    currentPromptId = data.prompt_id;
    showProgress(0);
  } catch (err) {
    alert("Generation failed: " + err.message);
    setGenerating(false);
    hideProgress();
  }
}

// ── Fetch result ──────────────────────────────────────────────────────────────
async function fetchResult(promptId) {
  let attempts = 0;
  const poll = async () => {
    attempts++;
    let data;
    try {
      const resp = await fetch(`/api/history/${promptId}`);
      data = await resp.json();
    } catch (_) {
      if (attempts < 30) { setTimeout(poll, 2000); return; }
      setGenerating(false);
      hideProgress();
      return;
    }

    if (!data[promptId] || !data[promptId].outputs) {
      if (attempts < 30) {
        setTimeout(poll, 1000);
        return;
      }
      setGenerating(false);
      hideProgress();
      return;
    }

    const outputs = data[promptId].outputs;
    const outputDiv = document.getElementById("output-section");

    // Clear placeholder text on first result
    const placeholder = outputDiv.querySelector(".placeholder-text");
    if (placeholder) placeholder.remove();

    for (const nodeId of Object.keys(outputs)) {
      const nodeOutput = outputs[nodeId];

      if (nodeOutput.images) {
        for (const img of nodeOutput.images) {
          const url = `/api/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${img.type || "output"}`;
          const el = document.createElement("img");
          el.src = url;
          outputDiv.prepend(el);
        }
      }

      // Video output — ComfyUI nodes may use "videos" or "gifs" as the key
      const videoList = nodeOutput.videos || nodeOutput.gifs;
      if (videoList) {
        for (const vid of videoList) {
          const url = `/api/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || "")}&type=${vid.type || "output"}`;
          const el = document.createElement("video");
          el.src = url;
          el.controls = true;
          el.autoplay = true;
          el.loop = true;
          outputDiv.prepend(el);
        }
      }
    }

    currentPromptId = null;
    setGenerating(false);
    hideProgress();
  };

  poll();
}
