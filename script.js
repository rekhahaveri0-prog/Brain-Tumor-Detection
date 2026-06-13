/* ============================================================
   BrainFind — Frontend JavaScript
   Communicates with Flask backend at http://127.0.0.1:5000
   ============================================================ */

const API_BASE = "http://127.0.0.1:5000";

/* ── State ──────────────────────────────────────────────────── */
let currentUser = null;
let selectedFile = null;
let lastPredictionData = null;
let lastElapsed = null;

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initNavigation();
  initUpload();
  initAnimations();
  checkBackendStatus();
});

/* ── Backend Status Check ───────────────────────────────────── */
async function checkBackendStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    // Status check — no popup shown regardless of mode
  } catch {
    // Backend not running — silent, will show error on predict attempt
  }
}

/* ══════════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════════ */
function initNavigation() {
  // Nav link clicks
  document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
    });
  });

  // Logo
  const logoLink = document.getElementById("nav-logo-link");
  if (logoLink) {
    logoLink.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("home");
    });
  }

  // Hero buttons
  const heroStart = document.getElementById("hero-get-started");
  if (heroStart) {
    heroStart.addEventListener("click", () => {
      navigateTo(currentUser ? "upload" : "login");
    });
  }

  const heroLearn = document.getElementById("hero-learn-more");
  if (heroLearn) {
    heroLearn.addEventListener("click", () => {
      document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  // Auth cross-links
  document.getElementById("goto-register")?.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("register");
  });
  document.getElementById("goto-login")?.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("login");
  });

  // Logout
  document.getElementById("nav-logout")?.addEventListener("click", logout);

  // Mobile menu
  const mobileBtn = document.getElementById("mobile-menu-btn");
  const navLinks = document.querySelector(".nav-links");
  if (mobileBtn && navLinks) {
    mobileBtn.addEventListener("click", () => {
      navLinks.classList.toggle("open");
      mobileBtn.classList.toggle("active");
    });
  }

  // Navbar scroll effect
  window.addEventListener("scroll", () => {
    const navbar = document.getElementById("navbar");
    if (navbar) {
      navbar.classList.toggle("scrolled", window.scrollY > 20);
    }
  });
}

function navigateTo(page) {
  // Guard: upload & records page require login
  if ((page === "upload" || page === "records") && !currentUser) {
    showToast("Please sign in to access this page.", "warning");
    page = "login";
  }

  // Refresh history logs automatically when visiting the records page
  if (page === "records") {
    renderHistoryTable();
  }

  // Hide all pages
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));

  // Show target page
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add("active");

  // Highlight nav link
  const navLink = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (navLink) navLink.classList.add("active");

  // Scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ══════════════════════════════════════════════════════════════
   AUTH  (localStorage-based, no real backend user store)
   ══════════════════════════════════════════════════════════════ */
function initAuth() {
  // Restore session
  const saved = localStorage.getItem("brainfind_user");
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      updateNavForAuth();
    } catch {
      localStorage.removeItem("brainfind_user");
    }
  }

  // Pre-fill remembered credentials if they exist
  const rememberedEmail = localStorage.getItem("brainfind_remembered_email");
  const rememberedPassword = localStorage.getItem("brainfind_remembered_password");
  if (rememberedEmail && rememberedPassword) {
    const emailInput = document.getElementById("login-email");
    const passwordInput = document.getElementById("login-password");
    const rememberCheckbox = document.getElementById("remember-me");
    if (emailInput) emailInput.value = rememberedEmail;
    if (passwordInput) {
      try {
        passwordInput.value = atob(rememberedPassword);
      } catch {
        passwordInput.value = rememberedPassword;
      }
    }
    if (rememberCheckbox) rememberCheckbox.checked = true;
  }

  // Login form
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleLogin();
    });
  }

  // Register form
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleRegister();
    });
  }

  // Password strength meter
  const regPassword = document.getElementById("reg-password");
  if (regPassword) {
    regPassword.addEventListener("input", updatePasswordStrength);
  }

  // Toggle password visibility
  document.querySelectorAll(".toggle-password").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === "password" ? "text" : "password";
      }
    });
  });
}

