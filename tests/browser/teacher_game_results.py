#!/usr/bin/env python3
"""Browser checks of the teacher's Concept Quest results (Chromium via Playwright for Python).

    DITO_DATA_DIR=<same dir as the server> BASE=http://localhost:3000 python3 tests/browser/teacher_game_results.py [--shots DIR]

Run against `npm run build && npm start` (or `npm run dev`) started with a
throwaway DITO_DATA_DIR and no API keys (mock mode). Creates its own synthetic
classrooms, lessons and students and records their games through the student
API (start + finish with synthetic answer transcripts; the server scores them).
To get a second game version without AI keys (mock generation is
deterministic) it rewrites its own synthetic lesson's game in DITO_DATA_DIR.

Covers: per-student latest result, best score per version with the current
version highlighted, finished-game counts that exclude unfinished attempts,
game details with chosen/correct answers and explanations, regeneration,
edit/archive/restore with archived lessons in the history, classroom
separation, keyboard-only use with focus returning where it came from,
mobile layout (cards, no horizontal scrolling), and a student whose attempt
file can't be read (flagged, not counted, file untouched).
"""
import json, os, pathlib, sys, time, uuid
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000").rstrip("/")
DATA = pathlib.Path(os.environ["DITO_DATA_DIR"])
FIX = pathlib.Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "documents"
SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None

results = []
def check(ok, label, detail=""):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  — {detail}" if detail else ""))

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)

def transcript(g, plan=()):
    """Same as tests/gameFixtures.ts transcriptFor: the answers the game screen would record."""
    out, lives = [], 3
    for level, l in enumerate(g["levels"]):
        p = plan[level] if level < len(plan) else {}
        for gate in range(3):
            q = l["quiz_gates"][gate]
            ok = p.get("gates", [True, True, True])[gate]
            out.append({"k": "gate", "level": level, "gate": gate, "choice": q["correct_index"] if ok else (q["correct_index"] + 1) % len(q["options"])})
            if not ok:
                lives -= 1
                if lives <= 0: return out
        for _ in range(p.get("misses", 0)):
            out.append({"k": "match", "level": level, "term": 0, "match": 1})
        for t in range(len(l["matching_pairs"])):
            out.append({"k": "match", "level": level, "term": t, "match": t})
        b = l["boss_question"]
        for t in range(p.get("bossWrong", 0)):
            out.append({"k": "boss", "level": level, "try": t, "choice": (b["correct_index"] + 1) % len(b["options"])})
            lives -= 1
            if lives <= 0: return out
        out.append({"k": "boss", "level": level, "try": p.get("bossWrong", 0), "choice": b["correct_index"]})
    return out

LOSS = [{"gates": [True, False, False], "bossWrong": 1}]  # 30 points

