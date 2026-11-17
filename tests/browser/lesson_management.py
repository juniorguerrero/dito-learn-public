#!/usr/bin/env python3
"""Browser checks of teacher lesson management (Chromium via Playwright for Python).

    BASE=http://localhost:3000 python3 tests/browser/lesson_management.py [--shots DIR]

Run against `npm run dev` or `npm run build && npm start`, started with a
throwaway DITO_DATA_DIR and no API keys (mock mode). Creates its own synthetic
classrooms, lessons and student; touches nothing else.

Covers: editing title/summary (incl. validation, keyboard, persistence after
reload), no regeneration, archive (teacher lists, counts, student list, archived
notice on links, dashboard banner), an already-open lesson still saving
progress, teacher progress history with the archived label, restore in the
original position with progress, repeated/rapid archive-restore, and isolation
between classrooms.
"""
import json, os, pathlib, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000").rstrip("/")
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

def hydrated(page, selector):
    page.wait_for_function("(sel) => { const el = document.querySelector(sel); return !!el && Object.keys(el).some(k => k.startsWith('__reactProps')); }",
                           arg=selector, timeout=60000)

with sync_playwright() as p:
    api = p.request.new_context(base_url=BASE)
    def get(path): return api.get(path).json()
    def post_json(path, body): return api.post(path, data=json.dumps(body), headers={"content-type": "application/json"})
    def upload(cid, name):
        r = api.post(f"/api/classrooms/{cid}/lessons", multipart={"file": {"name": name, "mimeType": "application/octet-stream", "buffer": (FIX / name).read_bytes()}})
        assert r.ok, r.text()
        return r.json()["lesson"]["id"]
    def lesson_file(lid): return get(f"/api/projects/{lid}")
    def progress(lid, sid): return get(f"/api/lessons/{lid}/progress?student_id={sid}")["progress"]

    stamp = time.strftime("%H:%M:%S")
    A = post_json("/api/classrooms", {"name": f"Lesson mgmt A {stamp}", "subject": "Synthetic Science", "professor_name": "Prof. Synthetic"}).json()["classroom"]
    B = post_json("/api/classrooms", {"name": f"Lesson mgmt B {stamp}", "subject": "Synthetic History", "professor_name": "Prof. Other"}).json()["classroom"]
    L1, L2, L3 = upload(A["id"], "valid-lesson.txt"), upload(A["id"], "valid-lesson.md"), upload(A["id"], "valid-lesson.docx")
    LB = upload(B["id"], "valid-lesson.pdf")
    for t in ("flashcards", "mindmap"):
        assert post_json(f"/api/projects/{L1}/generate", {"type": t}).ok
    student = post_json("/api/students", {"name": "Synthetic Sam", "interests": ["clouds"], "join_code": A["join_code"]}).json()["student"]
    print(f"server {BASE}; classroom A {A['id']}, classroom B {B['id']}; lessons {L1[:8]}/{L2[:8]}/{L3[:8]} (+{LB[:8]} in B); student {student['id'][:8]}\n")

    browser = p.chromium.launch()
    errors = []
    teacher = browser.new_context(viewport={"width": 1280, "height": 1000}).new_page()
    teacher.on("pageerror", lambda e: errors.append(f"teacher: {e}"))
    sctx = browser.new_context(viewport={"width": 1280, "height": 1000})
    sctx.add_init_script(f"localStorage.setItem('dito_student', {json.dumps(json.dumps({'id': student['id'], 'name': student['name']}))})")
    stu = sctx.new_page()
    stu.on("pageerror", lambda e: errors.append(f"student: {e}"))

    card = lambda lid: f"[data-testid=lesson-card][data-lesson-id='{lid}']"
    def open_teacher():
        teacher.goto(f"{BASE}/teacher/{A['id']}")
        hydrated(teacher, "[data-testid=lesson-count]")  # always present (an archived card may be collapsed)
    def active_ids(): return teacher.eval_on_selector_all("[data-testid=active-lessons] [data-testid=lesson-card]", "els => els.map(e => e.dataset.lessonId)")

    # ---------------- Edit title & summary ----------------
    open_teacher()
    check(teacher.inner_text("[data-testid=lesson-count]") == "3 lessons" and active_ids() == [L1, L2, L3], "teacher: 3 active lessons in upload order")
    before = lesson_file(L1)
    teacher.click(f"{card(L1)} [data-testid=edit-lesson]")
    note = teacher.inner_text(f"{card(L1)} [data-testid=edit-note]")
    check("Nothing is regenerated" in note and "2 generated formats" in note and "keep the wording" in note,
          "teacher: edit form explains nothing is regenerated and old wording stays inside generated formats", note[:110])
    teacher.fill(f"{card(L1)} [data-testid=edit-title]", "   ")
    teacher.click(f"{card(L1)} [data-testid=save-lesson]")
    msg = teacher.inner_text(f"{card(L1)} [data-testid=lesson-error]")
    check("can't be empty" in msg and lesson_file(L1)["blueprint"]["title"] == before["blueprint"]["title"], "teacher: empty title rejected, nothing saved", msg)
    teacher.keyboard.press("Escape")
    check(teacher.is_visible(f"{card(L1)} [data-testid=edit-lesson]") and teacher.evaluate("() => document.activeElement?.dataset?.testid") == "edit-lesson",
          "teacher: Escape cancels the edit and returns focus to the Edit button")

    # Keyboard: Enter on Edit, type, Enter submits.
    teacher.keyboard.press("Enter")
    teacher.fill(f"{card(L1)} [data-testid=edit-summary]", "How the islanders of Aeralith catch drinking water from fog.\n\nRevised for the Year 9 group.")
    teacher.fill(f"{card(L1)} [data-testid=edit-title]", "Cloud Harvesting (revised for Year 9)")
    teacher.focus(f"{card(L1)} [data-testid=edit-title]")
    teacher.keyboard.press("Enter")
    teacher.wait_for_selector(f"{card(L1)} [data-testid=lesson-title]:has-text('Cloud Harvesting (revised for Year 9)')")
    check("Saved “Cloud Harvesting (revised for Year 9)”" in teacher.inner_text("[data-testid=lesson-announcement]"), "teacher: edit saved with keyboard only and announced")
    after = lesson_file(L1)
    check(after["id"] == L1 and after["outputs"] == before["outputs"] and after["document_text"] == before["document_text"] and after["source_name"] == before["source_name"],
          "server: same id, source text and generated formats after the edit (no regeneration)",
          f"outputs unchanged: {sorted(after['outputs'].keys())}")
    teacher.reload(); hydrated(teacher, f"{card(L1)} [data-testid=edit-lesson]")
    check(teacher.inner_text(f"{card(L1)} [data-testid=lesson-title]").startswith("Cloud Harvesting (revised for Year 9)")
          and "Revised for the Year 9 group." in teacher.inner_text(f"{card(L1)} [data-testid=lesson-summary]"),
          "teacher: edit persists after reload")
    shot(teacher, "1-teacher-after-edit")

    # ---------------- Student sees the edit, studies ----------------
    stu.goto(f"{BASE}/student/{A['id']}")
    stu.wait_for_selector("text=Cloud Harvesting (revised for Year 9)", timeout=30000)
    check(True, "student: class page shows the edited title")
    stu.goto(f"{BASE}/student/{A['id']}/{L1}")
    stu.wait_for_selector("h1:has-text('Cloud Harvesting (revised for Year 9)')", timeout=30000)
    stu.wait_for_selector("text=✓ Progress saved", timeout=30000)
    stu.click("button:has-text('Flashcards')")
    stu.wait_for_selector("text=Card 1 /", timeout=30000)
    stu.click("button:has-text('I knew it')"); stu.click("button:has-text('Next card')")
    stu.wait_for_selector("text=Card 2 /"); stu.wait_for_selector("text=✓ Progress saved")
    pr = progress(L1, student["id"])
    check(pr["flashcards"]["known"] == [0] and pr["flashcards"]["current_index"] == 1, "student: flashcard answer saved before archiving", json.dumps(pr["flashcards"]))

    # ---------------- Archive (student keeps the lesson open) ----------------
    teacher.click(f"{card(L1)} [data-testid=archive-lesson]")
    confirm = teacher.inner_text(f"{card(L1)} [data-testid=confirm-archive]")
    check("can still finish and save" in confirm and "restore it any time" in confirm, "teacher: archive asks for confirmation and explains the effect")
    teacher.click(f"{card(L1)} [data-testid=confirm-archive-button]")
    teacher.wait_for_selector("[data-testid=archived-count]")
    check(active_ids() == [L2, L3] and teacher.inner_text("[data-testid=lesson-count]") == "2 lessons" and teacher.inner_text("[data-testid=archived-count]").strip() == "· 1 archived",
          "teacher: archived lesson leaves the active list; counts update", teacher.inner_text("[data-testid=toggle-archived]").split("\n")[0])
    teacher.reload(); hydrated(teacher, "[data-testid=toggle-archived]")
    teacher.click("[data-testid=toggle-archived]")
    arch = teacher.inner_text(f"[data-testid=archived-lessons] {card(L1)}")
    check(active_ids() == [L2, L3] and "ARCHIVED" in arch.upper() and teacher.get_attribute(card(L1), "data-archived") == "true",
          "teacher: archive persists after reload; shown under Archived lessons with a label", arch.split("\n")[0])
    shot(teacher, "2-teacher-archived-section")

    # The already-open lesson keeps saving.
    stu.click("button:has-text('I knew it')"); stu.click("button:has-text('Next card')")
    stu.wait_for_selector("text=Card 3 /"); stu.wait_for_selector("text=✓ Progress saved")
    stu.click("button:has-text('I got this')")
    stu.wait_for_selector("button:has-text('✓ Completed')", timeout=15000)
    pr = progress(L1, student["id"])
    check(pr["flashcards"]["known"] == [0, 1] and pr["flashcards"]["current_index"] == 2 and "flashcards" in pr["completed"],
          "student: lesson that was already open still saves answers and 'I got this' after archiving", json.dumps({"fc": pr["flashcards"], "done": list(pr["completed"])}))

    # Links now show the archived notice; the class list no longer has it.
    stu.reload()
    stu.wait_for_selector("[data-testid=archived-lesson-notice]", timeout=30000)
    notice = stu.inner_text("[data-testid=archived-lesson-notice]")
    check("This lesson has been archived" in notice and "Cloud Harvesting (revised for Year 9)" in notice and "progress on it is kept" in notice,
          "student: reloading / opening the link shows the archived notice", notice.replace("\n", " ")[:110])
    shot(stu, "3-student-archived-notice")
    stu.click("text=See the active lessons")
    stu.wait_for_url(f"**/student/{A['id']}")
    stu.wait_for_selector("text=Orbits and the Skyport", timeout=30000)
    check("Cloud Harvesting (revised for Year 9)" not in stu.inner_text("main"), "student: class page no longer lists the archived lesson")

    teacher.goto(f"{BASE}/dashboard/{L1}")
    check("This lesson is archived" in teacher.inner_text("[data-testid=dashboard-archived-banner]"), "teacher: lesson dashboard shows an archived banner")
    teacher.goto(f"{BASE}/teacher")
    teacher.wait_for_selector(f"a[href='/teacher/{A['id']}']")
    check("2 lessons · 1 archived" in teacher.inner_text(f"a[href='/teacher/{A['id']}']"), "teacher: classroom index shows active and archived counts")

    # Teacher still sees the archived lesson's progress, labelled.
    open_teacher()
    teacher.click("button:has-text('Students')")
    teacher.click(f"button:has-text('Synthetic Sam')")
    teacher.wait_for_selector("[data-testid=lesson-progress][data-archived=true]", timeout=15000)
    row = teacher.inner_text("[data-testid=lesson-progress][data-archived=true]")
    check("Cloud Harvesting (revised for Year 9)" in row and "ARCHIVED" in row.upper() and "1 / 8 formats done" in row and "2/" in row,
          "teacher: student detail keeps the archived lesson's progress, clearly labelled", row.replace("\n", " ")[:120])
    shot(teacher, "4-teacher-student-progress-archived")
    teacher.keyboard.press("Escape"); teacher.mouse.click(5, 5)

    # ---------------- Restore; repeated / rapid actions ----------------
    open_teacher()
    teacher.click("[data-testid=toggle-archived]")
    teacher.dblclick(f"{card(L1)} [data-testid=restore-lesson]")  # double click: must not duplicate
    teacher.wait_for_function(f"() => !document.querySelector(\"[data-testid=archived-lessons] [data-lesson-id='{L1}']\")")
    check(active_ids() == [L1, L2, L3] and teacher.locator(card(L1)).count() == 1, "teacher: double-clicked restore puts it back once, in its original position")
    for i in range(2):  # archive/restore cycles through the UI
        teacher.click(f"{card(L1)} [data-testid=archive-lesson]"); teacher.click(f"{card(L1)} [data-testid=confirm-archive-button]")
        teacher.wait_for_selector("[data-testid=toggle-archived]")
        if teacher.get_attribute("[data-testid=toggle-archived]", "aria-expanded") != "true": teacher.click("[data-testid=toggle-archived]")
        teacher.click(f"{card(L1)} [data-testid=restore-lesson]")
        teacher.wait_for_function(f"() => !document.querySelector(\"[data-testid=archived-lessons] [data-lesson-id='{L1}']\")")
    # Several tabs clicking at once (parallel requests).
    statuses = teacher.evaluate("""async ([cid, lid]) => Promise.all(Array.from({length: 6}, () =>
        fetch(`/api/classrooms/${cid}/lessons/${lid}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify({archived: true})})
          .then(async r => ({status: r.status, ...(await r.json())}))))""", [A["id"], L1])
    check(all(s["status"] == 200 for s in statuses) and sum(1 for s in statuses if s["changed"]) == 1 and len({s["lesson"]["archived_at"] for s in statuses}) == 1,
          "server: 6 simultaneous archive requests → archived once, one archive time", f"changed: {[s['changed'] for s in statuses]}")
    post = api.patch(f"/api/classrooms/{A['id']}/lessons/{L1}", data=json.dumps({"archived": False}), headers={"content-type": "application/json"})
    cls = get(f"/api/classrooms/{A['id']}")
    check(post.ok and cls["classroom"]["lesson_ids"] == [L1, L2, L3] and [l["id"] for l in cls["lessons"]] == [L1, L2, L3] and cls["archived_lessons"] == [],
          "server: after all cycles — no duplicates, original order, nothing left archived")
    open_teacher()
    check(active_ids() == [L1, L2, L3] and teacher.locator("[data-testid=toggle-archived]").count() == 0, "teacher: after reload, all three active again in original order")
    shot(teacher, "5-teacher-restored")

    # Student gets the lesson back with the progress saved meanwhile.
    stu.goto(f"{BASE}/student/{A['id']}/{L1}")
    stu.wait_for_selector("h1:has-text('Cloud Harvesting (revised for Year 9)')", timeout=30000)
    stu.wait_for_selector("text=✓ Progress saved", timeout=30000)
    check("1 of 8 formats done" in stu.inner_text("[data-testid=lesson-progress]"), "student: restored lesson shows the completion made while it was archived")
    stu.click("button:has-text('Flashcards')")
    stu.wait_for_selector("text=Card 3 /", timeout=30000)
    check(True, "student: flashcards resume at card 3 (position saved while archived)")
    final = lesson_file(L1)
    check(final["outputs"] == before["outputs"] and final["document_text"] == before["document_text"], "server: source and generated formats unchanged after all edits/archives/restores")

    # ---------------- Isolation ----------------
    teacher.goto(f"{BASE}/teacher/{B['id']}")
    hydrated(teacher, f"{card(LB)} [data-testid=edit-lesson]")
    b_ids = teacher.eval_on_selector_all("[data-testid=active-lessons] [data-testid=lesson-card]", "els => els.map(e => e.dataset.lessonId)")
    check(b_ids == [LB] and teacher.inner_text("[data-testid=lesson-count]") == "1 lesson" and teacher.locator("[data-testid=toggle-archived]").count() == 0,
          "classroom B: its own single lesson, nothing archived")
    cross = teacher.evaluate("""async ([bid, lid]) => { const r = await fetch(`/api/classrooms/${bid}/lessons/${lid}`, {method: 'PATCH',
        headers: {'content-type': 'application/json'}, body: JSON.stringify({archived: true, title: 'Hijacked'})}); return {status: r.status, ...(await r.json())}; }""", [B["id"], L1])
    l1 = lesson_file(L1)
    check(cross["status"] == 404 and cross["code"] == "lesson_not_found" and not l1.get("archived_at") and l1["blueprint"]["title"] == "Cloud Harvesting (revised for Year 9)",
          "classroom B can't archive or rename classroom A's lesson (404, unchanged)")
    check(lesson_file(LB)["blueprint"]["title"].startswith("The Lantern Moths") and not lesson_file(LB).get("archived_at"), "classroom B's lesson untouched by A's edits")

    check(not errors, "no JavaScript errors in teacher or student pages", "; ".join(errors)[:200])
    browser.close()
    api.dispose()

print(f"\n{'ALL PASSED' if all(results) else f'{results.count(False)} FAILED'} ({len(results)} checks)")
sys.exit(0 if all(results) else 1)