async function handleLogin() {
  const email = document.getElementById("login-email")?.value.trim();
  const password = document.getElementById("login-password")?.value;
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("login-submit");
  const rememberMe = document.getElementById("remember-me")?.checked;

  hideError(errorEl);
  setButtonLoading(btn, true);

  // Simulate async check (localStorage users)
  await delay(700);

  const users = getStoredUsers();
  const user = users.find((u) => u.email === email);

  if (!user || user.password !== btoa(password)) {
    showError(errorEl, "Invalid email or password.");
    setButtonLoading(btn, false);
    return;
  }

  currentUser = { name: user.name, email: user.email };
  localStorage.setItem("brainfind_user", JSON.stringify(currentUser));

  // Handle Remember Me credentials saving
  if (rememberMe) {
    localStorage.setItem("brainfind_remembered_email", email);
    localStorage.setItem("brainfind_remembered_password", btoa(password));
  } else {
    localStorage.removeItem("brainfind_remembered_email");
    localStorage.removeItem("brainfind_remembered_password");
  }

  setButtonLoading(btn, false);
  updateNavForAuth();
  showToast(`Welcome back, ${user.name}! 👋`, "success");
  navigateTo("upload");
}

async function handleRegister() {
  const firstName = (document.getElementById("reg-firstname")?.value || "").trim();
  const lastName = (document.getElementById("reg-lastname")?.value || "").trim();
  const email = (document.getElementById("reg-email")?.value || "").trim();
  const password = document.getElementById("reg-password")?.value || "";
  const confirm = document.getElementById("reg-confirm")?.value || "";
  const errorEl = document.getElementById("register-error");
  const successEl = document.getElementById("register-success");
  const btn = document.getElementById("register-submit");

  hideError(errorEl);
  hideSuccess(successEl);

  // ── Validation ───────────────────────────────────────────────
  if (!firstName) {
    showError(errorEl, "⚠ Please enter your first name.");
    return;
  }
  if (!lastName) {
    showError(errorEl, "⚠ Please enter your last name.");
    return;
  }
  if (!email || !email.includes("@")) {
    showError(errorEl, "⚠ Please enter a valid email address.");
    return;
  }
  if (password.length < 6) {
    showError(errorEl, "⚠ Password must be at least 6 characters.");
    return;
  }
  if (password !== confirm) {
    showError(errorEl, "⚠ Passwords do not match. Please re-enter.");
    return;
  }
  // Terms checkbox is optional — just proceed without blocking

  // ── Save & Sign In ───────────────────────────────────────────
  setButtonLoading(btn, true);
  await delay(600);

  const users = getStoredUsers();
  if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    showError(errorEl, "⚠ An account with this email already exists. Please sign in.");
    setButtonLoading(btn, false);
    return;
  }

  const newUser = { name: `${firstName} ${lastName}`, email, password: btoa(password) };
  users.push(newUser);
  localStorage.setItem("brainfind_users", JSON.stringify(users));

  // Auto sign-in
  currentUser = { name: newUser.name, email: newUser.email };
  localStorage.setItem("brainfind_user", JSON.stringify(currentUser));

  setButtonLoading(btn, false);
  showSuccess(successEl, `✅ Account created! Welcome, ${firstName}!`);

  await delay(900);
  updateNavForAuth();
  showToast(`Welcome to BrainFind, ${firstName}! 🎉`, "success");
  navigateTo("upload");
}

function logout() {
  currentUser = null;
  localStorage.removeItem("brainfind_user");
  updateNavForAuth();
  navigateTo("home");
  showToast("You've been signed out.", "info");
}