with sync_playwright() as p:
    api = p.request.new_context(base_url=BASE)
    def get(path): return api.get(path).json()
    def post_json(path, body): return api.post(path, data=json.dumps(body), headers={"content-type": "application/json"})
    def patch_json(path, body): return api.patch(path, data=json.dumps(body), headers={"content-type": "application/json"})
    def upload(cid, name):
        r = api.post(f"/api/classrooms/{cid}/lessons", multipart={"file": {"name": name, "mimeType": "text/plain", "buffer": (FIX / name).read_bytes()}})
        assert r.ok, r.text()
        return r.json()["lesson"]["id"]
    def version(lid, sid): return get(f"/api/lessons/{lid}/game/attempts?student_id={sid}")["current_version"]
    def start(lid, sid):
        aid = str(uuid.uuid4())
        r = post_json(f"/api/lessons/{lid}/game/attempts", {"student_id": sid, "attempt_id": aid, "version": version(lid, sid)})
        assert r.status == 201, r.text()
        return aid
    def play(lid, sid, g, plan=()):
        aid = start(lid, sid)
        r = post_json(f"/api/lessons/{lid}/game/attempts/{aid}/finish", {"student_id": sid, "transcript": transcript(g, plan)})
        assert r.ok, r.text()
        return aid, r.json()["attempt"]["score"]

    stamp = time.strftime("%H:%M:%S")
    A = post_json("/api/classrooms", {"name": f"Teacher results A {stamp}", "subject": "Synthetic Science", "professor_name": "Prof. Synthetic"}).json()["classroom"]
    B = post_json("/api/classrooms", {"name": f"Teacher results B {stamp}", "subject": "Synthetic History", "professor_name": "Prof. Other"}).json()["classroom"]
    L1, L2 = upload(A["id"], "valid-lesson.txt"), upload(A["id"], "valid-lesson.md")
    LB = upload(B["id"], "valid-lesson.txt")
    g1 = post_json(f"/api/projects/{L1}/generate", {"type": "game"}).json()["data"]
    gB = post_json(f"/api/projects/{LB}/generate", {"type": "game"}).json()["data"]
    join = lambda name, code: post_json("/api/students", {"name": name, "interests": [], "join_code": code}).json()["student"]
    ada, ben, cy = join("Ada Synthetic", A["join_code"]), join("Ben Synthetic", A["join_code"]), join("Cy Synthetic", A["join_code"])
    olive = join("Olive Outsider", B["join_code"])

    ada_win, _ = play(L1, ada["id"], g1, [{"misses": 1}])   # 235
    ada_loss, _ = play(L1, ada["id"], g1, LOSS)             # 30 (latest on v1)
    start(L1, ben["id"])                                    # Ben: unfinished only
    start(L1, ada["id"])                                    # Ada: an unfinished attempt too
    play(LB, olive["id"], gB)                               # other classroom
    # Regenerate L1 (synthetic v2), Ada plays v2, Cy plays v2.
    f = DATA / "projects" / f"{L1}.json"
    proj = json.loads(f.read_text())
    g2 = proj["outputs"]["game"]
    g2["game_title"] += " (v2)"
    q = g2["levels"][0]["quiz_gates"][0]
    q["question"] = "[v2] " + q["question"]
    q["correct_index"] = (q["correct_index"] + 1) % 4
    f.write_text(json.dumps(proj, indent=2))
    ada_v2, ada_v2_score = play(L1, ada["id"], g2, [{"misses": 3}])   # 225, latest
    play(L1, cy["id"], g2, LOSS)
    print(f"server {BASE}; classroom A {A['id'][:8]} (lessons {L1[:8]}, {L2[:8]}), B {B['id'][:8]}\n")

    browser = p.chromium.launch()
    errors = []
    def new_page(viewport=(1280, 900)):
        ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
        page = ctx.new_page()
        def on_err(e):
            errors.append(str(e))
            print(f"  !! page error after check #{len(results)}: {e}")
        page.on("pageerror", on_err)
        return page
    def open_results(page, cid):
        page.goto(f"{BASE}/teacher/{cid}")
        page.wait_for_function("() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Game results')); return b && Object.keys(b).some(k=>k.startsWith('__reactProps')); }", timeout=60000)
        page.get_by_role("button", name="🎮 Game results").click()
        page.get_by_test_id("game-results-totals").wait_for(timeout=30000)
    def row(page, sid): return page.get_by_test_id("game-results-table").locator(f"tr[data-student='{sid}']")

    # ---------- 1. Lesson table ----------
    page = new_page()
    open_results(page, A["id"])
    sel = page.get_by_test_id("game-results-lesson")
    check(sel.input_value() == L1, "the lesson with results is selected by default")
    sel.select_option(L1)  # re-selecting the current lesson must not blank the results
    page.wait_for_timeout(1000)
    check(page.get_by_test_id("game-results-totals").is_visible(), "re-selecting the same lesson keeps its results on screen")
    totals = page.get_by_test_id("game-results-totals").inner_text()
    check("2 of 3 students played" in totals and "4 finished games" in totals, "totals count finished games only (unfinished attempts excluded)", totals)
    ada_row = row(page, ada["id"]).inner_text()
    check("Quest complete · ⭐ 225" in ada_row, "Ada's latest result is her newest finished game (225 on the current version)", ada_row.replace("\n", " | "))
    fc = row(page, ada["id"]).get_by_test_id("finished-count").inner_text()
    check(fc.startswith("3"), "Ada: 3 finished games (her unfinished attempt isn't counted)", fc)
    best = row(page, ada["id"]).locator("li")
    check(best.count() == 2 and best.nth(0).get_attribute("data-current") == "true" and "V2 · current" in best.nth(0).inner_text() and "225" in best.nth(0).inner_text()
          and best.nth(1).get_attribute("data-current") == "false" and "235" in best.nth(1).inner_text(),
          "best score per version, current version first and highlighted", " / ".join(best.nth(i).inner_text().replace("\n", " ") for i in range(best.count())))
    ben_row = row(page, ben["id"]).inner_text()
    check("Not played yet" in ben_row and row(page, ben["id"]).get_by_test_id("finished-count").inner_text().startswith("0") and row(page, ben["id"]).get_by_role("button").count() == 0,
          "a student with only an unfinished attempt shows 'Not played yet' and 0 finished games")
    versions = page.get_by_test_id("game-versions").locator("li")
    check(versions.count() == 2 and versions.nth(1).get_attribute("data-current") == "true" and "Version 2 · current" in versions.nth(1).inner_text(),
          "game versions listed with the current one highlighted")
    check("Olive" not in page.get_by_test_id("teacher-game-results").inner_text(), "no student from another classroom appears")
    shot(page, "t01-table")

    # ---------- 2. Drill-down: a student's games, a game's answers ----------
    row(page, ada["id"]).get_by_role("button", name="View Ada Synthetic's games").click()
    page.get_by_test_id("teacher-student-games").wait_for()
    check(page.evaluate("document.activeElement.tagName") == "H3", "opening a student moves focus to their heading")
    items = page.get_by_test_id("teacher-attempts").get_by_role("button")
    check(items.count() == 3, "the student's list shows 3 finished games, newest first", str(items.count()))
    items.nth(2).click()  # oldest = the 235 win on version 1
    review = page.get_by_test_id("teacher-attempt-review")
    review.wait_for()
    txt = review.inner_text()
    q0 = g1["levels"][0]["quiz_gates"][0]
    check("Played on" in txt and "Version 1" in txt and q0["question"] in txt and "[v2]" not in txt and q0["explanation"] in txt and "✓ chosen" in txt,
          "game details: version 1's questions with chosen answers and explanations")
    shot(page, "t02-review")
    review.get_by_role("button", name="← Ada Synthetic's games").click()
    page.get_by_test_id("teacher-student-games").wait_for()
    page.wait_for_timeout(200)
    check((page.evaluate("document.activeElement.getAttribute('data-focus-key')") or "").startswith("attempt-"), "back from a game: focus returns to that game's button")
    page.get_by_role("button", name="← All students").click()
    page.get_by_test_id("game-results-table").wait_for()
    page.wait_for_timeout(200)
    check(page.evaluate("document.activeElement.getAttribute('data-focus-key')") == f"student-{ada['id']}", "back to all students: focus returns to the student's button")
    # The loss on v1 shows the wrong answers against the correct ones.
    row(page, ada["id"]).get_by_role("button", name="View Ada Synthetic's games").click()
    page.get_by_test_id("teacher-attempts").get_by_role("button").nth(1).click()
    page.get_by_test_id("teacher-attempt-review").wait_for()
    t2 = page.get_by_test_id("teacher-attempt-review").inner_text()
    check("✗ chosen" in t2 and "✓ correct answer" in t2 and "wrong, −1 life" in t2.lower(), "a lost game shows wrong chosen answers next to the correct answers")
    page.get_by_role("button", name="← Ada Synthetic's games").click()
    page.get_by_role("button", name="← All students").click()

    # ---------- 3. Edit, archive, restore ----------
    assert patch_json(f"/api/classrooms/{A['id']}/lessons/{L1}", {"title": "Renamed quest lesson"}).ok
    assert patch_json(f"/api/classrooms/{A['id']}/lessons/{L1}", {"archived": True}).ok
    page.get_by_role("button", name="↻ Refresh").click()
    page.wait_for_timeout(500)
    page.get_by_test_id("game-results-totals").wait_for()
    archived_group = page.locator("optgroup[label^='Archived']")
    check(archived_group.count() == 1 and "Renamed quest lesson" in archived_group.inner_text(), "an archived lesson stays in the teacher's list (archived group, new title)")
    check(sel.input_value() == L1 and "4 finished games" in page.get_by_test_id("game-results-totals").inner_text() and page.get_by_text("Archived", exact=True).first.is_visible(),
          "its results are unchanged and labelled Archived")
    sel.select_option(L2)
    page.get_by_test_id("game-results-totals").wait_for()
    check("0 finished games" in page.get_by_test_id("game-results-totals").inner_text() and "no game yet" in page.get_by_test_id("teacher-game-results").inner_text(),
          "switching lessons: a lesson without a game shows nothing played")
    assert patch_json(f"/api/classrooms/{A['id']}/lessons/{L1}", {"archived": False}).ok
    page.get_by_role("button", name="↻ Refresh").click()
    page.wait_for_timeout(500)
    sel.select_option(L1)
    page.get_by_test_id("game-results-totals").wait_for()
    check("4 finished games" in page.get_by_test_id("game-results-totals").inner_text() and page.locator("optgroup[label^='Archived']").count() == 0,
          "after restoring, the lesson is active again with the same results")
    page.context.close()

    # ---------- 4. Classroom separation ----------
    page = new_page()
    open_results(page, B["id"])
    txt = page.get_by_test_id("teacher-game-results").inner_text()
    opts = page.get_by_test_id("game-results-lesson").locator("option").all_inner_texts()
    check("Olive Outsider" in txt and "Ada" not in txt and len(opts) == 1, "classroom B shows only its own lesson and students", f"options={len(opts)}")
    r = api.get(f"/api/classrooms/{B['id']}/lessons/{L1}/game-results")
    r2 = api.get(f"/api/classrooms/{A['id']}/lessons/{L1}/game-results/{olive['id']}")
    r3 = api.get(f"/api/classrooms/{B['id']}/lessons/{LB}/game-results/{olive['id']}/attempts/{ada_win}")
    check(r.status == 404 and r2.status == 404 and r3.status == 404, "class A's lesson via class B, an outsider in class A, and Ada's game via Olive are all 404")
    page.context.close()

    # ---------- 5. Keyboard only ----------
    page = new_page()
    page.goto(f"{BASE}/teacher/{A['id']}")
    page.wait_for_function("() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Game results')); return b && Object.keys(b).some(k=>k.startsWith('__reactProps')); }", timeout=60000)
    def active(): return page.evaluate("document.activeElement ? (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim()) : ''")
    def tab_to(pred, max_tabs=150):
        for _ in range(max_tabs):
            page.keyboard.press("Tab")
            if pred(active()): return
        raise AssertionError("couldn't reach the target with Tab")
    tab_to(lambda t: t == "🎮 Game results"); page.keyboard.press("Enter")
    page.get_by_test_id("game-results-totals").wait_for()
    tab_to(lambda t: t.startswith("View Ada Synthetic")); page.keyboard.press("Enter")
    page.get_by_test_id("teacher-student-games").wait_for()
    tab_to(lambda t: t.startswith("Review game")); page.keyboard.press("Enter")
    page.get_by_test_id("teacher-attempt-review").wait_for()
    page.wait_for_timeout(100)
    on_heading = page.evaluate("document.activeElement.id") == "quest-review-heading"
    tab_to(lambda t: t.startswith("← Ada")); page.keyboard.press("Enter")
    page.get_by_test_id("teacher-student-games").wait_for()
    tab_to(lambda t: t == "← All students"); page.keyboard.press("Enter")
    page.get_by_test_id("game-results-table").wait_for()
    page.wait_for_timeout(150)
    back_focus = page.evaluate("document.activeElement.getAttribute('data-focus-key')") == f"student-{ada['id']}"
    # Change lesson with the keyboard (select + arrow key).
    page.get_by_test_id("game-results-lesson").focus()
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(500)
    changed = page.get_by_test_id("game-results-lesson").input_value() == L2
    check(on_heading and back_focus and changed, "keyboard only: open the tab, a student, a game and back, and change lesson", f"{on_heading},{back_focus},{changed}")
    page.context.close()

    # ---------- 6. Mobile ----------
    page = new_page(viewport=(375, 812))
    open_results(page, A["id"])
    no_scroll = lambda: page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
    cards = page.get_by_test_id("game-results-cards")
    ok_layout = cards.is_visible() and not page.get_by_test_id("game-results-table").is_visible()
    ok1 = no_scroll(); shot(page, "t03-mobile-cards")
    cards.get_by_role("button", name="View Ada Synthetic's games").click()
    page.get_by_test_id("teacher-attempts").get_by_role("button").first.click()
    page.get_by_test_id("teacher-attempt-review").wait_for()
    ok2 = no_scroll(); shot(page, "t04-mobile-review")
    check(ok_layout and ok1 and ok2, "mobile (375px): cards instead of the table; list and review fit without horizontal scrolling", f"{ok_layout},{ok1},{ok2}")
    page.context.close()

    # ---------- 7. A student's attempt file can't be read ----------
    cfile = DATA / "game-attempts" / cy["id"] / f"{L1}.json"
    good = cfile.read_text()
    cfile.write_text("{ damaged")
    page = new_page()
    open_results(page, A["id"])
    cy_row = row(page, cy["id"])
    note = page.get_by_test_id("game-results-unavailable-note")
    check(cy_row.get_by_test_id("results-unavailable").is_visible() and "Not played yet" not in cy_row.inner_text() and cy_row.get_by_role("button").count() == 0
          and note.is_visible() and "3 finished games" in page.get_by_test_id("game-results-totals").inner_text() and cfile.read_text() == "{ damaged",
          "unreadable attempt file: the student is flagged (not 'not played'), left out of the totals with a note, and the file is untouched")
    shot(page, "t05-unreadable")
    cfile.write_text(good)
    page.get_by_role("button", name="↻ Refresh").click()
    page.wait_for_timeout(500)
    page.get_by_test_id("game-results-totals").wait_for()
    check("4 finished games" in page.get_by_test_id("game-results-totals").inner_text() and page.get_by_test_id("game-results-unavailable-note").count() == 0
          and "⭐ 30" in row(page, cy["id"]).inner_text(), "after the file is restored the student's results are back")
    page.context.close()

    check(not errors, "no page errors", "; ".join(errors[:3]))
    browser.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
