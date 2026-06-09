"""Flask API for the Golomt finance dashboard."""
from collections import defaultdict
from flask import Flask, jsonify, request
from flask_cors import CORS

import main as pipeline
from sheets_writer import read_all, update_category

app = Flask(__name__)
CORS(app)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/transactions")
def transactions():
    try:
        rows = read_all()
        return jsonify(rows)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/summary")
def summary():
    try:
        rows = read_all()
        monthly = defaultdict(float)
        by_category = defaultdict(float)
        total = 0.0
        for r in rows:
            try:
                amt = float(r.get("amount") or 0)
            except (TypeError, ValueError):
                amt = 0.0
            total += amt
            date = str(r.get("date") or "")
            if len(date) >= 7:
                monthly[date[:7]] += amt
            cat = r.get("category") or "Бусад"
            by_category[cat] += amt
        return jsonify({
            "monthly": dict(monthly),
            "by_category": dict(by_category),
            "total": total,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/update-category")
def update_cat():
    data = request.get_json(silent=True) or {}
    ref_no = data.get("ref_no")
    category = data.get("category")
    if not ref_no or not category:
        return jsonify({"error": "ref_no болон category шаардлагатай"}), 400
    try:
        ok = update_category(ref_no, category)
        return jsonify({"ok": ok})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/trigger-sync")
def trigger_sync():
    try:
        result = pipeline.run()
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
