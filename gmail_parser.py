"""Gmail parser for Golomt Bank transaction emails."""
import os
import re
import base64
from pathlib import Path
from bs4 import BeautifulSoup
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

BASE_DIR = Path(r"D:\Claude")
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
TOKEN_FILE = BASE_DIR / "token.json"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

SENDERS = ["alert@golomtbank.com", "noreply003@golomtbank.com"]


def _get_service():
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    return build("gmail", "v1", credentials=creds)


def _decode_body(payload):
    """Recursively pull text/html and text/plain bodies."""
    html_parts, text_parts = [], []

    def walk(part):
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        data = body.get("data")
        if data:
            try:
                decoded = base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")
                if mime == "text/html":
                    html_parts.append(decoded)
                elif mime == "text/plain":
                    text_parts.append(decoded)
            except Exception:
                pass
        for sub in part.get("parts", []) or []:
            walk(sub)

    walk(payload)
    return "\n".join(html_parts), "\n".join(text_parts)


def _get_header(headers, name):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _parse_amount(s):
    if not s:
        return 0.0
    cleaned = re.sub(r"[^\d.\-]", "", s.replace(",", ""))
    try:
        return float(cleaned) if cleaned else 0.0
    except ValueError:
        return 0.0


def _parse_ebanking_html(html, msg_id):
    """Parse 'Golomt Bank: E-Banking' notification HTML."""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)

    # Try to extract from key:value patterns in tables or text
    fields = {}
    for row in soup.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) >= 2:
            key = cells[0].lower()
            value = cells[1]
            fields[key] = value

    def find(*keys):
        for k in keys:
            for fk, fv in fields.items():
                if k in fk:
                    return fv
        # fallback: regex on plain text
        for k in keys:
            m = re.search(rf"{re.escape(k)}[^\w]*([^\n]+)", text, re.IGNORECASE)
            if m:
                return m.group(1).strip()
        return ""

    ref_no = find("ref", "лавлах", "дугаар") or msg_id

    date_raw = find("огноо", "date", "он сар")
    date_match = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", date_raw or text)
    date = f"{date_match.group(1)}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}" if date_match else ""

    amount_raw = find("дүн", "amount", "мөнгөн дүн")
    amount_mnt = _parse_amount(amount_raw)

    return {
        "ref_no": ref_no.strip(),
        "date": date,
        "amount_mnt": amount_mnt,
        "receiver_name": find("хүлээн авагч", "receiver name", "нэр"),
        "receiver_bank": find("банк", "bank"),
        "sender_account": find("илгээгч данс", "sender", "sender account"),
        "receiver_account": find("хүлээн авагчийн данс", "receiver account", "хүлээн авагч данс"),
        "description": find("гүйлгээний утга", "description", "утга"),
        "transaction_type": find("төрөл", "type"),
        "status": find("статус", "status"),
        "source": "ebanking",
    }


def _parse_ebarimt_text(text, msg_id):
    """Parse 'Голомт банк - Гүйлгээний и-баримт' plain text."""
    def grab(*patterns):
        for p in patterns:
            m = re.search(p, text, re.IGNORECASE)
            if m:
                return m.group(1).strip()
        return ""

    month = grab(r"сар[:\s]*([0-9]{1,2})", r"month[:\s]*([0-9]{1,2})")
    ebarimt_amount = _parse_amount(grab(r"дүн[:\s]*([\d,\.]+)", r"amount[:\s]*([\d,\.]+)"))
    ddtd = grab(r"ддтд[:\s]*([\w\d\-]+)", r"ddtd[:\s]*([\w\d\-]+)")

    return {
        "ref_no": f"ebarimt-{msg_id}",
        "date": "",
        "amount_mnt": ebarimt_amount,
        "receiver_name": "",
        "receiver_bank": "",
        "sender_account": "",
        "receiver_account": "",
        "description": "и-баримт",
        "transaction_type": "ebarimt",
        "status": "",
        "month": month,
        "ebarimt_amount": ebarimt_amount,
        "ddtd": ddtd,
        "source": "ebarimt",
    }


def parse_emails(max_results=100):
    service = _get_service()
    query = " OR ".join(f"from:{s}" for s in SENDERS)
    resp = service.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    messages = resp.get("messages", []) or []

    results = []
    for m in messages:
        try:
            msg = service.users().messages().get(userId="me", id=m["id"], format="full").execute()
            payload = msg.get("payload", {})
            headers = payload.get("headers", [])
            subject = _get_header(headers, "Subject")
            html, plain = _decode_body(payload)

            if "Golomt Bank: E-Banking" in subject:
                results.append(_parse_ebanking_html(html or plain, m["id"]))
            elif "Голомт банк" in subject and "и-баримт" in subject:
                results.append(_parse_ebarimt_text(plain or BeautifulSoup(html, "html.parser").get_text("\n"), m["id"]))
        except Exception as e:
            print(f"[parse_emails] skipped {m.get('id')}: {e}")
            continue

    return results


if __name__ == "__main__":
    txs = parse_emails()
    print(f"Parsed {len(txs)} transactions")
    for t in txs[:3]:
        print(t)