function updateNavForAuth() {
  const navLogin = document.getElementById("nav-login");
  const navRegister = document.getElementById("nav-register");
  const navUpload = document.getElementById("nav-upload");
  const navRecords = document.getElementById("nav-records");
  const navLogout = document.getElementById("nav-logout");

  if (currentUser) {
    navLogin?.classList.add("hidden");
    navRegister?.classList.add("hidden");
    navUpload?.classList.remove("hidden");
    navRecords?.classList.remove("hidden");
    navLogout?.classList.remove("hidden");
    if (navLogout) navLogout.textContent = `Logout (${currentUser.name.split(" ")[0]})`;
  } else {
    navLogin?.classList.remove("hidden");
    navRegister?.classList.remove("hidden");
    navUpload?.classList.add("hidden");
    navRecords?.classList.add("hidden");
    navLogout?.classList.add("hidden");
  }
}

function getStoredUsers() {
  try {
    return JSON.parse(localStorage.getItem("brainfind_users") || "[]");
  } catch {
    return [];
  }
}

function updatePasswordStrength() {
  const password = document.getElementById("reg-password")?.value || "";
  const fill = document.getElementById("strength-fill");
  const text = document.getElementById("strength-text");
  if (!fill || !text) return;

  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { label: "", color: "transparent", width: "0%" },
    { label: "Weak", color: "#ef4444", width: "25%" },
    { label: "Fair", color: "#f59e0b", width: "50%" },
    { label: "Good", color: "#3b82f6", width: "75%" },
    { label: "Strong", color: "#10b981", width: "100%" },
  ];

  const level = levels[Math.min(score, 4)];
  fill.style.width = level.width;
  fill.style.background = level.color;
  text.textContent = level.label;
  text.style.color = level.color;
}

/* ══════════════════════════════════════════════════════════════
   FILE UPLOAD & PREDICTION
   ══════════════════════════════════════════════════════════════ */
function initUpload() {
  const dropzone = document.getElementById("upload-dropzone");
  const fileInput = document.getElementById("file-input");
  const analyzeBtn = document.getElementById("analyze-btn");
  const removeBtn = document.getElementById("remove-image");
  const newScanBtn = document.getElementById("new-scan-btn");

  if (!dropzone || !fileInput) return;

  // Click to open file dialog
  dropzone.addEventListener("click", (e) => {
    if (!e.target.closest(".remove-image")) {
      fileInput.click();
    }
  });

  // File selected via dialog
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
  });

  // Drag & Drop
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  });

  // Remove image
  removeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    clearFile();
  });

  // Analyze button
  analyzeBtn?.addEventListener("click", runPrediction);

  // New scan button
  newScanBtn?.addEventListener("click", () => {
    clearFile();
    document.getElementById("results-panel")?.classList.add("hidden");
    document.getElementById("delete-case-btn")?.classList.add("hidden");
  });

  // Save case UI logic
  const saveCaseBtn = document.getElementById("save-case-btn");
  saveCaseBtn?.addEventListener("click", () => {
    if (selectedFile && lastPredictionData) {
      let patientId = selectedFile.name.split('.')[0];
      if (!patientId || ["image", "file", "upload", "mri", "brain", "scan", "scan-preview"].includes(patientId.toLowerCase())) {
        const d = new Date();
        const dateStr = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
        patientId = `Patient-${dateStr}-${timeStr}`;
      }
      saveCurrentCase(patientId);
    }
  });

  const clearHistoryBtn = document.getElementById("clear-history-btn");
  clearHistoryBtn?.addEventListener("click", clearHistoryLog);

  // Load Saved Cases Log Table
  renderHistoryTable();
}

function handleFileSelect(file) {
  const allowed = ["image/jpeg", "image/png", "image/bmp", "image/webp"];
  if (!allowed.includes(file.type)) {
    showToast("Please upload a JPG, PNG, BMP, or WebP image.", "error");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast("Image must be smaller than 20 MB.", "error");
    return;
  }

  selectedFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById("dropzone-preview");
    const content = document.getElementById("dropzone-content");
    const img = document.getElementById("preview-image");
    if (img) img.src = e.target.result;
    preview?.classList.remove("hidden");
    content?.classList.add("hidden");

    // Update image size detail
    const imgSizeEl = document.getElementById("image-size");
    if (imgSizeEl) imgSizeEl.textContent = `${file.name} (${formatBytes(file.size)})`;
  };
  reader.readAsDataURL(file);

  const analyzeBtn = document.getElementById("analyze-btn");
  if (analyzeBtn) analyzeBtn.disabled = false;

  // Hide old results
  document.getElementById("results-panel")?.classList.add("hidden");
}

