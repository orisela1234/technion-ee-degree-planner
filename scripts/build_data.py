#!/usr/bin/env python3
"""
בונה את קבצי הנתונים של מתכנן התואר מתוך מקורות ציבוריים:
  * CheeseFork (sap.cheesefork.cf) – פרטי קורסים, סילבוס, קדמים, צמודים, מערכת שעות, מרצים, מועדי בחינות
  * technion-histograms (michael-maltsev.github.io) – ממוצעים, חציונים, אחוזי מעבר וסגל לאורך הסמסטרים

הפלט נכתב אל app/src/data/courses.json ו-app/src/data/histograms.json.

שימוש:
    python3 -I scripts/build_data.py            # משתמש במטמון קיים ומוריד רק מה שחסר
    python3 -I scripts/build_data.py --refresh  # מוריד הכל מחדש
"""
import concurrent.futures
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data_cache.nosync"
HIST_CACHE = CACHE / "hist"
OUT = ROOT / "src" / "data"

# סמסטרים בפורמט של SAP: <שנה>_<200 חורף | 201 אביב | 202 קיץ>
SEMESTERS = ["2024_200", "2024_201", "2024_202", "2025_200", "2025_201", "2025_202", "2026_200", "2026_201"]

# קידומות שעבורן נשלפים ממוצעים היסטוריים (הנדסת חשמל ומה שסביבה)
HIST_PREFIXES = ("0044", "0045", "0046", "0048", "0104", "0106", "0114", "0116", "0234", "0236",
                 "0324", "0034", "0035", "0086", "0124", "0126", "0134", "0336", "0394")

REFRESH = "--refresh" in sys.argv


def sem_code(sap: str) -> str:
    """2025_200 -> 202501 (הפורמט של CheeseFork והיסטוגרמות)."""
    year, s = sap.split("_")
    return f"{year}{int(s) - 199:02d}"


def fetch(url: str, timeout: int = 60) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "degree-planner/1.0 (personal use)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def load_semester(sap: str) -> list | None:
    path = CACHE / f"courses_{sap}.js"
    if REFRESH or not path.exists():
        data = fetch(f"https://sap.cheesefork.cf/courses_{sap}.min.js")
        if data is None:
            return None
        path.write_bytes(data)
    text = path.read_text(encoding="utf-8")
    return json.loads(text[text.index("["):].rstrip().rstrip(";"))


TOKEN = re.compile(r"\(|\)|או|ו-?|\d{8}")


def parse_prereq(expr: str):
    """ממיר ביטוי כמו '(A ו- B) או C' לעץ {'op': 'or'|'and', 'args': [...]} או מחרוזת מספר קורס."""
    tokens = [t if t != "ו" else "ו-" for t in TOKEN.findall(expr or "")]
    if not tokens:
        return None
    pos = 0

    def peek():
        return tokens[pos] if pos < len(tokens) else None

    def parse_or():
        nonlocal pos
        args = [parse_and()]
        while peek() == "או":
            pos += 1
            args.append(parse_and())
        return args[0] if len(args) == 1 else {"op": "or", "args": args}

    def parse_and():
        nonlocal pos
        args = [parse_atom()]
        while peek() == "ו-":
            pos += 1
            args.append(parse_atom())
        args = [a for a in args if a is not None]
        if not args:
            return None
        return args[0] if len(args) == 1 else {"op": "and", "args": args}

    def parse_atom():
        nonlocal pos
        t = peek()
        if t == "(":
            pos += 1
            node = parse_or()
            if peek() == ")":
                pos += 1
            return node
        if t is not None and t.isdigit():
            pos += 1
            return t
        pos += 1
        return None

    try:
        return parse_or()
    except RecursionError:
        return None


def duration(time_range: str) -> float:
    m = re.match(r"(\d+):(\d+)\s*-\s*(\d+):(\d+)", time_range or "")
    if not m:
        return 0.0
    a = int(m[1]) * 60 + int(m[2])
    b = int(m[3]) * 60 + int(m[4])
    return max(0.0, (b - a) / 60)


TYPE_KEY = {"הרצאה": "lecture", "תרגול": "tutorial", "מעבדה": "lab"}


def weekly_hours(schedule: list) -> dict:
    """שעות שבועיות לפי סוג, לפי קבוצת הרישום הראשונה (הרצאות משוכפלות בכל קבוצה)."""
    if not schedule:
        return {}
    first = min(s["קבוצה"] for s in schedule)
    hours: dict[str, float] = {}
    seen = set()
    for s in schedule:
        if s["קבוצה"] != first:
            continue
        key = (s["סוג"], s["יום"], s["שעה"])
        if key in seen:
            continue
        seen.add(key)
        k = TYPE_KEY.get(s["סוג"], "other")
        hours[k] = hours.get(k, 0) + duration(s["שעה"])
    # קורס בלי הרצאה בקבוצה הראשונה (למשל קבוצות תרגול נפרדות) – משלים מהקבוצות האחרות
    for t in ("הרצאה", "תרגול", "מעבדה"):
        k = TYPE_KEY[t]
        if k not in hours:
            per_group: dict[int, float] = {}
            seen_g = set()
            for s in schedule:
                if s["סוג"] != t:
                    continue
                key = (s["קבוצה"], s["יום"], s["שעה"])
                if key in seen_g:
                    continue
                seen_g.add(key)
                per_group[s["קבוצה"]] = per_group.get(s["קבוצה"], 0) + duration(s["שעה"])
            if per_group:
                hours[k] = min(per_group.values())
    return {k: round(v, 1) for k, v in hours.items() if v}


