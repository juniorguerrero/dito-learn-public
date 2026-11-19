#!/usr/bin/env python3
"""Browser checks: recovering from damaged Concept Quest records (Chromium via Playwright for Python).

    DITO_DATA_DIR=<same dir as the server> BASE=http://localhost:3000 python3 tests/browser/game_recovery.py [--shots DIR]

Run against `npm run build && npm start` started with a throwaway DITO_DATA_DIR and
no API keys (mock mode); scripts/verify-game-results.sh does all of this. Creates
its own synthetic classroom, lessons and students, and damages only its own
records in DITO_DATA_DIR while a student is finishing a game:

  1. the game-version snapshot is edited (different answer key) but keeps its
     file name and version fingerprint;
  2. the student's attempt file is replaced by another student's (valid) file.

For each: the result is not shown as saved, the reason is shown, the answers stay
on the device, no file is rewritten or moved (the other student's record
included), and after the right file is restored the result is saved exactly
once under its original attempt id, scored on the original game. Student and
teacher views agree afterwards.
"""
import json, os, pathlib, sys, time
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

def result_events(student_id):
    f = DATA / "events.jsonl"
    return [e for e in (json.loads(l) for l in f.read_text().splitlines() if l) if e["type"] == "game_result" and e["student_id"] == student_id] if f.exists() else []