function clearFile() {
  selectedFile = null;
  const fileInput = document.getElementById("file-input");
  if (fileInput) fileInput.value = "";

  document.getElementById("dropzone-preview")?.classList.add("hidden");
  document.getElementById("dropzone-content")?.classList.remove("hidden");
  document.getElementById("highlighted-scan-wrapper")?.classList.add("hidden");
  const imgEl = document.getElementById("highlighted-scan-img");
  if (imgEl) imgEl.src = "";

  const analyzeBtn = document.getElementById("analyze-btn");
  if (analyzeBtn) analyzeBtn.disabled = true;
}

async function runPrediction() {
  if (!selectedFile) return;

  const analyzeBtn = document.getElementById("analyze-btn");
  const resultsPanel = document.getElementById("results-panel");

  setButtonLoading(analyzeBtn, true);
  const startTime = Date.now();

  try {
    const formData = new FormData();
    formData.append("image", selectedFile);

    const res = await fetch(`${API_BASE}/predict`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Server error" }));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Show results
    displayResults(data, elapsed);
    resultsPanel?.classList.remove("hidden");
    resultsPanel?.scrollIntoView({ behavior: "smooth", block: "start" });

    // Automatically refresh history table
    renderHistoryTable();
    showToast("Case automatically saved to SQL database.", "success");

    // No mode popup shown
  } catch (err) {
    let msg = err.message;
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      msg = "Cannot connect to backend. Make sure the Flask server is running on port 5000.";
    }
    showToast(`Error: ${msg}`, "error", 6000);
  } finally {
    setButtonLoading(analyzeBtn, false);
  }
}

