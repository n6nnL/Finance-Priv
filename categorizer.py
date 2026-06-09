"""Transaction categorizer using Claude Haiku."""
import os
import json
from pathlib import Path
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv(Path(r"D:\Claude\.env"))

MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 10
CATEGORIES = [
    "Боловсрол", "Хоол/Ресторан", "Дэлгүүр/Худалдаа", "Тээвэр",
    "Хувийн шилжүүлэг", "Үйлчилгээ", "Эрүүл мэнд", "Бусад",
]

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def _categorize_batch(batch):
    items = [
        {"receiver_name": t.get("receiver_name", ""), "description": t.get("description", "")}
        for t in batch
    ]
    prompt = f"""Та банкны гүйлгээг ангилна. Доорх гүйлгээ бүрд яг ЭДГЭЭР категориудаас НЭГИЙГ сонго:
{", ".join(CATEGORIES)}

Гүйлгээнүүд (JSON):
{json.dumps(items, ensure_ascii=False)}

Зөвхөн JSON массив буцаа, өөр юу ч битгий бич. Жишээ: ["Хоол/Ресторан","Бусад",...]
Массивын урт яг {len(items)} байх ёстой."""

    try:
        resp = _get_client().messages.create(
            model=MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1:
            return ["Бусад"] * len(batch)
        cats = json.loads(text[start:end + 1])
        result = []
        for c in cats:
            result.append(c if c in CATEGORIES else "Бусад")
        while len(result) < len(batch):
            result.append("Бусад")
        return result[:len(batch)]
    except Exception as e:
        print(f"[categorizer] batch failed: {e}")
        return ["Бусад"] * len(batch)


def categorize_transactions(transactions):
    if not transactions:
        return []
    results = []
    for i in range(0, len(transactions), BATCH_SIZE):
        batch = transactions[i:i + BATCH_SIZE]
        results.extend(_categorize_batch(batch))
    return results


if __name__ == "__main__":
    sample = [
        {"receiver_name": "BD Foods", "description": "Хоолны төлбөр"},
        {"receiver_name": "Их сургууль", "description": "Сургалтын төлбөр"},
    ]
    print(categorize_transactions(sample))