with sync_playwright() as p:
    api = p.request.new_context(base_url=BASE)
    def get(path): return api.get(path).json()
    def post_json(path, body): return api.post(path, data=json.dumps(body), headers={"content-type": "application/json"})
    def upload(cid, name):
        r = api.post(f"/api/classrooms/{cid}/lessons", multipart={"file": {"name": name, "mimeType": "text/plain", "buffer": (FIX / name).read_bytes()}})
        assert r.ok, r.text()
        return r.json()["lesson"]["id"]
    def summary(lid, sid): return api.get(f"/api/lessons/{lid}/game/attempts?student_id={sid}")

    stamp = time.strftime("%H:%M:%S")
    C = post_json("/api/classrooms", {"name": f"Recovery {stamp}", "subject": "Synthetic Science", "professor_name": "Prof. Synthetic"}).json()["classroom"]
    LS, LM = upload(C["id"], "valid-lesson.txt"), upload(C["id"], "valid-lesson.md")
    games = {lid: post_json(f"/api/projects/{lid}/generate", {"type": "game"}).json()["data"] for lid in (LS, LM)}
    join = lambda name: post_json("/api/students", {"name": name, "interests": [], "join_code": C["join_code"]}).json()["student"]
    sol, max_, bea = join("Synthetic Sol"), join("Synthetic Max"), join("Synthetic Bea")
    print(f"server {BASE}; classroom {C['id'][:8]}; snapshot lesson {LS[:8]}, misplaced-file lesson {LM[:8]}\n")

    browser = p.chromium.launch()
    errors = []
    def new_page(student):
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.add_init_script(f"localStorage.setItem('dito_student', JSON.stringify({json.dumps({'id': student['id'], 'name': student['name']})}))")
        page = ctx.new_page()
        def on_err(e):
            errors.append(str(e))
            print(f"  !! page error after check #{len(results)}: {e}")
        page.on("pageerror", on_err)
        return page
    def open_game(page, lid):
        page.goto(f"{BASE}/student/{C['id']}/{lid}")
        page.wait_for_function("() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Play & win')); return b && Object.keys(b).some(k=>k.startsWith('__reactProps')); }", timeout=60000)
        page.get_by_role("button", name="Play & win").click()
    area = lambda page: page.get_by_test_id("game-play-area")
    def answer(page, q, correct):
        i = q["correct_index"] if correct else (q["correct_index"] + 1) % len(q["options"])
        area(page).get_by_role("button", name=q["options"][i], exact=True).click()
        area(page).get_by_role("button", name="Continue →").click()
    def matching(page, lvl):
        for pr in lvl["matching_pairs"]:
            area(page).get_by_role("button", name=pr["term"], exact=True).click()
            area(page).get_by_role("button", name=pr["match"], exact=True).click()
        page.wait_for_timeout(700)
    def play_until_last_answer(page, g):
        """The reproduced loss: 1 right, 2 wrong, clean matching; the last (wrong) boss answer is left to the caller. Scores 30."""
        lvl = g["levels"][0]
        area(page).get_by_role("button", name="⚔️ Start level").click()
        area(page).get_by_text("Quiz gate 1 of 3").wait_for()
        answer(page, lvl["quiz_gates"][0], True)
        answer(page, lvl["quiz_gates"][1], False)
        answer(page, lvl["quiz_gates"][2], False)
        matching(page, lvl)
        return lvl["boss_question"]
    def pending(page, student, lid):
        raw = page.evaluate(f"localStorage.getItem('dito_game_pending:{student['id']}:{lid}')")
        return json.loads(raw) if raw else []
    def teacher_agrees(lid, student):
        mine = summary(lid, student["id"]).json()
        theirs = get(f"/api/classrooms/{C['id']}/lessons/{lid}/game-results/{student['id']}")["summary"]
        row = [r for r in get(f"/api/classrooms/{C['id']}/lessons/{lid}/game-results")["students"] if r["student_id"] == student["id"]][0]
        return mine == theirs and not row["results_unavailable"] and row["finished_count"] == mine["finished_count"] and row["latest"] == mine["latest"]

    # ---------- 1. Edited snapshot that keeps its version fingerprint ----------
    g = games[LS]
    page = new_page(sol)
    open_game(page, LS)
    boss = play_until_last_answer(page, g)
    version = summary(LS, sol["id"]).json()["current_version"]
    snap = DATA / "game-versions" / LS / f"{version}.json"
    original = snap.read_text()
    s = json.loads(original)
    q0 = s["game"]["levels"][0]["quiz_gates"][0]
    q0["correct_index"] = (q0["correct_index"] + 1) % len(q0["options"])  # version field and file name unchanged
    tampered = json.dumps(s, indent=2)
    snap.write_text(tampered)
    sol_file = DATA / "game-attempts" / sol["id"] / f"{LS}.json"
    sol_before = sol_file.read_text()
    answer(page, boss, False)
    page.get_by_test_id("game-over").wait_for()
    page.get_by_test_id("game-save-status").get_by_text("can't be read right now").wait_for(timeout=10000)
    status = page.get_by_test_id("game-save-status").inner_text().split("\n")[0]
    pend = pending(page, sol, LS)
    sol_id = pend[0]["attempt_id"] if pend else None
    check("Not saved yet" in status and "version" in status and sol_id, "edited snapshot: the result is not shown as saved, the reason is shown, the answers are kept", status[:120])
    check(snap.read_text() == tampered and sol_file.read_text() == sol_before and json.loads(sol_before)["attempts"][0]["status"] == "in_progress"
          and summary(LS, sol["id"]).json()["finished_count"] == 0 and not result_events(sol["id"]),
          "nothing was scored against the edited game, and no file was rewritten")
    page.reload()
    open_game(page, LS)
    pend_box = page.get_by_test_id("game-pending")
    pend_box.get_by_text("can't be read right now").wait_for(timeout=15000)
    check("isn't saved yet" in pend_box.inner_text(), "after a refresh the game is listed as not saved yet, with the reason")
    shot(page, "r01-edited-snapshot")
    snap.write_text(original)  # the right file is restored
    pend_box.get_by_role("button", name="Retry now").click()
    pend_box.wait_for(state="detached", timeout=20000)
    sm = summary(LS, sol["id"]).json()
    check(sm["finished_count"] == 1 and sm["latest"]["id"] == sol_id and sm["latest"]["score"] == 30 and len(result_events(sol["id"])) == 1 and not pending(page, sol, LS),
          "after restoring the snapshot: saved once under the original attempt id, scored on the original game (30), one event",
          f"count={sm['finished_count']} score={sm['latest']['score'] if sm['latest'] else None} events={len(result_events(sol['id']))}")
    check(teacher_agrees(LS, sol), "student and teacher views agree")
    page.context.close()

    # ---------- 2. Another student's attempt file in this student's place ----------
    g = games[LM]
    v_lm = summary(LM, bea["id"]).json()["current_version"]
    import uuid
    bea_attempt = str(uuid.uuid4())
    assert post_json(f"/api/lessons/{LM}/game/attempts", {"student_id": bea["id"], "attempt_id": bea_attempt, "version": v_lm}).status == 201
    bea_file = DATA / "game-attempts" / bea["id"] / f"{LM}.json"
    bea_bytes = bea_file.read_text()
    page = new_page(max_)
    open_game(page, LM)
    boss = play_until_last_answer(page, g)
    max_file = DATA / "game-attempts" / max_["id"] / f"{LM}.json"
    max_original = max_file.read_text()
    max_file.write_text(bea_bytes)  # e.g. a restore put Bea's copy in Max's place
    answer(page, boss, False)
    page.get_by_test_id("game-over").wait_for()
    page.get_by_test_id("game-save-status").get_by_text("can't be read right now").wait_for(timeout=10000)
    status = page.get_by_test_id("game-save-status").inner_text().split("\n")[0]
    pend = pending(page, max_, LM)
    max_id = pend[0]["attempt_id"] if pend else None
    check("Not saved yet" in status and "storage problem" in status and max_id, "misplaced attempt file: not shown as saved, reason shown, answers kept", status[:120])
    check(bea_file.read_text() == bea_bytes and max_file.read_text() == bea_bytes and not result_events(max_["id"]) and not result_events(bea["id"]),
          "neither record was written (the other student's file is untouched)")
    trow = [r for r in get(f"/api/classrooms/{C['id']}/lessons/{LM}/game-results")["students"] if r["student_id"] == max_["id"]][0]
    check(trow["results_unavailable"], "the teacher sees Max's results as unreadable, not as 'not played'")
    page.reload()
    open_game(page, LM)
    un = page.get_by_test_id("game-results-unavailable")
    un.wait_for(timeout=15000)
    check("1 finished game is kept on this device" in un.inner_text(), "after a refresh: recovery message with the kept game")
    shot(page, "r02-misplaced-file")
    max_file.write_text(max_original)  # the right file is restored
    un.get_by_role("button", name="Try again").click()
    page.get_by_test_id("game-results").wait_for(timeout=20000)
    page.get_by_test_id("game-latest-score").wait_for()
    sm = summary(LM, max_["id"]).json()
    check(sm["finished_count"] == 1 and sm["latest"]["id"] == max_id and sm["latest"]["score"] == 30 and len(result_events(max_["id"])) == 1 and not pending(page, max_, LM),
          "after restoring the file: saved once under the original attempt id (30), one event")
    check(bea_file.read_text() == bea_bytes and summary(LM, bea["id"]).json()["finished_count"] == 0, "Bea's record is still exactly as it was")
    check(teacher_agrees(LM, max_) and teacher_agrees(LM, bea), "student and teacher views agree for both students")
    page.context.close()

    check(not errors, "no page errors", "; ".join(errors[:3]))
    browser.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
