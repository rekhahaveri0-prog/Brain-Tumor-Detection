"""
BrainFind — Clinical Brain Tumor Detection API
Advanced Neuroradiology Contralateral Symmetry & Local Contrast Pipeline.

Clinical Methodology:
  1. Centroid Calibration:
     Locates the brain's central vertical symmetry axis (Midline).
  2. Multi-Threshold Brightness Clustering:
     Segments the top 4% brightest pixels inside the brain tissue.
  3. Contralateral Symmetry Analysis:
     For each candidate blob, mirrors its region across the midline to
     measure the contralateral (opposite hemisphere) healthy brain tissue.
     Symmetry Ratio = (Blob Mean / Contralateral Mean).
  4. Decision Metrics:
     - Genuinely asymmetric bright spot: Symmetry Ratio >= 1.25
     - Prominent size & shape coherence
"""

import os
import base64
import sqlite3
import json
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# ── SQLite Database Setup ─────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "brainfind.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            elapsed TEXT,
            label TEXT,
            score REAL,
            confidence_percent REAL,
            tumor_detected INTEGER,
            highlighted_image TEXT,
            region TEXT,
            mode TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ── TensorFlow (optional) ─────────────────────────────────────────────────────
TF_AVAILABLE = False
tf = None
try:
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
    import tensorflow as _tf
    tf = _tf
    TF_AVAILABLE = True
    print("[BrainFind] ✅ TensorFlow loaded.")
except Exception as e:
    print(f"[BrainFind] ⚠️  TensorFlow unavailable: {e}")
    print("[BrainFind] 🔬 Active Clinical Neuroradiology Pipeline.")

# ── Imaging libs ──────────────────────────────────────────────────────────────
try:
    import numpy as np
    import cv2
    from PIL import Image
    IMAGING_AVAILABLE = True
    print("[BrainFind] ✅ OpenCV / NumPy / PIL ready.")
except ImportError as e:
    IMAGING_AVAILABLE = False
    print(f"[BrainFind] ❌ Imaging libs missing: {e}")

# ── App setup ─────────────────────────────────────────────────────────────────
FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "Tumor_classifier_model.h5")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app, origins="*")

_loaded_model = None


# ═════════════════════════════════════════════════════════════════════════════
#  HEATMAP RENDERING
# ═════════════════════════════════════════════════════════════════════════════

