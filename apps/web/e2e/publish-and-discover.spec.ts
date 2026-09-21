import { expect, test, type Locator, type Page } from "@playwright/test";

const ALGIERS = { latitude: 36.7538, longitude: 3.0588 };

test.use({
  geolocation: ALGIERS,
  permissions: ["geolocation"],
  locale: "en-GB",
});

/**
 * Waits for the chosen category to exist before selecting it.
 *
 * The options are not in the markup at first paint: `SubmitWizard` renders
 * `categories={categoriesQuery.data ?? []}`, so the select holds only its
 * placeholder until `GET /v1/categories` resolves a tick later. Calling
 * `selectOption` before then fails with `Value "gathering" not found in options`
 * — Playwright's actionability checks cover visibility and enabledness, not the
 * presence of a particular option, so there is nothing for it to auto-wait on.
 * Task 13 hit this five times against the same component with a real browser.
 */
async function selectCategory(page: Page, slug: string) {
  const category = page.getByLabel(/category/i);
  await expect(category.locator(`option[value="${slug}"]`)).toBeAttached();
  await category.selectOption(slug);
}

/**
 * Presses Tab until `target` holds focus, so the traversal is what a keyboard
 * user actually experiences rather than a simulated jump.
 *
 * A fixed number of presses cannot work on the "where and when" step: between
 * the address box and the coordinate boxes sit the address-search field, the map
 * canvas, its two zoom buttons, the compass, the attribution toggle and the
 * MapLibre link — eleven stops, and any of them could change. Focus is the
 * assertion, and failing to reach the control is itself the failure.
 */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let i = 0; i < limit; i++) {
    const focused = await target
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    if (focused) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target} within ${limit} presses`);
}

test("publish a notice, find it nearby, and open its shared link", async ({ page, context }) => {
  const title = `Community gathering ${Date.now()}`;

  await page.goto("/submit");
  await expect(page.getByText(/appears publicly straight away/i)).toBeVisible();

  await selectCategory(page, "gathering");
  await page.getByLabel(/^title$/i).fill(title);
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByLabel(/venue name/i).fill("Place des Martyrs");
  await page.getByLabel(/address/i).fill("Place des Martyrs, Algiers");
  await page.getByLabel(/latitude/i).fill(String(ALGIERS.latitude));
  await page.getByLabel(/longitude/i).fill(String(ALGIERS.longitude));

  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const localValue = new Date(startsAt.getTime() - startsAt.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel(/date and time/i).fill(localValue);
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByLabel(/who may attend/i).selectOption("public");
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByRole("button", { name: /publish now/i }).click();

  // Landed on the detail page, published immediately.
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/now public/i)).toBeVisible();
  const noticeUrl = page.url();

  // It is discoverable from the home page.
  await page.goto("/");
  await page.getByRole("button", { name: /use my location/i }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // The map view renders and keeps the filter state in the URL.
  await page.getByRole("tab", { name: /map/i }).click();
  await expect(page).toHaveURL(/view=map/);

  // The shared link works in a cold context with no cookies.
  const fresh = await context.browser()!.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto(noticeUrl);
  await expect(freshPage.getByRole("heading", { name: title })).toBeVisible();
  await fresh.close();
});

test("the map view has a usable list equivalent sharing the same filters", async ({ page }) => {
  await page.goto("/?view=map&when=upcoming&sort=nearest");
  await page.getByRole("button", { name: /use my location/i }).click();

  // Spec §10: the list is the non-map equivalent, and switching preserves the filter state.
  await page.getByRole("tab", { name: /list/i }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page).toHaveURL(/sort=nearest/);
  await expect(page.getByRole("tab", { name: /list/i })).toHaveAttribute("aria-selected", "true");
});

test("the submit form is completable by keyboard alone", async ({ page }) => {
  const title = `Keyboard-only notice ${Date.now()}`;

  await page.goto("/submit");
  await expect(page.getByLabel(/category/i).locator('option[value="gathering"]')).toBeAttached();

  // Step 1 of 4: what. A select is chosen by typing the option's first letter,
  // because on macOS ArrowDown opens the popup without committing a value.
  await tabTo(page, page.getByLabel(/category/i));
  await page.keyboard.type("C"); // "Community Gathering"
  await expect(page.getByLabel(/category/i)).toHaveValue("gathering");
  await tabTo(page, page.getByLabel(/^title$/i));
  await page.keyboard.type(title);
  await tabTo(page, page.getByRole("button", { name: /continue/i }));
  await page.keyboard.press("Enter");

  // Step 2 of 4: where and when.
  await expect(page.getByLabel(/venue name/i)).toBeVisible();
  await tabTo(page, page.getByLabel(/venue name/i));
  await page.keyboard.type("Place des Martyrs");
  await tabTo(page, page.getByLabel(/address/i));
  await page.keyboard.type("Place des Martyrs, Algiers");

  // The coordinate boxes are the keyboard fallback for the map, which cannot be
  // driven by keyboard at all — so this is the path that has to work.
  await tabTo(page, page.getByLabel(/latitude/i));
  await page.keyboard.type(String(ALGIERS.latitude));
  await tabTo(page, page.getByLabel(/longitude/i));
  await page.keyboard.type(String(ALGIERS.longitude));

  /**
   * `datetime-local` is filled a segment at a time with arrow keys, not by typing
   * digits. Typing "25122026" into the field ran the digits across the segment
   * boundaries and produced "202614-12-25T03:00" — a year of 202614 — because
   * each segment consumes only as many digits as it holds and the overflow lands
   * in whichever segment has focus next. ArrowUp sets an empty segment to its
   * minimum, so one press per segment left-to-right yields 1 January of the
   * current year; the extra press on the year segment (the third, under the
   * en-GB order this file pins) makes it next year, which is always in the
   * future. The value is asserted below rather than assumed.
   */
  await tabTo(page, page.getByLabel(/date and time/i));
  const segmentPresses = [1, 1, 2, 1, 1];
  for (const [index, presses] of segmentPresses.entries()) {
    for (let press = 0; press < presses; press++) await page.keyboard.press("ArrowUp");
    if (index < segmentPresses.length - 1) await page.keyboard.press("ArrowRight");
  }
  const enteredDate = await page.getByLabel(/date and time/i).inputValue();
  expect(new Date(enteredDate).getTime()).toBeGreaterThan(Date.now());

  await tabTo(page, page.getByRole("button", { name: /continue/i }));
  await page.keyboard.press("Enter");

  // Step 3 of 4: details. Reaching it at all proves step 2 validated.
  await expect(page.getByLabel(/who may attend/i)).toBeVisible();
  await tabTo(page, page.getByLabel(/who may attend/i));
  await page.keyboard.type("O"); // "Open to everyone"
  await expect(page.getByLabel(/who may attend/i)).toHaveValue("public");
  await tabTo(page, page.getByRole("button", { name: /continue/i }));
  await page.keyboard.press("Enter");

  // Step 4 of 4: review and publish.
  const publish = page.getByRole("button", { name: /publish now/i });
  await expect(publish).toBeVisible();
  await tabTo(page, publish);
  await page.keyboard.press("Enter");

  // Spec §10's actual claim: the form is *completable* by keyboard alone. A
  // published notice is the only thing that proves it; counting the controls on
  // the first step — as this test first did — passes even if Tab never reaches
  // them and Enter never submits.
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/now public/i)).toBeVisible();
});

test("every control on the submit form has an accessible name", async ({ page }) => {
  await page.goto("/submit");
  await expect(page.getByLabel(/category/i).locator('option[value="gathering"]')).toBeAttached();

  /**
   * Checked per step, because the wizard renders one step at a time: a single
   * sweep of the page would only ever see the four controls of step 1.
   *
   * The map's own controls are excluded by selector, not by name — they are
   * MapLibre's, already labelled, and not part of the form being audited.
   */
  async function unlabelledControls() {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("form select, form input, form textarea"))
        .map((element) => {
          const id = element.id;
          const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          const name = (
            element.getAttribute("aria-label") ??
            forLabel?.textContent ??
            element.closest("label")?.textContent ??
            ""
          ).trim();
          return { id: id || element.getAttribute("name") || "(anonymous)", name };
        })
        .filter((control) => control.name === ""),
    );
  }

  expect(await unlabelledControls()).toEqual([]);

  await selectCategory(page, "gathering");
  await page.getByLabel(/^title$/i).fill("Accessible-name audit");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByLabel(/venue name/i)).toBeVisible();
  expect(await unlabelledControls()).toEqual([]);
});
