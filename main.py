"""Pipeline: Gmail -> categorize -> Google Sheets."""
import sys
from gmail_parser import parse_emails
from categorizer import categorize_transactions
from sheets_writer import write_transactions, get_existing_ref_nos


def run():
    print("=" * 50)
    print("Голомт банкны автомат sync эхэллээ")
    print("=" * 50)

    try:
        transactions = parse_emails(max_results=100)
    except Exception as e:
        print(f"[АЛДАА] Имэйл татахад: {e}")
        return {"ok": False, "error": str(e)}

    print(f"Нийт татсан имэйл: {len(transactions)}")

    try:
        existing = get_existing_ref_nos()
    except Exception as e:
        print(f"[АЛДАА] Sheet уншихад: {e}")
        return {"ok": False, "error": str(e)}

    new_txs = [t for t in transactions if (t.get("ref_no") or "").strip() and t["ref_no"] not in existing]
    print(f"Шинэ гүйлгээ: {len(new_txs)}")

    if not new_txs:
        print("Шинэ гүйлгээ байхгүй. Дууслаа.")
        return {"ok": True, "new": 0, "total_amount": 0}

    try:
        categories = categorize_transactions(new_txs)
        for t, c in zip(new_txs, categories):
            t["category"] = c
    except Exception as e:
        print(f"[АЛДАА] Ангилахад: {e}")
        for t in new_txs:
            t["category"] = "Бусад"

    try:
        written = write_transactions(new_txs)
    except Exception as e:
        print(f"[АЛДАА] Sheet бичихэд: {e}")
        return {"ok": False, "error": str(e)}

    total = sum(float(t.get("amount_mnt") or 0) for t in new_txs)
    print(f"Sheet-д бичсэн: {written} мөр")
    print(f"Нийт дүн: {total:,.0f} ₮")
    print("Дууслаа.")
    return {"ok": True, "new": written, "total_amount": total}


if __name__ == "__main__":
    result = run()
    sys.exit(0 if result.get("ok") else 1)