function displayResults(data, elapsed) {
  lastPredictionData = data;
  lastElapsed = elapsed;

  const { label, score, confidence_percent, tumor_detected, mode, db_id } = data;

  // Auto-Save Status Badge
  const saveCaseBtn = document.getElementById("save-case-btn");
  if (saveCaseBtn) {
    saveCaseBtn.textContent = "✓ Auto-Saved to DB";
    saveCaseBtn.disabled = true;
    saveCaseBtn.style.background = "rgba(16, 185, 129, 0.15)";
    saveCaseBtn.style.color = "#10b981";
    saveCaseBtn.style.border = "1px solid rgba(16, 185, 129, 0.4)";
  }

  // Delete button logic on results panel
  const deleteCaseBtn = document.getElementById("delete-case-btn");
  if (deleteCaseBtn && db_id) {
    deleteCaseBtn.classList.remove("hidden");
    let pId = data.patient_id;
    if (!pId && selectedFile) {
      pId = selectedFile.name.split('.')[0];
    }
    if (!pId || ["image", "file", "upload", "mri", "brain", "scan", "scan-preview"].includes(pId.toLowerCase())) {
      pId = "Current Patient";
    }
    deleteCaseBtn.onclick = () => deleteCaseFromResults(db_id, pId);
  } else if (deleteCaseBtn) {
    deleteCaseBtn.classList.add("hidden");
  }

  // Status icon & label
  const statusIcon = document.getElementById("status-icon");
  const resultLabel = document.getElementById("result-label");
  const resultDesc = document.getElementById("result-description");

  if (tumor_detected) {
    if (statusIcon) {
      statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      statusIcon.style.color = "#ef4444";
    }
    if (resultLabel) {
      resultLabel.textContent = "Tumor Detected";
      resultLabel.style.color = "#ef4444";
    }
    if (resultDesc) resultDesc.textContent = "The AI model detected signs of a brain tumor. Please consult a medical professional for proper diagnosis.";
    document.getElementById("result-card")?.setAttribute("data-result", "positive");
  } else {
    if (statusIcon) {
      statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
      statusIcon.style.color = "#10b981";
    }
    if (resultLabel) {
      resultLabel.textContent = "No Tumor Detected";
      resultLabel.style.color = "#10b981";
    }
    if (resultDesc) resultDesc.textContent = "The AI model found no signs of a brain tumor. Continue with regular check-ups as recommended by your doctor.";
    document.getElementById("result-card")?.setAttribute("data-result", "negative");
  }

  // Confidence bar
  const confFill = document.getElementById("confidence-fill");
  const confValue = document.getElementById("confidence-value");
  const displayConf = confidence_percent ?? (tumor_detected ? score * 100 : (1 - score) * 100);

  if (confFill) {
    confFill.style.width = "0%";
    setTimeout(() => {
      confFill.style.width = `${displayConf.toFixed(1)}%`;
      confFill.style.background = tumor_detected
        ? "linear-gradient(90deg,#ef4444,#f97316)"
        : "linear-gradient(90deg,#6C63FF,#10b981)";
    }, 100);
  }
  if (confValue) confValue.textContent = `${displayConf.toFixed(1)}%`;

  // Details
  const timeEl = document.getElementById("analysis-time");
  if (timeEl) timeEl.textContent = `${elapsed}s`;

  // Mode badge in model name
  const modelDetail = document.querySelector(".detail-value");
  if (modelDetail) {
    if (mode === "real") modelDetail.textContent = "MobileNetV2 (TensorFlow)";
    else if (mode === "opencv") modelDetail.textContent = "OpenCV Pixel Analysis";
    else modelDetail.textContent = "MobileNetV2";
  }

  // ── Highlighted scan image ────────────────────────────────────
  const wrapper = document.getElementById("highlighted-scan-wrapper");
  const imgEl = document.getElementById("highlighted-scan-img");
  const legendEl = document.getElementById("highlighted-scan-legend");

  if (data.highlighted_image && imgEl && wrapper) {
    imgEl.src = data.highlighted_image;
    wrapper.classList.remove("hidden");

    if (legendEl) {
      if (tumor_detected) {
        legendEl.innerHTML = `
          <span class="legend-dot" style="background:#ff5500;"></span>
          <span>Orange ellipse marks the <strong>detected tumor region</strong>. Consult a specialist.</span>
        `;
      } else {
        legendEl.innerHTML = `
          <span class="legend-dot" style="background:#10b981;"></span>
          <span>No tumor region highlighted — scan appears <strong>clear</strong>.</span>
        `;
      }
    }
  } else if (wrapper) {
    wrapper.classList.add("hidden");
  }
}

/* ══════════════════════════════════════════════════════════════
   ANIMATIONS
   ══════════════════════════════════════════════════════════════ */
function initAnimations() {
  // Counter animation for hero stats
  const counters = document.querySelectorAll(".stat-number[data-count]");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );
  counters.forEach((el) => observer.observe(el));
}

function animateCounter(el) {
  const target = parseFloat(el.dataset.count);
  const isDecimal = target % 1 !== 0;
  const duration = 1800;
  const start = performance.now();

  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = target * eased;
    el.textContent = isDecimal ? value.toFixed(1) : Math.floor(value).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════════════════════════════════ */
function showToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const colors = {
    success: "#10b981",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#6C63FF",
  };

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.style.cssText = `
    background: rgba(15,15,35,0.95);
    border: 1px solid ${colors[type] || colors.info}44;
    border-left: 4px solid ${colors[type] || colors.info};
    color: #e2e8f0;
    padding: 14px 20px;
    border-radius: 10px;
    margin-top: 10px;
    max-width: 400px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    line-height: 1.5;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    transform: translateX(100%);
    transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease;
    opacity: 0;
    cursor: pointer;
  `;
  toast.textContent = message;
  toast.addEventListener("click", () => removeToast(toast));

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = "translateX(0)";
    toast.style.opacity = "1";
  });

  setTimeout(() => removeToast(toast), duration);
}

