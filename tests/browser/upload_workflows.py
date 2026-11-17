#!/usr/bin/env python3
"""Browser checks of both upload workflows (Chromium via Playwright for Python).

    BASE=http://localhost:3000 python3 tests/browser/upload_workflows.py [--shots DIR]

Run against `npm run dev` or `npm run build && npm start`, started with a
throwaway DITO_DATA_DIR and no API keys (mock mode). Creates its own synthetic
classroom. Generate the on-demand oversized file first:
    npm run fixtures:documents -- --oversized

Drag-and-drop note: headless browsers can't perform an OS-level drag from the
desktop. Drops are simulated by dispatching real DragEvents carrying a
DataTransfer with a File, which exercises the page's own drag handlers.
"""
import base64, json, os, pathlib, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3000").rstrip("/")
ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / "tests" / "fixtures" / "documents"
SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None

results = []
def check(ok, label, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  — {detail}" if detail else ""))

def api(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None,
                                 headers={"content-type": "application/json"}, method="POST" if body else "GET")
    return json.loads(urllib.request.urlopen(req).read())

def lesson_count(cid): return len(api(f"/api/classrooms/{cid}")["lessons"])

DROP_JS = """
async ([selector, files, target]) => {
  const el = target === 'outside' ? document.querySelector('h1') : document.querySelector(selector);
  const dt = new DataTransfer();
  for (const [name, b64] of files) dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name));
  const fire = (type) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); el.dispatchEvent(ev); return ev.defaultPrevented; };
  const r = { dragenter: fire('dragenter'), dragover: fire('dragover') };
  await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 50))); // let React render the drag state
  r.highlighted = !!document.querySelector(selector + '[data-drag-over]');
  r.drop = fire('drop');
  return r;
}
"""
def b64(name): return base64.b64encode((FIX / name).read_bytes()).decode()
ZONE = "[data-testid=file-drop-zone]"

def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)

def goto(page, url):
    """Navigate and wait until React has hydrated the uploader (handlers attached).
    Before hydration the server-rendered zone doesn't react yet; in `next dev` that
    window is long enough for a script to hit it."""
    page.goto(url)
    page.wait_for_function("() => { const b = document.querySelector('[data-testid=choose-file]');"
                           " return !!b && Object.keys(b).some(k => k.startsWith('__reactProps')); }", timeout=60000)

def tab_to(page, testid, limit=40):
    """Reach an element with the keyboard only; returns how many Tab presses it took."""
    page.locator("body").click(position={"x": 2, "y": 2})
    for n in range(1, limit + 1):
        page.keyboard.press("Tab")
        if page.evaluate("() => document.activeElement?.dataset?.testid") == testid:
            return n
    return None