def compact_schedule(schedule: list) -> list:
    out, seen = [], set()
    for s in schedule:
        room = f'{s["בניין"]} {s["חדר"]}'.strip() if s["חדר"] else s["בניין"]
        item = (s["קבוצה"], s["סוג"], s["יום"], s["שעה"], s["מרצה/מתרגל"], room)
        if item in seen:
            continue
        seen.add(item)
        out.append({"g": s["קבוצה"], "t": s["סוג"], "d": s["יום"], "h": s["שעה"], "l": s["מרצה/מתרגל"], "r": room})
    return out


def split_ids(value: str | None) -> list:
    return re.findall(r"\d{8}", value or "")


def to_num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def build_courses() -> dict:
    courses: dict[str, dict] = {}
    for sap in SEMESTERS:
        data = load_semester(sap)
        if data is None:
            print(f"  · {sap}: אין נתונים (כנראה עוד לא פורסם)")
            continue
        code = sem_code(sap)
        print(f"  · {sap} ({code}): {len(data)} קורסים")
        for c in data:
            g = c["general"]
            cid = g["מספר מקצוע"]
            entry = courses.setdefault(cid, {"id": cid, "offered": []})
            entry["offered"].append(code)
            # הסמסטר האחרון גובר – הנתונים העדכניים ביותר
            entry.update({
                "name": g.get("שם מקצוע", "").strip(),
                "points": to_num(g.get("נקודות")) or 0,
                "faculty": g.get("פקולטה", ""),
                "syllabus": (g.get("סילבוס") or "").strip(),
                "prereqRaw": g.get("מקצועות קדם", ""),
                "prereq": parse_prereq(g.get("מקצועות קדם", "")),
                "coreq": split_ids(g.get("מקצועות צמודים")),
                "noCredit": sorted(set(split_ids(g.get("מקצועות ללא זיכוי נוסף"))
                                       + split_ids(g.get("מקצועות ללא זיכוי נוסף (מוכלים)"))
                                       + split_ids(g.get("מקצועות ללא זיכוי נוסף (מכילים)")))),
                "staff": g.get("אחראים", ""),
                "notes": (g.get("הערות") or "").strip(),
                "lastSem": code,
            })
            if c["schedule"]:
                entry["schedule"] = compact_schedule(c["schedule"])
                entry["scheduleSem"] = code
                entry["hours"] = weekly_hours(c["schedule"])
            exams = {k: g[v] for k, v in (("examA", "מועד א"), ("examB", "מועד ב"), ("quizA", "בוחן מועד א")) if g.get(v)}
            if exams:
                entry["exams"] = exams
                entry["examsSem"] = code
    for e in courses.values():
        e["offered"] = sorted(set(e["offered"]))
        if not e["prereq"]:
            e.pop("prereq")
        for k in ("prereqRaw", "notes", "staff", "syllabus"):
            if not e.get(k):
                e.pop(k, None)
        for k in ("coreq", "noCredit"):
            if not e[k]:
                e.pop(k)
    return courses


def summarize_hist(raw: dict) -> list:
    out = []
    for sem, d in sorted(raw.items(), reverse=True):
        item = {"sem": sem}
        staff = d.get("Staff") or []
        if staff:
            item["staff"] = [{"n": s.get("name", ""), "t": s.get("title", "")} for s in staff]
        for key, short in (("Finals", "fin"), ("Final_A", "fa"), ("Exam_A", "ea"), ("Final_B", "fb"), ("Exam_B", "eb")):
            h = d.get(key)
            if not h:
                continue
            item[short] = {
                "avg": to_num(h.get("average")),
                "med": to_num(h.get("median")),
                "pass": to_num(h.get("passPercent")),
                "n": to_num(h.get("students")),
            }
        out.append(item)
    return out


def fetch_hist(cid: str):
    path = HIST_CACHE / f"{cid}.json"
    if path.exists() and not REFRESH:
        return cid, json.loads(path.read_text(encoding="utf-8"))
    for attempt in range(3):
        try:
            data = fetch(f"https://michael-maltsev.github.io/technion-histograms/{cid}/index.min.json", timeout=30)
            raw = json.loads(data) if data else {}
            path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            return cid, raw
        except Exception:  # רשת לא יציבה – ננסה שוב
            time.sleep(1 + attempt)
    return cid, {}


def main():
    CACHE.mkdir(exist_ok=True)
    HIST_CACHE.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    print("שולף קורסים מ-CheeseFork…")
    courses = build_courses()
    print(f"סה\"כ {len(courses)} קורסים ייחודיים")

    ids = sorted(cid for cid in courses if cid.startswith(HIST_PREFIXES))
    print(f"שולף ממוצעים היסטוריים עבור {len(ids)} קורסים…")
    hist = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i, (cid, raw) in enumerate(pool.map(fetch_hist, ids), 1):
            if raw:
                hist[cid] = summarize_hist(raw)
            if i % 100 == 0:
                print(f"  · {i}/{len(ids)}")
    print(f"נמצאו ממוצעים עבור {len(hist)} קורסים")

    (OUT / "courses.json").write_text(json.dumps(courses, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "histograms.json").write_text(json.dumps(hist, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = {"builtAt": time.strftime("%Y-%m-%d %H:%M"), "semesters": [sem_code(s) for s in SEMESTERS
                                                                        if (CACHE / f"courses_{s}.js").exists()]}
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    for f in ("courses.json", "histograms.json"):
        print(f"  {f}: {(OUT / f).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
