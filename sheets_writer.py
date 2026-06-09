"""Google Sheets writer for Golomt transactions."""
import os
from pathlib import Path
from dotenv import load_dotenv
import gspread
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

load_dotenv(Path(r"D:\Claude\.env"))

BASE_DIR = Path(r"D:\Claude")
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
TOKEN_FILE = BASE_DIR / "sheets_token.json"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SHEET_ID = os.environ["GOOGLE_SHEET_ID"]
HEADER = ["date", "amount", "receiver", "bank", "description", "type", "category", "source", "ref_no"]


def _get_client():
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
    return gspread.authorize(creds)


def _get_worksheet():
    gc = _get_client()
    sh = gc.open_by_key(SHEET_ID)
    ws = sh.sheet1
    # ensure header
    first_row = ws.row_values(1)
    if first_row != HEADER:
        if not first_row:
            ws.append_row(HEADER)
        else:
            # don't overwrite if already populated differently; just continue
            pass
    return ws


def get_existing_ref_nos():
    ws = _get_worksheet()
    col = ws.col_values(9)  # column I = ref_no
    return set(v for v in col[1:] if v)


def write_transactions(transactions):
    if not transactions:
        return 0
    ws = _get_worksheet()
    existing = get_existing_ref_nos()
    rows = []
    for t in transactions:
        ref = (t.get("ref_no") or "").strip()
        if not ref or ref in existing:
            continue
        existing.add(ref)
        rows.append([
            t.get("date", ""),
            t.get("amount_mnt", 0),
            t.get("receiver_name", ""),
            t.get("receiver_bank", ""),
            t.get("description", ""),
            t.get("transaction_type", ""),
            t.get("category", ""),
            t.get("source", ""),
            ref,
        ])
    if rows:
        ws.append_rows(rows, value_input_option="USER_ENTERED")
    return len(rows)


def update_category(ref_no, category):
    ws = _get_worksheet()
    col = ws.col_values(9)
    for idx, val in enumerate(col, start=1):
        if val == ref_no:
            ws.update_cell(idx, 7, category)  # column G = category
            return True
    return False


def read_all():
    ws = _get_worksheet()
    return ws.get_all_records()


if __name__ == "__main__":
    print(f"Existing ref_nos: {len(get_existing_ref_nos())}")
