#!/usr/bin/env python3
"""Browser checks of saved Concept Quest results (Chromium via Playwright for Python).

    DITO_DATA_DIR=<same dir as the server> BASE=http://localhost:3000 python3 tests/browser/game_results.py [--shots DIR]

Run against `npm run build && npm start` (or `npm run dev`) started with a
throwaway DITO_DATA_DIR and no API keys (mock mode). Creates its own synthetic
classrooms, lessons and students. To get a *different* game version without AI
keys (mock generation is deterministic), it rewrites the synthetic lesson's game
in DITO_DATA_DIR, as a teacher regeneration would; it touches nothing else.

Covers: win + loss saved and shown after a refresh, answer review, separate new
attempts, victory marking the game done (loss not), failed saves (network error
and HTTP 500) kept on the device and re-sent with the same attempt id after a
refresh and when the browser comes back online, rapid/double clicks, interrupted games not shown as finished, an
attempt started before a regeneration scored on its own version + the student
moving to the new version, best score per version with the current one
highlighted, a malformed game, no student Regenerate control on the game (other
formats keep theirs), teacher preview
not recorded, student/classroom separation, an archived lesson, keyboard-only
play, mobile layout (no horizontal scrolling), a damaged attempt file (result
kept, clear message, file untouched, saved after recovery), and student and
teacher views agreeing.
"""
import json, os, pathlib, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000").rstrip("/")
DATA = pathlib.Path(os.environ["DITO_DATA_DIR"])
FIX = pathlib.Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "documents"
SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
CHROME = os.environ.get("CHROMIUM")  # optional executable path

results = []
def check(ok, label, detail=""):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  — {detail}" if detail else ""))

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)

