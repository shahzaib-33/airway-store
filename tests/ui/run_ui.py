"""Browser tests for the admin panel and the store, using the in-browser mock backend.
Run: python3 tests/ui/run_ui.py   (needs: pip install playwright && playwright install chromium)
"""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = (ROOT / "tests/ui/fixtures").as_uri() + "/"
PRODUCTS = (ROOT / "tests/ui/fixtures/products.json").read_text()
SHOTS = pathlib.Path("/tmp/airway-shots"); SHOTS.mkdir(exist_ok=True)
failures = []

def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond: failures.append(msg)

async def page_with_mock(browser, url, signed_in=False, images=None, viewport=(1440, 900)):
    pg = await browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    await pg.add_init_script(f"window.__FIXTURE_BASE__={json.dumps(FIX)};window.__PRODUCTS__={PRODUCTS};"
                             f"window.__SIGNED_IN__={'true' if signed_in else 'false'};window.__IMAGES__={json.dumps(images or [])};")
    await pg.add_init_script(path=str(ROOT / "tests/ui/mock-api.js"))
    await pg.goto((ROOT / url).as_uri())
    return pg, errors

async def admin_tests(b):
    print("Admin panel")
    pg, errors = await page_with_mock(b, "admin.html")
    await pg.wait_for_selector("#loginView:not([hidden])")
    await pg.fill("#email", "owner@airway.pk"); await pg.fill("#password", "wrong")
    await pg.click("#loginBtn"); await pg.wait_for_timeout(400)
    check("Wrong email or password" in await pg.inner_text("#loginErr"), "wrong password shows a clear error")
    await pg.fill("#password", "secret123"); await pg.click("#loginBtn")
    await pg.wait_for_selector("#appView:not([hidden])")
    check(await pg.locator(".pi").count() == 31, "all 31 existing products listed")
    check(not await pg.is_visible("#loginView"), "sign in box is hidden after signing in")
    await pg.screenshot(path=str(SHOTS / "admin-list.png"))

    # add a product: search starts automatically
    await pg.click("#newBtn")
    await pg.fill("#fName", "Black Leather Belt"); await pg.select_option("#fCat", "accessories"); await pg.fill("#fColor", "black"); await pg.fill("#fPrice", "2500")
    await pg.click("#saveBtn")
    await pg.wait_for_selector("#results .ic")
    await pg.wait_for_timeout(700)
    calls = await pg.evaluate("window.__CALLS__")
    check(calls and calls[0][0] == "search" and calls[0][1]["name"] == "Black Leather Belt" and calls[0][1]["category"] == "accessories" and calls[0][1]["color"] == "black",
          "adding a product runs an automatic search with its name, category and color")
    check(await pg.locator("#results .ic").count() == 3, "multiple matching images shown to pick from")
    check(not await pg.is_visible("#emptyState"), "empty message is hidden while editing")
    check("Pixabay API key is not set" in await pg.inner_text("#status"), "provider problems are shown, not hidden")
    check("3 photos were filtered out" in await pg.inner_text("#rejected summary"), "filtered photos are counted with reasons")
    check("Photos provided by" in await pg.inner_text("#finderSec"), "provider attribution shown with search results")
    await pg.screenshot(path=str(SHOTS / "admin-search.png"), full_page=True)

    # import first: becomes main image
    await pg.click("#results [data-import='0']"); await pg.wait_for_timeout(700)
    check(await pg.locator("#imgGrid .ic").count() == 1, "imported image appears in product images")
    check("MAIN" in await pg.inner_text("#imgGrid"), "first import becomes the main image")
    check("Photo by Ana P on Pexels" in await pg.inner_text("#imgGrid"), "photographer credit saved and shown")
    check("1 img" in await pg.inner_text(".pi.on"), "product list shows image count")
    # import second
    await pg.click("#results [data-import='0']"); await pg.wait_for_timeout(700)
    check(await pg.locator("#imgGrid .ic").count() == 2, "second image imported")
    # make second main
    await pg.click("#imgGrid [data-act='primary']"); await pg.wait_for_timeout(500)
    first_card = await pg.inner_text("#imgGrid .ic >> nth=0")
    check("MAIN" in first_card and "Pixabay" in first_card, "make main switches the main image")
    # replace main
    await pg.click("#imgGrid .ic >> nth=0 >> [data-act='replace']"); await pg.wait_for_timeout(300)
    check(await pg.locator(".replacing").count() == 1, "replace mode shows a clear banner")
    check("Use as replacement" in await pg.inner_text("#results"), "results switch to replacement buttons")
    await pg.screenshot(path=str(SHOTS / "admin-replace.png"), full_page=True)
    await pg.click("#results [data-import='0']"); await pg.wait_for_timeout(700)
    first_card = await pg.inner_text("#imgGrid .ic >> nth=0")
    check("MAIN" in first_card and "Unsplash" in first_card, "replacement keeps the main position")
    check("Linked from Unsplash" in first_card, "Unsplash image marked as linked, as Unsplash requires")
    # delete with confirm dialog
    await pg.click("#imgGrid .ic >> nth=1 >> [data-act='delete']"); await pg.wait_for_selector("#dlg.show")
    await pg.click("#dlgYes"); await pg.wait_for_timeout(600)
    check(await pg.locator("#imgGrid .ic").count() == 1, "delete removes the image after confirmation")
    await pg.screenshot(path=str(SHOTS / "admin-images.png"), full_page=True)
    check(not errors, f"no script errors in admin ({errors})")
    await pg.close()

    # not an admin
    pg, errors = await page_with_mock(b, "admin.html")
    await pg.wait_for_selector("#loginView:not([hidden])")
    await pg.fill("#email", "someone@else.com"); await pg.fill("#password", "secret123"); await pg.click("#loginBtn"); await pg.wait_for_timeout(500)
    check("not an admin" in await pg.inner_text("#loginErr"), "non admin accounts are refused")
    await pg.close()

    # phone layout
    pg, errors = await page_with_mock(b, "admin.html", signed_in=True, viewport=(390, 844))
    await pg.wait_for_selector(".pi"); await pg.screenshot(path=str(SHOTS / "admin-mobile-list.png"))
    await pg.click(".pi >> nth=0"); await pg.wait_for_selector("#results .ic"); await pg.wait_for_timeout(600)
    check(await pg.is_visible("#backList") and not await pg.is_visible(".side"), "phone shows editor full width with a back button")
    width = await pg.evaluate("document.documentElement.scrollWidth")
    check(width <= 392, f"no sideways scrolling on phone (width {width})")
    await pg.screenshot(path=str(SHOTS / "admin-mobile-editor.png"), full_page=True)
    check(not errors, f"no script errors on phone ({errors})")
    await pg.close()

