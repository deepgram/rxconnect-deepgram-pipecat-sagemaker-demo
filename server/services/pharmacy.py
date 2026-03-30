"""Pharmacy data access and tool functions for the RxConnect voice agent.

Extracted from the original monolithic main.py so it can be shared between the
hand-rolled WebSocket server (main_backup.py) and the Pipecat pipeline version.
"""

import json
import time
from pathlib import Path
from typing import Optional

DATA_FILE = Path(__file__).parent.parent.parent / "data" / "pharmacy-order-data.json"

_pharmacy_data_cache: Optional[list] = None
_pharmacy_data_cache_time: float = 0

DEMO_WEEK_DATES = [
    "2025-03-23",
    "2025-03-24",
    "2025-03-25",
    "2025-03-26",
    "2025-03-27",
]


# ---------------------------------------------------------------------------
# ID normalisation helpers
# ---------------------------------------------------------------------------

def normalize_id(id_raw: str) -> str:
    """Normalize IDs to handle transcription variations."""
    number_words = {
        "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
        "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    }
    normalized = id_raw.upper()
    for word, digit in number_words.items():
        normalized = normalized.replace(word.upper(), digit)
    normalized = normalized.replace(" ", "").replace("-", "").replace("_", "")
    return normalized


def _levenshtein_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i]
        for j, cb in enumerate(b, start=1):
            ins = curr[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            curr.append(min(ins, delete, sub))
        prev = curr
    return prev[-1]


def resolve_member_id(member_id_raw: str) -> str:
    """Resolve spoken/noisy member IDs to the closest known ID."""
    candidate = normalize_id(member_id_raw)
    orders = load_pharmacy_data()
    known_ids = sorted({normalize_id(o["member_id"]) for o in orders})

    if candidate in known_ids:
        return candidate

    if candidate.isdigit():
        m_prefixed = f"M{candidate}"
        if m_prefixed in known_ids:
            return m_prefixed

    best_id = None
    best_dist = 999
    tied = False
    for known in known_ids:
        dist = _levenshtein_distance(candidate, known)
        if dist < best_dist:
            best_dist = dist
            best_id = known
            tied = False
        elif dist == best_dist:
            tied = True

    if best_id and best_dist <= 2 and not tied:
        return best_id

    return candidate


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_pharmacy_data() -> list:
    """Load pharmacy order data with in-memory caching."""
    global _pharmacy_data_cache, _pharmacy_data_cache_time
    now = time.time()
    if _pharmacy_data_cache is not None and (now - _pharmacy_data_cache_time) < 60:
        return _pharmacy_data_cache
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
            _pharmacy_data_cache = _normalize_dates_to_demo_week(data)
            _pharmacy_data_cache_time = now
            return _pharmacy_data_cache
    except Exception as e:
        print(f"Error loading pharmacy data: {e}")
        return []


def _looks_like_iso_date(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) >= 10
        and value[4] == "-"
        and value[7] == "-"
        and value[:4].isdigit()
        and value[5:7].isdigit()
        and value[8:10].isdigit()
    )


def _normalize_dates_to_demo_week(orders: list) -> list:
    """Remap timing dates into the demo week (Mar 23-27) while preserving time."""
    for idx, order in enumerate(orders):
        timing = order.get("timing")
        if not isinstance(timing, dict):
            continue
        for offset, key in enumerate(sorted(timing.keys())):
            value = timing.get(key)
            if not value or not _looks_like_iso_date(value):
                continue
            time_part = ""
            if "T" in value:
                _, time_part = value.split("T", 1)
                time_part = f"T{time_part}"
            mapped_date = DEMO_WEEK_DATES[(idx + offset) % len(DEMO_WEEK_DATES)]
            timing[key] = f"{mapped_date}{time_part}"
    return orders


# ---------------------------------------------------------------------------
# Tool functions (called by the LLM via function-calling)
# ---------------------------------------------------------------------------