function removeToast(toast) {
  toast.style.transform = "translateX(110%)";
  toast.style.opacity = "0";
  setTimeout(() => toast.remove(), 350);
}

/* ══════════════════════════════════════════════════════════════
   UI HELPERS
   ══════════════════════════════════════════════════════════════ */
function setButtonLoading(btn, loading) {
  if (!btn) return;
  const textEl = btn.querySelector(".btn-text");
  const loaderEl = btn.querySelector(".btn-loader");
  btn.disabled = loading;
  textEl?.classList.toggle("hidden", loading);
  loaderEl?.classList.toggle("hidden", !loading);
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

function showSuccess(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideSuccess(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ══════════════════════════════════════════════════════════════
   CLINICAL CASES HISTORY LOG (SQLITE DB INTEGRATION)
   ══════════════════════════════════════════════════════════════ */
let savedCasesList = [];

async function saveCurrentCase(patientId) {
  if (!lastPredictionData) return;

  const payload = {
    patient_id: patientId,
    elapsed: lastElapsed,
    data: lastPredictionData
  };

  try {
    const res = await fetch(`${API_BASE}/api/cases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    showToast(`Clinical report saved successfully to Database for Patient: ${patientId}`, "success");
    renderHistoryTable();
  } catch (err) {
    showToast(`Failed to save report to Database: ${err.message}`, "error");
  }
}

async function renderHistoryTable() {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/cases`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    savedCasesList = await res.json();

    if (savedCasesList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding: 24px 8px; text-align: center; color: rgba(255,255,255,0.4);">No saved patient reports found. Save a case above to store it in the database.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = savedCasesList.map((item, index) => {
      const isTumor = item.tumor_detected;
      const diagBadge = isTumor
        ? `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem; border: 1px solid rgba(239, 68, 68, 0.3);">Tumor Detected</span>`
        : `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem; border: 1px solid rgba(16, 185, 129, 0.3);">No Tumor</span>`;

      const conf = item.confidence_percent;

      // Exact sizing display from region metrics
      let sizeStr = "—";
      if (isTumor && item.region) {
        const area = item.region.area_px * 0.25;
        const diam = 2.0 * Math.sqrt(area / Math.PI);
        sizeStr = `${area.toFixed(1)} mm² (Ø ${diam.toFixed(1)} mm)`;
      }

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.2s;">
          <td style="padding: 14px 8px; font-weight: 600; color: #fff;">${item.patient_id}</td>
          <td style="padding: 14px 8px; color: rgba(255,255,255,0.7);">${item.timestamp}</td>
          <td style="padding: 14px 8px;">${diagBadge}</td>
          <td style="padding: 14px 8px; font-weight: 600; color: ${isTumor ? '#ef4444' : '#10b981'};">${conf.toFixed(1)}%</td>
          <td style="padding: 14px 8px; color: rgba(255,255,255,0.7);">${sizeStr}</td>
          <td style="padding: 14px 8px; text-align: right;">
            <button class="btn btn-glass btn-sm" onclick="viewSavedCase(${index})" style="font-size: 0.75rem; padding: 6px 12px; background: rgba(108, 99, 255, 0.1); border-color: rgba(108, 99, 255, 0.3); color: #8c85ff; font-weight: 500; margin-right: 8px;">View Report</button>
            <button class="btn btn-glass btn-sm" onclick="deleteSavedCase(${item.db_id}, '${item.patient_id}')" style="font-size: 0.75rem; padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #ef4444; font-weight: 500;">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 24px 8px; text-align: center; color: #ef4444;">Failed to load saved cases from Database: ${err.message}</td>
      </tr>
    `;
  }
}

window.viewSavedCase = function (index) {
  const item = savedCasesList[index];
  if (!item) return;

  // Navigate to the Upload (Analyze) page first so the results are visible
  navigateTo("upload");

  const resultsPanel = document.getElementById("results-panel");

  // Reconstruct UI prediction structure
  const reconData = {
    label: item.label,
    score: item.score,
    confidence_percent: item.confidence_percent,
    tumor_detected: item.tumor_detected,
    highlighted_image: item.highlighted_image,
    region: item.region,
    mode: item.mode,
    db_id: item.db_id,
    patient_id: item.patient_id
  };

  displayResults(reconData, item.elapsed);

  // Label details as load from database
  const modelDetail = document.querySelector(".detail-value");
  if (modelDetail) {
    modelDetail.textContent = `DB Record [${item.patient_id}]`;
  }

  resultsPanel?.classList.remove("hidden");
  setTimeout(() => {
    resultsPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);

  showToast(`Loaded Database Report for Patient ID: ${item.patient_id}`, "info");
};

window.deleteSavedCase = async function (dbId, patientId) {
  if (confirm(`Are you sure you want to delete the clinical report for Patient: ${patientId}? This action is permanent.`)) {
    try {
      const res = await fetch(`${API_BASE}/api/cases/${dbId}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      showToast(`Case for Patient ${patientId} successfully deleted from Database.`, "success");

      // If the currently viewed case in Results Panel is the one being deleted, reset the save and delete buttons
      if (lastPredictionData && (lastPredictionData.db_id === dbId || lastPredictionData.patient_id === patientId)) {
        const saveCaseBtn = document.getElementById("save-case-btn");
        if (saveCaseBtn) {
          saveCaseBtn.textContent = "Save Case";
          saveCaseBtn.disabled = false;
          saveCaseBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
          saveCaseBtn.style.color = "#fff";
          saveCaseBtn.style.border = "none";
        }
        const deleteCaseBtn = document.getElementById("delete-case-btn");
        if (deleteCaseBtn) {
          deleteCaseBtn.classList.add("hidden");
        }
        delete lastPredictionData.db_id;
      }

      renderHistoryTable();
    } catch (err) {
      showToast(`Failed to delete case: ${err.message}`, "error");
    }
  }
};

async function deleteCaseFromResults(dbId, patientId) {
  if (confirm(`Are you sure you want to delete the clinical report for Patient: ${patientId}? This action is permanent.`)) {
    try {
      const res = await fetch(`${API_BASE}/api/cases/${dbId}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      showToast(`Case for Patient ${patientId} successfully deleted from Database.`, "success");

      const saveCaseBtn = document.getElementById("save-case-btn");
      if (saveCaseBtn) {
        saveCaseBtn.textContent = "Save Case";
        saveCaseBtn.disabled = false;
        saveCaseBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
        saveCaseBtn.style.color = "#fff";
        saveCaseBtn.style.border = "none";
      }

      const deleteCaseBtn = document.getElementById("delete-case-btn");
      if (deleteCaseBtn) {
        deleteCaseBtn.classList.add("hidden");
      }

      if (lastPredictionData) {
        delete lastPredictionData.db_id;
      }

      renderHistoryTable();
    } catch (err) {
      showToast(`Failed to delete case: ${err.message}`, "error");
    }
  }
}

async function clearHistoryLog() {
  if (confirm("Are you sure you want to delete all saved patient logs from the Database? This action is permanent.")) {
    try {
      const res = await fetch(`${API_BASE}/api/cases/clear`, {
        method: "POST"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("All clinical records cleared from Database.", "info");

      // Reset currently viewed prediction save/delete button states
      const saveCaseBtn = document.getElementById("save-case-btn");
      if (saveCaseBtn) {
        saveCaseBtn.textContent = "Save Case";
        saveCaseBtn.disabled = false;
        saveCaseBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
        saveCaseBtn.style.color = "#fff";
        saveCaseBtn.style.border = "none";
      }
      const deleteCaseBtn = document.getElementById("delete-case-btn");
      if (deleteCaseBtn) {
        deleteCaseBtn.classList.add("hidden");
      }
      if (lastPredictionData) {
        delete lastPredictionData.db_id;
      }

      renderHistoryTable();
    } catch (err) {
      showToast(`Failed to clear database: ${err.message}`, "error");
    }
  }
}