async def store_tests(b):
    print("Store")
    images = [
        {"id": "i1", "product_id": "s1", "is_primary": True, "image_url": FIX + "shirt1.jpg", "thumb_url": FIX + "shirt1.jpg", "attribution": "Photo by Ana P on Pexels",
         "photographer_url": "https://www.pexels.com/@ana", "source_page_url": "https://www.pexels.com/photo/1/", "provider": "pexels"},
        {"id": "i2", "product_id": "p_belt", "is_primary": True, "image_url": FIX + "belt1.jpg", "thumb_url": FIX + "belt1.jpg", "attribution": "Image by pixuser from Pixabay",
         "photographer_url": "https://pixabay.com/users/pixuser-1/", "source_page_url": "https://pixabay.com/photos/2/", "provider": "pixabay"},
    ]
    pg, errors = await page_with_mock(b, "index.html", images=images)
    await pg.evaluate("""() => {}""")
    # add an accessory product to the mock database before the store loads its catalog
    await pg.close()
    prods = json.loads(PRODUCTS)
    prods.append({"id": "p_belt", "name": "Black Leather Belt", "price": 2500, "description": "Full grain leather.", "sizes": None,
                  "category": "accessories", "color": "black", "attributes": {}, "is_active": True})
    prods = [p for p in prods if p["id"] != "t5"]  # pretend Chino was switched off in admin
    pg = await b.new_page(viewport={"width": 1440, "height": 900})
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    await pg.add_init_script(f"window.__FIXTURE_BASE__={json.dumps(FIX)};window.__PRODUCTS__={json.dumps(prods)};window.__SIGNED_IN__=false;window.__IMAGES__={json.dumps(images)};")
    await pg.add_init_script(path=str(ROOT / "tests/ui/mock-api.js"))
    await pg.goto((ROOT / "index.html").as_uri()); await pg.wait_for_timeout(2600)
    await pg.click("nav button[data-go=latest]"); await pg.wait_for_timeout(2000)
    check(await pg.locator("#tabs button[data-k=accessories]").count() == 1, "accessories tab appears when the database has accessories")
    check(await pg.locator(".card[data-id=t5]").count() == 0, "products switched off in admin leave the store")
    check(await pg.locator(".card[data-id=s1] .tile img").count() == 1, "store shows the imported photo for an existing product")
    check("Photo by Ana P on Pexels" in await pg.inner_text(".card[data-id=s1]"), "photo credit shown on product card")
    await pg.click("#tabs button[data-k=accessories]"); await pg.wait_for_timeout(900)
    check(await pg.locator(".card").count() == 1 and "Black Leather Belt" in await pg.inner_text("#grid"), "new admin product appears in the store")
    await pg.screenshot(path=str(SHOTS / "store-accessories.png"))
    await pg.click(".card[data-id=p_belt]"); await pg.wait_for_timeout(900)
    check(await pg.locator("#qvTile img").count() == 1 and "from Pixabay" in await pg.inner_text("#qvCredit"), "quick view shows full photo and credit")
    await pg.screenshot(path=str(SHOTS / "store-quickview.png"))
    await pg.click("#qvAdd"); await pg.wait_for_timeout(1400)
    check(await pg.inner_text("#bagCount") == "1", "photo product can be added to the bag")
    await pg.evaluate("document.getElementById('ward').scrollTo(0,0)"); await pg.wait_for_timeout(600)
    await pg.hover(".comp >> nth=0"); await pg.wait_for_timeout(1400)
    check(await pg.locator(".comp >> nth=0 >> .g.photo img").count() == 1, "wardrobe hangs the real photo")
    await pg.screenshot(path=str(SHOTS / "store-wardrobe.png"))
    check(await pg.is_visible("#photoCredits"), "footer credits the photo providers")
    check(not errors, f"no script errors in store ({errors})")
    await pg.close()

    # unchanged behavior when not connected
    pg = await b.new_page(viewport={"width": 1440, "height": 900})
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    await pg.goto((ROOT / "index.html").as_uri()); await pg.wait_for_timeout(2600)
    await pg.click("nav button[data-go=latest]"); await pg.wait_for_timeout(1600)
    check(await pg.locator(".card").count() == 31, "without a database the store still shows all 31 products")
    check(not errors, f"no script errors offline ({errors})")
    await pg.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        await admin_tests(b)
        await store_tests(b)
        await b.close()
    print("\n" + ("ALL UI TESTS PASSED" if not failures else f"{len(failures)} FAILED"))
    sys.exit(1 if failures else 0)

asyncio.run(main())