def error_text(page, timeout=15000):
    page.wait_for_selector("[data-testid=upload-error]", timeout=timeout)
    return page.inner_text("[data-testid=upload-error]")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    posts = []
    page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and "/api/" in r.url else None)
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    cid = api("/api/classrooms", {"name": f"Browser check {time.strftime('%H:%M:%S')}", "subject": "Synthetic Science", "professor_name": "Prof. Synthetic"})["classroom"]["id"]
    teacher = f"{BASE}/teacher/{cid}"
    print(f"server {BASE}, synthetic classroom {cid}\n")

    # ---------------- Teacher classroom uploader ----------------
    goto(page, teacher)
    hint = page.inner_text(ZONE)
    check("PDF, Word (.docx), plain text (.txt) or Markdown (.md) · up to 10 MiB" in hint, "teacher: zone states accepted types and the 10 MiB limit")
    check(page.get_attribute("[data-testid=file-input]", "accept") == ".pdf,.docx,.txt,.md,.markdown", "teacher: file dialog filter no longer offers .doc")

    # T1 keyboard only: Tab to the zone, Enter opens the dialog, choose the PDF, submit with Enter.
    presses = tab_to(page, "choose-file")
    check(presses is not None, "teacher: zone reachable with Tab", f"{presses} Tab presses")
    with page.expect_file_chooser(timeout=5000) as fc:
        page.keyboard.press("Enter")
    fc.value.set_files(str(FIX / "valid-lesson.pdf"))
    page.wait_for_function("() => document.querySelector('[data-testid=choose-file]').innerText.includes('valid-lesson.pdf')")
    check(True, "teacher: Enter on the zone opens the file dialog; PDF selected")
    page.keyboard.press("Tab")  # -> Remove file button
    check(page.evaluate("() => document.activeElement.dataset.testid") == "remove-file", "teacher: 'Remove file' is keyboard reachable")
    page.focus("form[data-testid=lesson-uploader] button[type=submit]")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-testid=upload-success]", timeout=30000)
    page.wait_for_selector("text=The Lantern Moths of Vellmark Valley", timeout=15000)
    check(lesson_count(cid) == 1, "teacher: valid PDF (keyboard only) creates the lesson", page.inner_text("[data-testid=upload-success]"))
    shot(page, "teacher-1-pdf-created")

    # T2 drag and drop a DOCX onto the zone.
    r = page.evaluate(DROP_JS, [ZONE, [["valid-lesson.docx", b64("valid-lesson.docx")]], "zone"])
    check(r["dragover"] and r["drop"] and r["highlighted"], "teacher: zone accepts a dragged file (dragover/drop handled, highlighted)", json.dumps(r))
    page.wait_for_function("() => document.querySelector('[data-testid=choose-file]').innerText.includes('valid-lesson.docx')")
    page.click("form[data-testid=lesson-uploader] button[type=submit]")
    page.wait_for_selector("text=The Aqueducts of the Kingdom of Dunmere", timeout=30000)
    check(lesson_count(cid) == 2, "teacher: dropped DOCX creates the lesson")

    # T3 ordinary file selection: Markdown and TXT.
    for name, title in [("valid-lesson.md", "Orbits and the Skyport of Caldera Nine"), ("valid-lesson.txt", "Cloud Harvesting on the Floating Isles")]:
        page.set_input_files("[data-testid=file-input]", str(FIX / name))
        page.click("form[data-testid=lesson-uploader] button[type=submit]")
        page.wait_for_selector(f"text={title}", timeout=30000)
    check(lesson_count(cid) == 4, "teacher: Markdown and TXT via the file dialog create lessons")
    # 51-page PDF exactly at the 60,000-character limit (blank pages): accepted in full.
    page.set_input_files("[data-testid=file-input]", str(FIX / "blank-pages-at-limit.pdf"))
    page.click("form[data-testid=lesson-uploader] button[type=submit]")
    page.wait_for_selector("text=The Salt Glass Archive of Mereth", timeout=30000)
    newest = api(f"/api/classrooms/{cid}")["lessons"][-1]
    stored = api(f"/api/projects/{newest['id']}")["document_text"]
    check(len(stored) == 60000 and stored.endswith("Back cover - end of the archive."),
          "teacher: 51-page PDF at exactly 60,000 characters accepted with its last page", f"{len(stored)} chars stored")
    shot(page, "teacher-2-four-lessons")

    # T4 rejected in the browser before any upload.
    for name, expect in [("unsupported-image.png", "isn't a supported file type"),
                         ("unsupported-binary-disguised.txt", "binary data (it looks like a PNG image)"),
                         ("not-utf8-windows-1252.txt", "isn't saved as UTF-8"),
                         ("unsupported-legacy-word.doc", "Word 97–2003"),
                         ("empty-file.pdf", "is empty (0 bytes)"),
                         ("mislabeled-text-file.pdf", "isn't one — it looks like plain text")]:
        before = len(posts)
        page.set_input_files("[data-testid=file-input]", str(FIX / name))
        msg = error_text(page)
        check(expect in msg and len(posts) == before and "📄" not in page.inner_text(ZONE),
              f"teacher: {name} rejected in the browser, nothing sent", msg[:90])
    shot(page, "teacher-3-browser-rejection")

    oversized = FIX / "generated" / "oversized-lesson.txt"
    if oversized.exists():
        before = len(posts)
        page.set_input_files("[data-testid=file-input]", str(oversized))
        msg = error_text(page)
        check("10.0 MiB, but the maximum is 10 MiB" in msg and len(posts) == before, "teacher: 10 MiB + 1 byte file rejected before upload", msg[:80])
    else:
        check(False, "teacher: oversized file check", "run: npm run fixtures:documents -- --oversized")

    # T5 rejected by the server (needs parsing) — message shown, nothing created, file kept for retry.
    for name, expect in [("damaged-truncated.docx", "damaged or incomplete"),
                         ("no-text-scanned.pdf", "no selectable text"),
                         ("password-protected.pdf", "is password-protected"),
                         ("blank-pages-over-limit.pdf", "has 60,001 characters"),
                         ("too-long-text.pdf", "at most 60,000")]:
        count = lesson_count(cid)
        page.set_input_files("[data-testid=file-input]", str(FIX / name))
        page.wait_for_function(f"() => document.querySelector('[data-testid=choose-file]').innerText.includes('{name}')")
        page.click("form[data-testid=lesson-uploader] button[type=submit]")
        msg = error_text(page, 30000)
        check(expect in msg and lesson_count(cid) == count and name in page.inner_text(ZONE),
              f"teacher: {name} rejected by the server, no lesson, file stays selected", msg[:90])
    shot(page, "teacher-4-scanned-or-long")

    # T6 the same file can be chosen again after an attempt (input is reset after every selection).
    check(page.eval_on_selector("[data-testid=file-input]", "el => el.value") == "", "teacher: file input is reset after selection (same file can fire 'change' again)")
    page.click("[data-testid=remove-file]")
    page.set_input_files("[data-testid=file-input]", str(FIX / "too-long-text.pdf"))
    page.wait_for_function("() => document.querySelector('[data-testid=choose-file]').innerText.includes('too-long-text.pdf')")
    check(True, "teacher: same file selected again after removing it")
    page.click("[data-testid=remove-file]")

    # T7 file + pasted text -> choose one (no request).
    page.set_input_files("[data-testid=file-input]", str(FIX / "valid-lesson.txt"))
    page.fill("form[data-testid=lesson-uploader] textarea", "Pasted notes about tide pools, barnacles and anemones between the tides.")
    check(page.is_visible("[data-testid=both-inputs-note]"), "teacher: warns as soon as a file and pasted text are both present")
    before = len(posts)
    page.click("form[data-testid=lesson-uploader] button[type=submit]")
    msg = error_text(page)
    check("choose one" in msg and len(posts) == before, "teacher: file + text submission blocked with 'choose one'", msg[:80])
    shot(page, "teacher-5-file-and-text")
    page.click("[data-testid=remove-file]")

    # T8 pasted text: over the limit blocked, valid text accepted.
    page.fill("form[data-testid=lesson-uploader] textarea", "x" * 60001)
    counter = page.inner_text("#lesson-text-count")
    before = len(posts)
    page.click("form[data-testid=lesson-uploader] button[type=submit]")
    msg = error_text(page)
    check("60,001 / 60,000" in counter and "at most 60,000" in msg and len(posts) == before, "teacher: 60,001 pasted characters blocked with counter + message", counter)
    page.fill("form[data-testid=lesson-uploader] textarea", "Tide Pools of the Glass Coast. Barnacles, anemones and periwinkles live between the high and low water marks.")
    page.click("form[data-testid=lesson-uploader] button[type=submit]")
    page.wait_for_selector("text=Tide Pools of the Glass Coast", timeout=30000)
    check(lesson_count(cid) == 6, "teacher: pasted text creates a lesson")

    # T9 two files at once; a file dropped outside the zone doesn't navigate away.
    page.evaluate(DROP_JS, [ZONE, [["valid-lesson.txt", b64("valid-lesson.txt")], ["valid-lesson.md", b64("valid-lesson.md")]], "zone"])
    check("one file at a time" in error_text(page), "teacher: dropping two files asks for one at a time")
    url = page.url
    r = page.evaluate(DROP_JS, [ZONE, [["valid-lesson.pdf", b64("valid-lesson.pdf")]], "outside"])
    page.wait_for_timeout(300)
    check(r["drop"] is True and page.url == url, "teacher: a file dropped outside the zone is blocked (no navigation)", json.dumps(r))
    check(lesson_count(cid) == 6, "teacher: rejected attempts created no lessons (6 valid uploads = 6 lessons)")

    # ---------------- Standalone /upload page ----------------
    goto(page, f"{BASE}/upload")
    r = page.evaluate(DROP_JS, [ZONE, [["valid-lesson.pdf", b64("valid-lesson.pdf")]], "zone"])
    page.wait_for_function("() => document.querySelector('[data-testid=choose-file]').innerText.includes('valid-lesson.pdf')")
    page.click("form button[type=submit]:has-text('Build my Learning Blueprint')")
    page.wait_for_url("**/dashboard/*", timeout=30000)
    page.wait_for_selector("h1:has-text('The Lantern Moths of Vellmark Valley')", timeout=15000)
    check(True, "/upload: dropped PDF builds a lesson and opens its dashboard", page.url.replace(BASE, ""))
    shot(page, "upload-1-pdf-dashboard")

    goto(page, f"{BASE}/upload")
    presses = tab_to(page, "choose-file")
    with page.expect_file_chooser(timeout=5000) as fc:
        page.keyboard.press("Space")
    fc.value.set_files(str(FIX / "valid-lesson.docx"))
    page.wait_for_function("() => document.querySelector('[data-testid=choose-file]').innerText.includes('valid-lesson.docx')")
    page.focus("form button[type=submit]")
    page.keyboard.press("Enter")
    page.wait_for_url("**/dashboard/*", timeout=30000)
    page.wait_for_selector("h1:has-text('The Aqueducts of the Kingdom of Dunmere')", timeout=15000)
    check(True, "/upload: keyboard only (Tab, Space, Enter) uploads a DOCX", f"{presses} Tab presses")

    goto(page, f"{BASE}/upload")
    page.set_input_files("[data-testid=file-input]", str(FIX / "not-utf8-utf16.txt"))
    msg = error_text(page)
    check("UTF-16" in msg and "Save with Encoding" in msg, "/upload: UTF-16 text rejected with how-to-save-as-UTF-8 help", msg[:80])
    page.set_input_files("[data-testid=file-input]", str(FIX / "no-text-scanned.pdf"))
    page.wait_for_function("() => document.querySelector('[data-testid=choose-file]').innerText.includes('no-text-scanned.pdf')")
    page.click("form button[type=submit]")
    msg = error_text(page, 30000)
    check("OCR" in msg and "no-text-scanned.pdf" in page.inner_text(ZONE), "/upload: scanned PDF explained (needs selectable text / OCR), file kept", msg[:100])
    shot(page, "upload-2-scanned-pdf")
    page.set_input_files("[data-testid=file-input]", str(FIX / "no-text-scanned.pdf"))  # same file again
    page.click("form button[type=submit]")
    msg = error_text(page, 30000)
    check("OCR" in msg, "/upload: same file chosen again after the error is submitted again")
    page.click("[data-testid=remove-file]")
    page.set_input_files("[data-testid=file-input]", str(FIX / "valid-lesson.md"))
    page.click("form button[type=submit]")
    page.wait_for_url("**/dashboard/*", timeout=30000)
    check(True, "/upload: after errors, a valid Markdown file still goes through")

    check(not page_errors, "no JavaScript errors on the pages", "; ".join(page_errors)[:200])
    browser.close()

print(f"\n{'ALL PASSED' if all(results) else f'{results.count(False)} FAILED'} ({len(results)} checks)")
sys.exit(0 if all(results) else 1)