with sync_playwright() as p:
    api = p.request.new_context(base_url=BASE)
    def get(path): return api.get(path).json()
    def post_json(path, body): return api.post(path, data=json.dumps(body), headers={"content-type": "application/json"})
    def patch_json(path, body): return api.patch(path, data=json.dumps(body), headers={"content-type": "application/json"})
    def upload(cid, name="valid-lesson.txt"):
        r = api.post(f"/api/classrooms/{cid}/lessons", multipart={"file": {"name": name, "mimeType": "text/plain", "buffer": (FIX / name).read_bytes()}})
        assert r.ok, r.text()
        return r.json()["lesson"]["id"]
    def summary(lid, sid): return get(f"/api/lessons/{lid}/game/attempts?student_id={sid}")
    def project_file(lid): return DATA / "projects" / f"{lid}.json"
    def set_game(lid, mutate):
        f = project_file(lid); proj = json.loads(f.read_text()); mutate(proj["outputs"]["game"]); f.write_text(json.dumps(proj, indent=2))
        return proj["outputs"]["game"]

    stamp = time.strftime("%H:%M:%S")
    A = post_json("/api/classrooms", {"name": f"Game results A {stamp}", "subject": "Synthetic Science", "professor_name": "Prof. Synthetic"}).json()["classroom"]
    B = post_json("/api/classrooms", {"name": f"Game results B {stamp}", "subject": "Synthetic History", "professor_name": "Prof. Other"}).json()["classroom"]
    L1, L2, L3 = upload(A["id"]), upload(A["id"], "valid-lesson.md"), upload(A["id"], "valid-lesson.docx")
    game = post_json(f"/api/projects/{L1}/generate", {"type": "game"}).json()["data"]
    post_json(f"/api/projects/{L2}/generate", {"type": "game"})
    post_json(f"/api/projects/{L3}/generate", {"type": "game"})
    set_game(L2, lambda g: g["levels"][1].__setitem__("quiz_gates", g["levels"][1]["quiz_gates"][:2]))  # malformed: 2 questions
    sam = post_json("/api/students", {"name": "Synthetic Sam", "interests": ["clouds"], "join_code": A["join_code"]}).json()["student"]
    tia = post_json("/api/students", {"name": "Synthetic Tia", "interests": ["maps"], "join_code": A["join_code"]}).json()["student"]
    olive = post_json("/api/students", {"name": "Olive Outsider", "interests": [], "join_code": B["join_code"]}).json()["student"]
    print(f"server {BASE}; classroom A {A['id'][:8]} (lessons {L1[:8]}, {L2[:8]} malformed, {L3[:8]}), B {B['id'][:8]}; students sam {sam['id'][:8]}, tia {tia['id'][:8]}, olive {olive['id'][:8]} (class B)\n")

    browser = p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch()
    errors = []

    def new_page(student, viewport=(1280, 900)):
        ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
        if student:
            ctx.add_init_script(f"localStorage.setItem('dito_student', JSON.stringify({json.dumps({'id': student['id'], 'name': student['name']})}))")
        page = ctx.new_page()
        def on_err(e):
            errors.append(str(e))
            print(f"  !! page error after check #{len(results)}: {e}")
        page.on("pageerror", on_err)
        reqs = []
        page.on("request", lambda r: reqs.append((r.method, r.url.replace(BASE, ""))) if "/game/attempts" in r.url or "/api/events" in r.url else None)
        return page, reqs

    def open_lesson(page, lid, cid=None):
        page.goto(f"{BASE}/student/{cid or A['id']}/{lid}")
        page.wait_for_function("() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Play & win')); return b && Object.keys(b).some(k=>k.startsWith('__reactProps')); }", timeout=60000)
        page.get_by_role("button", name="Play & win").click()

    def area(page): return page.get_by_test_id("game-play-area")
    def score(page): return page.get_by_test_id("game-score").inner_text()

    def answer(page, q, correct, dbl=False):
        i = q["correct_index"] if correct else (q["correct_index"] + 1) % len(q["options"])
        area(page).get_by_role("button", name=q["options"][i], exact=True).click()
        cont = area(page).get_by_role("button", name="Continue →")
        cont.dblclick() if dbl else cont.click()

    def matching(page, lvl, misses=0):
        a = area(page)
        for _ in range(misses):
            a.get_by_role("button", name=lvl["matching_pairs"][0]["term"], exact=True).click()
            a.get_by_role("button", name=lvl["matching_pairs"][1]["match"], exact=True).click()
        for pr in lvl["matching_pairs"]:
            a.get_by_role("button", name=pr["term"], exact=True).click()
            a.get_by_role("button", name=pr["match"], exact=True).click()
        page.wait_for_timeout(700)

    def start_level(page, dbl=False):
        b = area(page).get_by_role("button", name="⚔️ Start level")
        b.dblclick() if dbl else b.click()

    def play_win(page, g, dbl=False):
        for i, lvl in enumerate(g["levels"]):
            start_level(page, dbl=dbl and i == 0)
            for q in lvl["quiz_gates"][:3]:
                answer(page, q, True, dbl)
            matching(page, lvl)
            answer(page, lvl["boss_question"], True, dbl)
            if i + 1 < len(g["levels"]):
                area(page).get_by_role("button", name="Next level →").click()
        page.get_by_test_id("game-victory").wait_for()

    def play_loss(page, g):
        lvl = g["levels"][0]
        start_level(page)
        answer(page, lvl["quiz_gates"][0], True)
        answer(page, lvl["quiz_gates"][1], False)
        answer(page, lvl["quiz_gates"][2], False)
        matching(page, lvl)
        answer(page, lvl["boss_question"], False)
        page.get_by_test_id("game-over").wait_for()

    def save_status(page): return page.get_by_test_id("game-save-status").inner_text()
    def wait_saved(page, timeout=15000):
        page.get_by_test_id("game-save-status").get_by_text("Result saved").wait_for(timeout=timeout)

    # ---------- 1. Win: saved, completes the format, survives a refresh, review ----------
    page, reqs = new_page(sam)
    open_lesson(page, L1)
    check(area(page).get_by_role("button", name="⚔️ Start level").is_visible(), "first visit: no results yet, the quest intro is shown")
    check(page.get_by_role("button", name="↻ Regenerate").count() == 0, "students have no Regenerate control on the game")
    page.get_by_role("button", name="🃏").click()
    page.get_by_role("button", name="↻ Regenerate").wait_for(timeout=30000)
    check(True, "other formats are unchanged: the student Flashcards tab still has its Regenerate control")
    page.get_by_role("button", name="🎮").click()
    area(page).get_by_role("button", name="⚔️ Start level").wait_for()
    play_win(page, game)
    wait_saved(page)
    check("240" in page.get_by_test_id("game-victory").inner_text(), "victory screen shows 240", save_status(page))
    s = summary(L1, sam["id"])
    check(s["finished_count"] == 1 and s["latest"]["score"] == 240 and s["latest"]["outcome"] == "victory", "server recorded the victory (240)")
    page.get_by_role("button", name="✓ Completed").wait_for(timeout=5000)
    check(True, "a saved victory marks the Game format done (\"✓ Completed\" without clicking \"I got this\")")
    check(not any(m == "POST" and "/api/events" in u and "game_result" in u for m, u in reqs), "no game_result is sent to /api/events")
    shot(page, "01-victory-saved")

    page.reload()
    open_lesson(page, L1)
    page.get_by_test_id("game-results").wait_for()
    check(page.get_by_test_id("game-latest-score").inner_text() == "240" and "Quest complete" in page.get_by_test_id("game-latest").inner_text(),
          "after a refresh the saved result is shown (Quest complete, 240)")
    check(page.evaluate("document.activeElement && document.activeElement.id") == "quest-results-heading", "results heading receives focus")
    page.get_by_role("button", name="📝 Review answers").click()
    rv = page.get_by_test_id("game-review")
    rv.wait_for()
    q0 = game["levels"][0]["quiz_gates"][0]
    check(q0["question"] in rv.inner_text() and q0["explanation"] in rv.inner_text() and "✓ your answer" in rv.inner_text(),
          "review shows questions, the student's answers and explanations")
    shot(page, "02-review")
    rv.get_by_role("button", name="← Back to my results").click()

    # ---------- 2. Loss: a separate finished attempt; doesn't un-complete; best stays 240 ----------
    page.get_by_role("button", name="▶ Start new attempt").click()
    play_loss(page, game)
    wait_saved(page)
    s = summary(L1, sam["id"])
    check(s["finished_count"] == 2 and s["latest"]["outcome"] == "game_over" and s["latest"]["score"] == 30 and s["best_by_version"][0]["best_score"] == 240,
          "game over saved as a separate attempt (30); best score stays 240", f"count={s['finished_count']}")
    comps = [e for e in get(f"/api/classrooms/{A['id']}/analytics")["modality_opens"] if e["modality"] == "game"][0]["completions"]
    check(comps == 1, "class analytics count the game completion once", f"completions={comps}")
    page.get_by_role("button", name="📊 All my results").click()
    check(page.get_by_test_id("game-finished-count").inner_text() == "2", "results list shows 2 finished games")

    # ---------- 3. Failed save (network error): kept, not shown as saved, retried with the same id after a refresh ----------
    finish_urls = []
    page.on("request", lambda r: finish_urls.append(r.url) if r.url.endswith("/finish") else None)
    page.route("**/game/attempts/*/finish", lambda route: route.abort())
    page.get_by_role("button", name="▶ Start new attempt").click()
    play_loss(page, game)
    page.get_by_test_id("game-save-status").get_by_text("Not saved yet").wait_for(timeout=10000)
    check("Result saved" not in save_status(page), "network failure: the result is NOT shown as saved", save_status(page))
    pending = page.evaluate(f"localStorage.getItem('dito_game_pending:{sam['id']}:{L1}')")
    pend_id = json.loads(pending)[0]["attempt_id"] if pending else None
    check(pend_id is not None, "the finished answers are kept on the device (pending copy)")
    check(summary(L1, sam["id"])["finished_count"] == 2, "nothing recorded on the server while the save fails")
    shot(page, "03-save-failed")
    page.reload()
    open_lesson(page, L1)
    page.get_by_test_id("game-pending").wait_for()
    check("isn't saved yet" in page.get_by_test_id("game-pending").inner_text() and page.get_by_test_id("game-finished-count").inner_text() == "2",
          "after a refresh: shown as 'isn't saved yet', not counted as a finished game")
    page.unroute("**/game/attempts/*/finish")
    page.get_by_test_id("game-pending").get_by_role("button", name="Retry now").click()
    page.get_by_test_id("game-pending").wait_for(state="detached", timeout=15000)
    s = summary(L1, sam["id"])
    ids = {u.split("/game/attempts/")[1].split("/")[0] for u in finish_urls}
    check(s["finished_count"] == 3 and s["latest"]["id"] == pend_id and ids == {pend_id},
          "after the retry it is saved once, under the same attempt id", f"finish requests={len(finish_urls)} distinct ids={len(ids)}")
    check(page.evaluate(f"localStorage.getItem('dito_game_pending:{sam['id']}:{L1}')") is None, "the pending copy is cleared once the server confirms")

    # ---------- 4. Failed save (HTTP 500) then automatic retry ----------
    fails = {"n": 0}
    def flaky(route):
        if fails["n"] < 1:
            fails["n"] += 1
            route.fulfill(status=500, body=json.dumps({"error": "synthetic outage"}), headers={"content-type": "application/json"})
        else:
            route.continue_()
    page.route("**/game/attempts/*/finish", flaky)
    page.get_by_role("button", name="▶ Start new attempt").click()
    play_loss(page, game)
    wait_saved(page, timeout=20000)
    check(fails["n"] == 1 and summary(L1, sam["id"])["finished_count"] == 4, "HTTP 500 -> retried automatically -> saved once")
    page.unroute("**/game/attempts/*/finish")

    # ---------- 4b. Offline, then back online: the pending result is sent with its original attempt id ----------
    page.get_by_role("button", name="↻ Try again").click()
    base_count = summary(L1, sam["id"])["finished_count"]
    finish_urls.clear()
    lvl0 = game["levels"][0]
    start_level(page)  # the start needs the server
    answer(page, lvl0["quiz_gates"][0], True)
    answer(page, lvl0["quiz_gates"][1], False)
    answer(page, lvl0["quiz_gates"][2], False)
    matching(page, lvl0)
    page.context.set_offline(True)
    answer(page, lvl0["boss_question"], False)  # game over while offline
    page.get_by_test_id("game-over").wait_for()
    page.get_by_test_id("game-save-status").get_by_text("Not saved yet").wait_for(timeout=10000)
    offline_id = json.loads(page.evaluate(f"localStorage.getItem('dito_game_pending:{sam['id']}:{L1}')"))[0]["attempt_id"]
    # Failed sends back off 2 s, 4 s, 8 s...: after ~7 s offline the next timed retry is ~7 s away.
    page.wait_for_timeout(7000)
    failed_tries = len(finish_urls)
    status_before = save_status(page).split("\n")[0]
    t0 = time.time()
    page.context.set_offline(False)
    wait_saved(page, timeout=15000)
    took = time.time() - t0
    s = summary(L1, sam["id"])
    ids = {u.split("/game/attempts/")[1].split("/")[0] for u in finish_urls}
    check(s["finished_count"] == base_count + 1 and s["latest"]["id"] == offline_id and ids == {offline_id} and took < 4,
          "back online: the pending result is sent at once and saved once, with its original attempt id",
          f"status while offline: '{status_before[:40]}…'; {failed_tries} failed sends while offline; saved {took * 1000:.0f} ms after reconnecting; distinct ids={len(ids)}")

    # ---------- 5. Rapid clicks ----------
    count_before_dbl = summary(L1, sam["id"])["finished_count"]
    before = len([r for r in reqs if r[0] == "POST" and r[1].endswith("/game/attempts")])
    page.get_by_role("button", name="↻ Try again").dblclick()
    page.wait_for_timeout(300)
    if area(page).get_by_role("button", name="⚔️ Start level").count():  # the 2nd click may already have landed on it
        start_level(page, dbl=True)
    area(page).get_by_text("Quiz gate 1 of 3").wait_for()
    starts = [r for r in reqs if r[0] == "POST" and r[1].endswith("/game/attempts")][before:]
    check(len(starts) == 1, "double-clicking 'Try again' + 'Start level' starts one attempt", f"start requests={len(starts)}")
    lvl = game["levels"][0]
    q = lvl["quiz_gates"][0]
    area(page).get_by_role("button", name=q["options"][q["correct_index"]], exact=True).click()
    page.evaluate("() => { const b=[...document.querySelectorAll('[data-testid=game-play-area] button')].find(x=>x.textContent.includes('Continue')); b.click(); b.click(); b.click(); }")
    page.wait_for_timeout(300)
    check(score(page) == "⭐ 10", "three synchronous clicks on Continue count the answer once", score(page))
    for qq in lvl["quiz_gates"][1:3]:
        answer(page, qq, True, dbl=True)
    matching(page, lvl)
    answer(page, lvl["boss_question"], True, dbl=True)
    check(score(page) == "⭐ 80", "double-clicked Continue through level 1 scores 80", score(page))
    area(page).get_by_role("button", name="Next level →").click()
    for i, lv in enumerate(game["levels"][1:], start=1):
        start_level(page)
        for qq in lv["quiz_gates"][:3]:
            answer(page, qq, True, dbl=True)
        matching(page, lv)
        answer(page, lv["boss_question"], True, dbl=True)
        if i + 1 < len(game["levels"]):
            area(page).get_by_role("button", name="Next level →").click()
    wait_saved(page)
    s = summary(L1, sam["id"])
    check(s["finished_count"] == count_before_dbl + 1 and s["latest"]["score"] == 240, "the double-clicked game is saved once with 240", f"count={s['finished_count']}")
    count_after_dbl = s["finished_count"]

    # ---------- 6. Interrupted game is not shown as finished ----------
    page.get_by_role("button", name="↻ Play again").click()
    start_level(page)
    answer(page, lvl["quiz_gates"][0], True)
    page.reload()
    open_lesson(page, L1)
    page.get_by_test_id("game-results").wait_for()
    s = summary(L1, sam["id"])
    check(s["finished_count"] == count_after_dbl and page.get_by_test_id("game-finished-count").inner_text() == str(count_after_dbl) and page.get_by_test_id("game-latest-score").inner_text() == "240",
          "refresh mid-game: the interrupted attempt is not counted or shown as the latest result")

    # ---------- 7. Regeneration while an attempt is running ----------
    page.get_by_role("button", name="▶ Start new attempt").click()
    start_level(page)
    v2 = set_game(L1, lambda g: (g.__setitem__("game_title", g["game_title"] + " (v2)"),
                                 g["levels"][0]["quiz_gates"][0].__setitem__("question", "[v2] " + g["levels"][0]["quiz_gates"][0]["question"]),
                                 g["levels"][0]["quiz_gates"][0].__setitem__("correct_index", (g["levels"][0]["quiz_gates"][0]["correct_index"] + 1) % 4)))
    # Finish the already-started attempt with v1's answers.
    for qq in lvl["quiz_gates"][:3]:
        answer(page, qq, True)
    matching(page, lvl)
    answer(page, lvl["boss_question"], True)
    area(page).get_by_role("button", name="Next level →").click()
    for i, lv in enumerate(game["levels"][1:], start=1):
        start_level(page)
        for qq in lv["quiz_gates"][:3]:
            answer(page, qq, True)
        matching(page, lv)
        answer(page, lv["boss_question"], True)
        if i + 1 < len(game["levels"]):
            area(page).get_by_role("button", name="Next level →").click()
    wait_saved(page)
    s = summary(L1, sam["id"])
    check(s["latest"]["score"] == 240 and not s["latest"]["is_current_version"], "attempt started before the regeneration is scored on its own version (240)")
    page.get_by_role("button", name="↻ Play again").click()
    start_level(page)
    page.get_by_test_id("game-changed-notice").wait_for(timeout=15000)
    check(True, "starting again after the regeneration: the student is told and moved to the new version")
    start_level(page)
    area(page).get_by_text("[v2]").wait_for()
    check(True, "the new version's questions are shown")
    q2 = v2["levels"][0]["quiz_gates"][0]
    answer(page, q2, True)
    answer(page, v2["levels"][0]["quiz_gates"][1], False)
    answer(page, v2["levels"][0]["quiz_gates"][2], False)
    matching(page, v2["levels"][0])
    answer(page, v2["levels"][0]["boss_question"], False)
    page.get_by_test_id("game-over").wait_for()
    wait_saved(page)
    page.get_by_role("button", name="📊 All my results").click()
    best = page.get_by_test_id("game-best-by-version").locator("li")
    check(best.count() == 2 and best.nth(0).get_attribute("data-current") == "true" and "Current game" in best.nth(0).inner_text() and "30" in best.nth(0).inner_text()
          and "240" in best.nth(1).inner_text() and "Earlier version" in best.nth(1).inner_text(),
          "best score shown per version, current version first and highlighted", " | ".join(best.nth(i).inner_text().replace("\n", " ") for i in range(best.count())))
    shot(page, "04-best-by-version")
    # An old attempt's review still shows the old questions.
    page.get_by_test_id("game-history").get_by_role("button").nth(1).click()
    page.get_by_test_id("game-review").wait_for()
    txt = page.get_by_test_id("game-review").inner_text()
    check("earlier version" in txt and "[v2]" not in txt and lvl["quiz_gates"][0]["question"] in txt, "an earlier-version attempt is reviewed with its original questions")
    page.context.close()

    # ---------- 8. Malformed game ----------
    page, reqs = new_page(sam)
    open_lesson(page, L2)
    page.get_by_test_id("game-unplayable").wait_for()
    check("Level 2 has 2 quiz questions" in page.get_by_test_id("game-unplayable").inner_text() and page.get_by_role("button", name="⚔️ Start level").count() == 0,
          "a malformed game explains why it can't be played and offers no Start button")
    shot(page, "05-unplayable")
    page.context.close()

    # ---------- 9. Separation: another student, an outsider ----------
    page, reqs = new_page(tia)
    open_lesson(page, L1)
    check(area(page).get_by_role("button", name="⚔️ Start level").is_visible() and page.get_by_test_id("game-results").count() == 0,
          "another student of the class starts with no results")
    page.context.close()
    page, reqs = new_page(olive)
    open_lesson(page, L1)
    page.get_by_text("won't be saved").first.wait_for()
    start_level(page)
    area(page).get_by_text("Quiz gate 1 of 3").wait_for()
    check(not any(m == "POST" and "/game/attempts" in u for m, u in reqs), "a student from another class can open the link, but nothing is recorded for them")
    page.context.close()

    # ---------- 10. Teacher preview is not recorded ----------
    page, reqs = new_page(None)
    page.goto(f"{BASE}/dashboard/{L3}")
    page.get_by_role("button", name="Game", exact=False).filter(has_text="Game").first.click()
    page.get_by_role("button", name="↻ Regenerate").wait_for()
    start_level(page)
    area(page).get_by_text("Quiz gate 1 of 3").wait_for()
    check(not any("/game/attempts" in u for _, u in reqs), "teacher's lesson dashboard keeps Regenerate and records nothing")
    page.context.close()

    # ---------- 11. Archived lesson ----------
    page, reqs = new_page(sam)
    open_lesson(page, L3)
    g3 = get(f"/api/projects/{L3}")["outputs"]["game"]
    start_level(page)
    assert patch_json(f"/api/classrooms/{A['id']}/lessons/{L3}", {"archived": True}).ok
    gates3 = g3["levels"][0]["quiz_gates"]
    answer(page, gates3[0], False)
    answer(page, gates3[1], True)
    answer(page, gates3[2], True)
    matching(page, g3["levels"][0])
    answer(page, g3["levels"][0]["boss_question"], False)
    answer(page, g3["levels"][0]["boss_question"], False)
    page.get_by_test_id("game-over").wait_for()
    wait_saved(page)
    check(summary(L3, sam["id"])["finished_count"] == 1, "a student with the lesson already open can finish and save while it is archived")
    page.reload()
    page.get_by_test_id("archived-lesson-notice").wait_for()
    assert patch_json(f"/api/classrooms/{A['id']}/lessons/{L3}", {"archived": False}).ok
    open_lesson(page, L3)
    page.get_by_test_id("game-results").wait_for()
    check(page.get_by_test_id("game-finished-count").inner_text() == "1", "after restore the saved result is still there")
    page.context.close()

    # ---------- 12. Keyboard only ----------
    page, reqs = new_page(tia)
    page.goto(f"{BASE}/student/{A['id']}/{L3}")
    page.wait_for_function("() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Play & win')); return b && Object.keys(b).some(k=>k.startsWith('__reactProps')); }", timeout=60000)
    def tab_to(text, max_tabs=150, exact=True):
        for _ in range(max_tabs):
            page.keyboard.press("Tab")
            t = page.evaluate("document.activeElement ? document.activeElement.textContent.trim() : ''")
            if (t == text.strip()) if exact else (text.strip() in t):
                return True
        raise AssertionError(f"couldn't reach '{text}' with Tab")
    tab_to("Play & win", exact=False); page.keyboard.press("Enter")
    tab_to("⚔️ Start level"); page.keyboard.press("Enter")
    for lv_i, lv in enumerate(g3["levels"]):
        if lv_i > 0:
            tab_to("⚔️ Start level"); page.keyboard.press("Enter")
        for qq in lv["quiz_gates"][:3]:
            tab_to(qq["options"][qq["correct_index"]]); page.keyboard.press("Enter")
            ok = page.evaluate("document.activeElement.textContent.trim()") == "Continue →"
            if not ok: raise AssertionError("focus did not move to Continue")
            page.keyboard.press("Enter")
        for pr in lv["matching_pairs"]:
            tab_to(pr["term"]); page.keyboard.press("Space")
            tab_to(pr["match"]); page.keyboard.press("Enter")
        page.wait_for_timeout(700)
        b = lv["boss_question"]
        tab_to(b["options"][b["correct_index"]]); page.keyboard.press("Enter")
        if page.evaluate("document.activeElement.textContent.trim()") != "Continue →": raise AssertionError("focus did not move to Continue (boss)")
        page.keyboard.press("Enter")
        if lv_i + 1 < len(g3["levels"]):
            tab_to("Next level →"); page.keyboard.press("Enter")
    page.get_by_test_id("game-victory").wait_for()
    wait_saved(page)
    tab_to("📝 Review answers"); page.keyboard.press("Enter")
    page.get_by_test_id("game-review").wait_for()
    focus_ok = page.evaluate("document.activeElement.id") == "quest-review-heading"
    tab_to("← Back to the game"); page.keyboard.press("Enter")
    tab_to("📊 All my results"); page.keyboard.press("Enter")
    page.get_by_test_id("game-results").wait_for()
    check(focus_ok and summary(L3, tia["id"])["latest"]["score"] == 240, "a whole game, the review and the results are usable with the keyboard only (Tab/Enter/Space)")
    page.context.close()

    # ---------- 13. Mobile ----------
    page, reqs = new_page(sam, viewport=(375, 812))
    open_lesson(page, L1)
    page.get_by_test_id("game-results").wait_for()
    no_scroll = lambda: page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
    ok1 = no_scroll(); shot(page, "06-mobile-results")
    page.get_by_role("button", name="📝 Review answers").click(); page.get_by_test_id("game-review").wait_for()
    ok2 = no_scroll(); shot(page, "07-mobile-review")
    page.get_by_role("button", name="← Back to my results").click()
    page.get_by_role("button", name="▶ Start new attempt").click()
    start_level(page)
    ok3 = no_scroll(); shot(page, "08-mobile-question")
    check(ok1 and ok2 and ok3, "mobile (375px): results, review and questions fit without horizontal scrolling", f"{ok1},{ok2},{ok3}")
    page.context.close()

    # ---------- 14. Storage problem: a damaged attempt file never erases the waiting result ----------
    rue = post_json("/api/students", {"name": "Synthetic Rue", "interests": [], "join_code": A["join_code"]}).json()["student"]
    page, reqs = new_page(rue)
    open_lesson(page, L1)
    g_now = get(f"/api/projects/{L1}")["outputs"]["game"]
    lv = g_now["levels"][0]
    start_level(page)
    area(page).get_by_text("Quiz gate 1 of 3").wait_for()
    afile = DATA / "game-attempts" / rue["id"] / f"{L1}.json"
    good = afile.read_text()
    answer(page, lv["quiz_gates"][0], True)
    answer(page, lv["quiz_gates"][1], False)
    answer(page, lv["quiz_gates"][2], False)
    matching(page, lv)
    damaged = good[: len(good) // 2]
    afile.write_text(damaged)  # e.g. a truncated file after a disk problem
    answer(page, lv["boss_question"], False)
    page.get_by_test_id("game-over").wait_for()
    page.get_by_test_id("game-save-status").get_by_text("can't be read right now").wait_for(timeout=10000)
    st = save_status(page)
    pend = json.loads(page.evaluate(f"localStorage.getItem('dito_game_pending:{rue['id']}:{L1}')") or "[]")
    rue_id = pend[0]["attempt_id"] if pend else None
    check("Not saved yet" in st and "storage problem" in st and rue_id, "damaged attempt file: the result is not shown as saved, the reason is shown, the answers are kept", st.split("\n")[0][:110])
    trow = [r for r in get(f"/api/classrooms/{A['id']}/lessons/{L1}/game-results")["students"] if r["student_id"] == rue["id"]][0]
    check(trow["results_unavailable"] and trow["finished_count"] == 0, "teacher API flags the student's results as unreadable (not 'not played')")
    page.reload()
    open_lesson(page, L1)
    un = page.get_by_test_id("game-results-unavailable")
    un.wait_for()
    check("1 finished game is kept on this device" in un.inner_text() and afile.read_text() == damaged and sorted(p.name for p in afile.parent.iterdir()) == [afile.name],
          "after a refresh: clear recovery message, the result is still kept, and the damaged file is untouched (not moved or rewritten)")
    shot(page, "09-storage-problem")
    afile.write_text(good)  # storage fixed / file restored
    un.get_by_role("button", name="Try again").click()
    page.get_by_test_id("game-results").wait_for(timeout=15000)
    page.get_by_test_id("game-latest-score").wait_for()
    s = summary(L1, rue["id"])
    check(s["finished_count"] == 1 and s["latest"]["id"] == rue_id and s["latest"]["score"] == 30 and page.get_by_test_id("game-latest-score").inner_text() == "30"
          and page.evaluate(f"localStorage.getItem('dito_game_pending:{rue['id']}:{L1}')") is None,
          "after the file is restored and 'Try again': the kept result is saved once, server-scored (30), with its original attempt id")
    page.context.close()

    # ---------- 15. Students and the teacher see the same results ----------
    def agree(lid, student):
        mine = summary(lid, student["id"])
        theirs = get(f"/api/classrooms/{A['id']}/lessons/{lid}/game-results/{student['id']}")["summary"]
        row = [r for r in get(f"/api/classrooms/{A['id']}/lessons/{lid}/game-results")["students"] if r["student_id"] == student["id"]][0]
        return mine == theirs and row["finished_count"] == mine["finished_count"] and row["latest"] == mine["latest"] and row["best_by_version"] == mine["best_by_version"]
    pairs = [(L1, sam), (L1, rue), (L1, tia), (L3, sam), (L3, tia)]
    check(all(agree(l, st_) for l, st_ in pairs), "student and teacher APIs agree (after refreshes, retries, regeneration, archive/restore and storage recovery)",
          ", ".join(f"{l[:4]}/{st_['name'].split()[1]}:{summary(l, st_['id'])['finished_count']}" for l, st_ in pairs))
    page, _ = new_page(None)
    page.goto(f"{BASE}/teacher/{A['id']}")
    page.wait_for_function("() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Game results')); return b && Object.keys(b).some(k=>k.startsWith('__reactProps')); }", timeout=60000)
    page.get_by_role("button", name="🎮 Game results").click()
    page.get_by_test_id("game-results-lesson").select_option(L1)
    page.get_by_test_id("game-results-totals").wait_for()
    tr = page.get_by_test_id("game-results-table").locator(f"tr[data-student='{sam['id']}']")
    sam_latest = summary(L1, sam["id"])["latest"]
    check(f"⭐ {sam_latest['score']}" in tr.inner_text() and tr.get_by_test_id("finished-count").inner_text().startswith(str(summary(L1, sam['id'])['finished_count'])),
          "teacher dashboard shows the same latest score and finished count the student sees", tr.inner_text().replace("\n", " | ")[:120])
    page.context.close()

    check(not errors, "no page errors", "; ".join(errors[:3]))
    browser.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