def verify_member_id(member_id: str) -> dict:
    member_id = resolve_member_id(member_id)
    orders = load_pharmacy_data()
    member_exists = any(normalize_id(o["member_id"]) == member_id for o in orders)
    if member_exists:
        return {"found": True, "member_id": member_id}
    return {"found": False, "member_id": member_id}


def list_member_orders(member_id: str) -> dict:
    member_id = resolve_member_id(member_id)
    orders = load_pharmacy_data()
    member_orders = [
        {"order_id": o["order_id"], "status": o["status"]}
        for o in orders
        if normalize_id(o["member_id"]) == member_id
    ]
    if member_orders:
        return {
            "found": True,
            "member_id": member_id,
            "order_count": len(member_orders),
            "orders": member_orders,
        }
    return {"found": False, "member_id": member_id}


def _resolve_member_order(order_id: str, member_id: str):
    """Resolve an order for a member with single-order fallback."""
    orders = load_pharmacy_data()
    member_orders = [o for o in orders if normalize_id(o["member_id"]) == member_id]
    matched = next((o for o in member_orders if normalize_id(o["order_id"]) == order_id), None)
    if matched:
        return matched, False
    if len(member_orders) == 1:
        return member_orders[0], True
    return None, False


def get_order_details(**kwargs) -> dict:
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
    order, inferred = _resolve_member_order(order_id, member_id)
    if order:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "status": order["status"],
            "prescriptions": order["prescriptions"],
            "resolved_order_from_member_context": inferred,
        }
    orders = load_pharmacy_data()
    if next((o for o in orders if normalize_id(o["order_id"]) == order_id), None):
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def get_order_timing(**kwargs) -> dict:
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
    order, inferred = _resolve_member_order(order_id, member_id)
    if order:
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "status": order["status"],
            "timing": order["timing"],
            "resolved_order_from_member_context": inferred,
        }
    orders = load_pharmacy_data()
    if next((o for o in orders if normalize_id(o["order_id"]) == order_id), None):
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def get_order_refills(**kwargs) -> dict:
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
    order, inferred = _resolve_member_order(order_id, member_id)
    if order:
        refills = [
            {
                "medication": rx["name"],
                "rx_id": rx["rx_id"],
                "refills_remaining": rx["refills_remaining"],
            }
            for rx in order["prescriptions"]
        ]
        return {
            "found": True,
            "verified": True,
            "order_id": order["order_id"],
            "refills": refills,
            "resolved_order_from_member_context": inferred,
        }
    orders = load_pharmacy_data()
    if next((o for o in orders if normalize_id(o["order_id"]) == order_id), None):
        return {"found": True, "verified": False}
    return {"found": False, "verified": False}


def lookup_order_status(**kwargs) -> dict:
    order_id = normalize_id(kwargs["order_id"])
    member_id = resolve_member_id(kwargs["member_id"])
    orders = load_pharmacy_data()
    order = next((o for o in orders if normalize_id(o["order_id"]) == order_id), None)
    if order:
        if normalize_id(order["member_id"]) == member_id:
            return {
                "found": True,
                "verified": True,
                "order_id": order["order_id"],
                "member_id": order["member_id"],
                "status": order["status"],
                "prescriptions": order["prescriptions"],
                "timing": order["timing"],
                "pharmacy": order["pharmacy"],
            }
        return {
            "found": True,
            "verified": False,
            "order_id": order_id,
            "member_id": member_id,
        }
    return {"found": False, "verified": False, "order_id": order_id}


def end_session(**kwargs) -> dict:
    return {"status": "ending", "message": "Session ended"}


FUNCTION_MAP = {
    "verify_member_id": lambda args: verify_member_id(**args),
    "list_member_orders": lambda args: list_member_orders(**args),
    "get_order_details": lambda args: get_order_details(**args),
    "get_order_timing": lambda args: get_order_timing(**args),
    "get_order_refills": lambda args: get_order_refills(**args),
    "lookup_order_status": lambda args: lookup_order_status(**args),
    "end_session": lambda args: end_session(**args),
}