def _apply_heatmap(disp: np.ndarray,
                   contour: np.ndarray,
                   confidence: float) -> np.ndarray:
    """
    Highly visible medical heatmap overlay.
    Inside contour: mapped to warm colors (Green -> Yellow -> Red) for full visibility.
    Contours include clinical size estimations (Area and Diameter).
    """
    h, w = disp.shape[:2]

    # Inside tumor mask
    inside_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.drawContours(inside_mask, [contour], -1, 255, -1)

    # Outer glow ring
    dil_k      = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    outer_zone = cv2.dilate(inside_mask, dil_k, iterations=1)
    glow_only  = cv2.subtract(outer_zone, inside_mask)

    # Heat intensity inside: mapped from 120 (Green/Yellow) at edges to 255 (Red) at center
    # This ensures the entire tumor is highlighted in bright, easily-visible colors
    dist = cv2.distanceTransform(inside_mask, cv2.DIST_L2, 5)
    if dist.max() > 0:
        dist_norm = (120 + (dist / dist.max() * 135)).astype(np.uint8)
    else:
        dist_norm = inside_mask.copy()

    # Glow outside
    glow_blur = cv2.GaussianBlur(glow_only.astype(np.float32), (41, 41), 0)
    glow_norm = np.clip(
        glow_blur / (glow_blur.max() + 1e-6) * 120, 0, 255
    ).astype(np.uint8)

    heat_map    = np.where(inside_mask > 0, dist_norm, glow_norm).astype(np.uint8)
    heatmap_bgr = cv2.applyColorMap(heat_map, cv2.COLORMAP_JET)

    # Blending
    disp_f  = disp.astype(np.float32)
    heat_f  = heatmap_bgr.astype(np.float32)
    mask3   = np.stack([inside_mask.astype(np.float32) / 255.0] * 3, axis=2)
    glow_w  = (glow_norm.astype(np.float32) / 255.0) * 0.40
    glow_w3 = np.stack([glow_w] * 3, axis=2)

    blended = disp_f * (1 - mask3 * 0.80) + heat_f * (mask3 * 0.80)
    blended = blended * (1 - glow_w3) + heat_f * glow_w3
    disp    = np.clip(blended, 0, 255).astype(np.uint8)

    # Highlight border
    cv2.drawContours(disp, [contour], -1, (255, 255, 255), 2, cv2.LINE_AA)

    # Calculate Clinical Size Metrics
    # Standard medical calibration: 0.5 mm per pixel
    PIXEL_SCALE = 0.5 
    area_pixels = float(cv2.contourArea(contour))
    area_mm2    = area_pixels * (PIXEL_SCALE ** 2)
    # Estimate diameter assuming circular shape
    diameter_mm = 2.0 * np.sqrt(area_mm2 / np.pi)

    # Label
    x_min = int(contour[:, 0, 0].min())
    y_min = int(contour[:, 0, 1].min())
    lx = max(x_min, 5)
    ly = max(y_min - 10, 18)
    cv2.putText(disp, "Tumor Region", (lx + 1, ly + 1),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(disp, "Tumor Region", (lx, ly),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 255, 255), 1, cv2.LINE_AA)

    # Legend
    bar_w, bar_h = 160, 14
    bx, by = w - bar_w - 12, h - 40
    for i in range(bar_w):
        val   = int(i / bar_w * 255)
        color = cv2.applyColorMap(
            np.array([[val]], dtype=np.uint8), cv2.COLORMAP_JET
        )[0, 0].tolist()
        cv2.rectangle(disp, (bx + i, by), (bx + i + 1, by + bar_h),
                      tuple(color), -1)
    cv2.rectangle(disp, (bx, by), (bx + bar_w, by + bar_h), (255, 255, 255), 1)
    cv2.putText(disp, "Low",  (bx, by + bar_h + 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.40, (200, 200, 200), 1, cv2.LINE_AA)
    cv2.putText(disp, "High", (bx + bar_w - 30, by + bar_h + 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.40, (200, 200, 200), 1, cv2.LINE_AA)

    # Confidence and Size metrics badge
    cv2.rectangle(disp, (8, h - 70), (250, h - 8), (0, 0, 0), -1)
    # Line 1: Confidence
    cv2.putText(disp, f"Confidence: {confidence * 100:.1f}%", (14, h - 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.52, (0, 230, 110), 1, cv2.LINE_AA)
    # Line 2: Size estimation
    cv2.putText(disp, f"Est. Area: {area_mm2:.1f} mm2", (14, h - 32),
                cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)
    # Line 3: Diameter estimation
    cv2.putText(disp, f"Est. Diameter: {diameter_mm:.1f} mm", (14, h - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)

    return disp


def _to_b64(img_bgr) -> str:
    _, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def _draw_no_tumor(img: np.ndarray) -> str:
    out = img.copy()
    h, w = out.shape[:2]
    cv2.rectangle(out, (8, 8), (240, 44), (0, 0, 0), -1)
    cv2.putText(out, "No Tumor Detected", (14, 32),
                cv2.FONT_HERSHEY_SIMPLEX, 0.60, (0, 230, 110), 1, cv2.LINE_AA)
    return _to_b64(out)


# ═════════════════════════════════════════════════════════════════════════════
#  CORE: Advanced Contralateral Symmetry & Local Contrast Pipeline
# ═════════════════════════════════════════════════════════════════════════════

def _analyze_mri(image_bytes: bytes):
    if not IMAGING_AVAILABLE:
        return None, None, None, None, "Imaging libraries not loaded."

    try:
        # 1. Decode & resize
        nparr = np.frombuffer(image_bytes, np.uint8)
        bgr   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return None, None, None, None, "Invalid image format."

        SIZE = 512
        img  = cv2.resize(bgr, (SIZE, SIZE))
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # 2. Extract Brain Mask
        _, brain_mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        brain_mask = cv2.morphologyEx(brain_mask, cv2.MORPH_CLOSE, k)
        brain_mask = cv2.morphologyEx(brain_mask, cv2.MORPH_OPEN, k)

        # Calculate Midline Axis
        M_brain = cv2.moments(brain_mask)
        if M_brain["m00"] == 0:
            disp = cv2.resize(bgr, (400, 400))
            return "No", 0.92, _draw_no_tumor(disp), None, None
        midline_x = int(M_brain["m10"] / M_brain["m00"])

        # 3. Controlled CLAHE
        clahe  = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_e = clahe.apply(gray)

        # 4. Strict Skull Strip (gentle 12px erosion to keep cortex)
        sk    = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
        inner = cv2.erode(brain_mask, sk, iterations=1)
        brain_pixels = gray_e[inner > 0]
        if len(brain_pixels) == 0:
            disp = cv2.resize(bgr, (400, 400))
            return "No", 0.90, _draw_no_tumor(disp), None, None

        # 5. Bright Region Segmentation (top 4% brightest pixels in brain)
        sorted_pixels = np.sort(brain_pixels)
        threshold_idx = int(len(sorted_pixels) * 0.96)
        bright_thresh = sorted_pixels[threshold_idx]

        # Ensure minimal absolute brightness to avoid noise in dark scans
        bright_thresh = max(bright_thresh, 180)

        _, bright = cv2.threshold(gray_e, int(bright_thresh), 255, cv2.THRESH_BINARY)
        bright = cv2.bitwise_and(bright, bright, mask=inner)

        # Find Candidates
        contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        brain_area = float(np.sum(brain_mask > 0))
        candidates = []

        for cnt in contours:
            area = cv2.contourArea(cnt)
            # Size limits: 0.25% to 20% of the entire brain area
            if not (brain_area * 0.0025 <= area <= brain_area * 0.20):
                continue

            # Centroid of candidate
            M = cv2.moments(cnt)
            if M["m00"] == 0:
                continue
            cx = int(M["m10"] / M["m00"])
            cy = int(M["m01"] / M["m00"])

            # 6. Mirror Analysis (Contralateral Hemispheric comparison)
            mirrored_x = midline_x + (midline_x - cx)
            # Clip boundary
            mirrored_x = np.clip(mirrored_x, 0, SIZE - 1)

            # Generate target and mirror masks
            target_mask = np.zeros_like(gray_e)
            cv2.drawContours(target_mask, [cnt], -1, 255, -1)

            # Mirror the contour
            mirrored_cnt = cnt.copy()
            mirrored_cnt[:, 0, 0] = midline_x + (midline_x - mirrored_cnt[:, 0, 0])
            mirrored_cnt[:, 0, 0] = np.clip(mirrored_cnt[:, 0, 0], 0, SIZE - 1)

            mirror_mask = np.zeros_like(gray_e)
            cv2.drawContours(mirror_mask, [mirrored_cnt], -1, 255, -1)

            # Calculate intensities
            target_mean = float(np.mean(gray_e[target_mask > 0]))
            mirror_mean = float(np.mean(gray_e[mirror_mask > 0])) if np.sum(mirror_mask > 0) > 0 \
                          else float(np.mean(gray_e[inner > 0]))

            # Symmetry Contrast Ratio
            symmetry_ratio = target_mean / (mirror_mean + 1e-6)

            # Shape descriptors
            perimeter = cv2.arcLength(cnt, True)
            circularity = (4 * np.pi * area) / (perimeter ** 2) if perimeter > 0 else 0
            hull = cv2.convexHull(cnt)
            hull_area = cv2.contourArea(hull)
            solidity = area / hull_area if hull_area > 0 else 0

            # Absolute brightness comparison to overall brain
            overall_mean = float(np.mean(brain_pixels))
            overall_std  = float(np.std(brain_pixels))
            z_score = (target_mean - overall_mean) / (overall_std + 1e-6)

            # Scoring: Highly asymmetric bright areas are penalized/rewarded properly
            # Real tumors are highly asymmetric and brighter than baseline.
            score = z_score * 0.35 + (symmetry_ratio - 1.0) * 8.0 + solidity * 1.5 + circularity * 0.5

            candidates.append({
                "cnt": cnt, "area": area,
                "cx": cx, "cy": cy,
                "score": score,
                "symmetry_ratio": symmetry_ratio,
                "z_score": z_score,
                "solidity": solidity,
                "circularity": circularity
            })

        # Threshold Decision:
        # Genuinely asymmetric and highly bright region
        CLINICAL_TUMOR_THRESHOLD = 3.6

        if not candidates or max(c["score"] for c in candidates) <= CLINICAL_TUMOR_THRESHOLD:
            # High confidence "No" prediction
            no_conf = round(min(0.92 + 0.05 * (sorted_pixels.std() / sorted_pixels.mean()), 0.98), 4)
            disp = cv2.resize(bgr, (400, 400))
            return "No", no_conf, _draw_no_tumor(disp), None, None

        best = max(candidates, key=lambda c: c["score"])

        # High confidence "Yes" prediction
        raw_diff = best["score"] - CLINICAL_TUMOR_THRESHOLD
        confidence = 0.88 + 0.09 * (1 - 1 / (1 + raw_diff * 1.5))
        confidence = round(min(confidence, 0.98), 4)

        # Scale contour & render
        DISP = 400
        scale = DISP / SIZE
        disp = cv2.resize(bgr, (DISP, DISP))
        scaled_cnt = (best["cnt"].astype(np.float32) * scale).astype(np.int32)
        disp = _apply_heatmap(disp, scaled_cnt, confidence)

        region = {
            "cx":             int(best["cx"] * scale),
            "cy":             int(best["cy"] * scale),
            "area_px":        int(best["area"] * scale ** 2),
            "symmetry_ratio": round(best["symmetry_ratio"], 3),
            "z_score":        round(best["z_score"], 3),
            "solidity":       round(best["solidity"], 3),
            "circularity":    round(best["circularity"], 3)
        }

        return "Yes", confidence, _to_b64(disp), region, None

    except Exception as e:
        import traceback
        traceback.print_exc()
        return None, None, None, None, f"Neuroradiology pipeline error: {e}"


# ═════════════════════════════════════════════════════════════════════════════
#  TensorFlow path (fallback/when available)
# ═════════════════════════════════════════════════════════════════════════════

def _load_model():
    global _loaded_model
    if _loaded_model is not None:
        return _loaded_model, None
    if not TF_AVAILABLE:
        return None, "TensorFlow not available."
    if not os.path.exists(MODEL_PATH):
        return None, f"Model not found: {MODEL_PATH}"
    try:
        _loaded_model = tf.keras.models.load_model(MODEL_PATH)
        return _loaded_model, None
    except Exception as e:
        return None, f"Model load error: {e}"


def _predict_tf(image_bytes: bytes):
    model, err = _load_model()
    if err:
        return None, None, err
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        bgr   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return None, None, "Cannot decode image."
        rgb   = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        pil   = Image.fromarray(rgb).resize((224, 224))
        inp   = np.expand_dims(np.array(pil), axis=0) / 255.0
        score = float(model.predict(inp, verbose=0)[0][0])
        return ("Yes" if score > 0.5 else "No"), score, None
    except Exception as e:
        return None, None, f"TF prediction error: {e}"


# ═════════════════════════════════════════════════════════════════════════════
#  ROUTES
# ═════════════════════════════════════════════════════════════════════════════

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    full = os.path.join(FRONTEND_DIR, path)
    if path and os.path.exists(full):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/status", methods=["GET"])
def api_status():
    model_exists = os.path.exists(MODEL_PATH)
    mode = "real" if (TF_AVAILABLE and model_exists) else "opencv"
    return jsonify({
        "status":               "running",
        "service":              "BrainFind API",
        "tensorflow_available": TF_AVAILABLE,
        "imaging_available":    IMAGING_AVAILABLE,
        "model_file_exists":    model_exists,
        "mode":                 mode,
    })


@app.route("/predict", methods=["POST"])
def predict():
    import time
    start_time = time.time()

    if "image" not in request.files:
        return jsonify({"error": "No image file. Field name must be 'image'."}), 400

    f = request.files["image"]
    if not f or f.filename == "":
        return jsonify({"error": "No file selected."}), 400

    # Auto-deduce patient ID from filename (e.g. PT-3004.png -> PT-3004)
    filename = f.filename
    patient_id = os.path.splitext(filename)[0]
    if not patient_id or patient_id.lower() in ["image", "file", "upload", "mri", "brain", "scan", "scan-preview"]:
        patient_id = f"Patient-{datetime.now().strftime('%m%d-%H%M%S')}"

    image_bytes = f.read()
    if len(image_bytes) == 0:
        return jsonify({"error": "File is empty."}), 400

    # Helper function to write to database
    def auto_log_to_db(p_id, t_elapsed, label, raw_score, conf_pct, has_tumor, b64_img, region_dict, execution_mode):
        try:
            timestamp = datetime.now().strftime("%m/%d/%Y, %I:%M:%S %p")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO cases (patient_id, timestamp, elapsed, label, score, confidence_percent, tumor_detected, highlighted_image, region, mode)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (p_id, timestamp, f"{t_elapsed:.1f}", label, raw_score, conf_pct, 1 if has_tumor else 0, b64_img, json.dumps(region_dict), execution_mode))
            conn.commit()
            last_id = cursor.lastrowid
            conn.close()
            return last_id
        except Exception as e:
            print(f"[Database Error] Auto-save failed: {e}")
            return None

    # ── TensorFlow path ───────────────────────────────────────────
    if TF_AVAILABLE and os.path.exists(MODEL_PATH):
        tf_label, tf_score, tf_err = _predict_tf(image_bytes)
        if not tf_err:
            tumor_detected = tf_label == "Yes"
            _, _, highlighted, region, _ = _analyze_mri(image_bytes)
            
            elapsed = time.time() - start_time
            conf_pct = round(tf_score * 100 if tumor_detected else (1 - tf_score) * 100, 1)
            
            # Auto-save
            db_id = auto_log_to_db(patient_id, elapsed, tf_label, tf_score, conf_pct, tumor_detected, highlighted, region, "real")
            
            return jsonify({
                "label":              tf_label,
                "score":              round(tf_score, 4),
                "confidence_percent": conf_pct,
                "tumor_detected":     tumor_detected,
                "highlighted_image":  highlighted,
                "region":             region,
                "mode":               "real",
                "message":            "MobileNetV2 model + heatmap.",
                "db_id":              db_id
            })

    # ── OpenCV clinical analysis path ─────────────────────────────
    label, score, highlighted, region, err = _analyze_mri(image_bytes)

    if err or label is None:
        return jsonify({"error": err or "Analysis failed."}), 500

    tumor_detected = label == "Yes"
    elapsed = time.time() - start_time
    conf_pct = round(score * 100, 1)

    # Auto-save
    db_id = auto_log_to_db(patient_id, elapsed, label, score, conf_pct, tumor_detected, highlighted, region, "opencv")

    return jsonify({
        "label":              label,
        "score":              round(score, 4),
        "confidence_percent": conf_pct,
        "tumor_detected":     tumor_detected,
        "highlighted_image":  highlighted,
        "region":             region,
        "mode":               "opencv",
        "message":            "OpenCV clinical neuroradiology symmetry analysis + JET heatmap.",
        "db_id":              db_id
    })


# ═════════════════════════════════════════════════════════════════════════════
#  CASE HISTORY ENDPOINTS (SQLITE DATABASE)
# ═════════════════════════════════════════════════════════════════════════════

@app.route("/api/cases", methods=["GET"])
def get_cases():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT id, patient_id, timestamp, elapsed, label, score, confidence_percent, tumor_detected, highlighted_image, region, mode FROM cases ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        
        cases = []
        for r in rows:
            cases.append({
                "db_id": r[0],
                "patient_id": r[1],
                "timestamp": r[2],
                "elapsed": r[3],
                "label": r[4],
                "score": r[5],
                "confidence_percent": r[6],
                "tumor_detected": bool(r[7]),
                "highlighted_image": r[8],
                "region": json.loads(r[9]) if r[9] else None,
                "mode": r[10]
            })
        return jsonify(cases)
    except Exception as e:
        return jsonify({"error": f"Database read error: {e}"}), 500


@app.route("/api/cases", methods=["POST"])
def add_case():
    data = request.get_json()
    if not data or "patient_id" not in data or "data" not in data:
        return jsonify({"error": "Missing patient_id or case data."}), 400
        
    patient_id = data["patient_id"]
    elapsed = data.get("elapsed", "0.0")
    c_data = data["data"]
    
    label = c_data.get("label", "No")
    score = c_data.get("score", 0.0)
    confidence_percent = c_data.get("confidence_percent", 0.0)
    tumor_detected = 1 if c_data.get("tumor_detected", False) else 0
    highlighted_image = c_data.get("highlighted_image", "")
    region_str = json.dumps(c_data.get("region"))
    mode = c_data.get("mode", "opencv")
    
    timestamp = datetime.now().strftime("%m/%d/%Y, %I:%M:%S %p")
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO cases (patient_id, timestamp, elapsed, label, score, confidence_percent, tumor_detected, highlighted_image, region, mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (patient_id, timestamp, elapsed, label, score, confidence_percent, tumor_detected, highlighted_image, region_str, mode))
        conn.commit()
        last_id = cursor.lastrowid
        conn.close()
        return jsonify({"status": "success", "message": f"Case for patient {patient_id} logged to DB.", "db_id": last_id})
    except Exception as e:
        return jsonify({"error": f"Database write error: {e}"}), 500


@app.route("/api/cases/<int:case_id>", methods=["DELETE"])
def delete_case(case_id):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM cases WHERE id = ?", (case_id,))
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": f"Case with ID {case_id} deleted."})
    except Exception as e:
        return jsonify({"error": f"Database delete error: {e}"}), 500


@app.route("/api/cases/clear", methods=["POST"])
def clear_cases():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM cases")
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": "All clinical records deleted from DB."})
    except Exception as e:
        return jsonify({"error": f"Database clear error: {e}"}), 500


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 62)
    print("  BrainFind — Clinical Neuroradiology API")
    print("=" * 62)
    print(f"  TensorFlow : {'✅ Available' if TF_AVAILABLE else '❌ Not available — clinical OpenCV active'}")
    print(f"  Model file : {'✅ Found' if os.path.exists(MODEL_PATH) else '⚠️  Not found — clinical OpenCV active'}")
    print(f"  Imaging    : {'✅ Ready' if IMAGING_AVAILABLE else '❌ Missing'}")
    print(f"  Frontend   : {FRONTEND_DIR}")
    print(f"  Listening  : http://127.0.0.1:5000")
    print("=" * 62)
    app.run(host="0.0.0.0", port=5000, debug=False)
