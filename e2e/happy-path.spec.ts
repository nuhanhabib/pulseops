import { expect, type Page, test } from "@playwright/test";

const DEMO = { email: "demo@northwind.example", password: "pulseops-demo-2026" };
const ORG = "/org/northwind-demo";

async function signIn(page: Page, email = DEMO.email) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${ORG}/dashboard`);
}

test.describe("public site", () => {
  test("marketing pages render and lead to sign-up", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Know before it breaks");
    for (const name of ["Features", "Pricing", "Docs"]) {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await page.goto("/pricing");
    await expect(page.getByText("The paid tiers below are illustrative")).toBeVisible();
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("the workspace is not reachable without a session", async ({ page }) => {
    await page.goto(`${ORG}/monitors`);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    const api = await page.request.get("/api/v1/orgs/northwind-demo/monitors");
    expect(api.status()).toBe(401);
  });

  test("sign-in rejects bad credentials with a clear message", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(DEMO.email);
    await page.getByLabel("Password").fill("definitely-wrong-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("the public status page shows public names only", async ({ page }) => {
    await page.goto("/status/northwind");
    await expect(page.getByRole("heading", { level: 1, name: "Northwind Status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
    const body = await page.locator("body").innerText();
    // Private monitor names, hosts, and internal notes never reach the page.
    // (Incident titles are published as written, so they are not part of this check.)
    for (const secret of ["Storefront", "Auth Service", "Payments Gateway", "localhost:4010", "Reindex was kicked off", "Admin Console", "Marcus Oyelaran", "demo@northwind.example"]) {
      expect(body, secret).not.toContain(secret);
    }
    await page.goto("/status/northwind-internal");
    await expect(page.getByText("This page could not be found")).toBeVisible();
  });
});

test.describe("workspace", () => {
  test("dashboard, monitor lifecycle with a real check, incident lifecycle", async ({ page }) => {
    await signIn(page);

    // Dashboard shows live figures from the API.
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByLabel("Key metrics").getByText("Uptime", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Key metrics").getByText(/\d+(\.\d+)?%/).first()).toBeVisible();

    // Create a monitor, testing the configuration first.
    const name = `E2E monitor ${Date.now()}`;
    // Full navigations between sections: Next keeps the previous route mounted (hidden), which would make role queries ambiguous.
    await page.goto(`${ORG}/monitors`);
    await page.getByRole("link", { name: "New monitor" }).click();
    await page.getByLabel("Name").fill(name);

    // The network policy refuses private targets with a field-level message.
    await page.getByLabel("URL").fill("http://169.254.169.254/latest/meta-data/");
    await page.getByRole("button", { name: "Create monitor" }).click();
    await expect(page.getByText(/private|link-local/i).first()).toBeVisible();

    await page.getByLabel("URL").fill("http://localhost:4010/services/docs/health");
    await page.getByRole("button", { name: "Run test" }).click();
    await expect(page.getByText(/Responded with HTTP 200/)).toBeVisible();
    await page.getByRole("button", { name: "Create monitor" }).click();

    // The worker runs the first scheduled check; the page updates without a reload.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByRole("heading", { level: 1 }).getByText("Operational")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Checks" }).click();
    await expect(page.getByRole("cell", { name: "200" }).first()).toBeVisible();

    // Declare an incident for it.
    await page.goto(`${ORG}/incidents`);
    await page.getByRole("button", { name: "Declare incident" }).click();
    const title = `E2E incident ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByRole("dialog").getByText(name).click();
    await page.getByRole("dialog").getByRole("button", { name: "Declare incident" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.getByRole("link", { name })).toBeVisible();

    // Internal note, then an update that resolves it.
    await page.getByRole("radio", { name: "Internal note" }).click();
    await page.getByLabel("Internal note").fill("Suspect the cache.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Suspect the cache.")).toBeVisible();

    await page.getByRole("radio", { name: "Timeline update" }).click();
    await page.getByLabel("Timeline update").fill("Cache flushed, error rate back to normal.");
    await page.getByRole("combobox", { name: "Change status" }).click();
    await page.getByRole("option", { name: "Resolve incident" }).click();
    await page.getByRole("button", { name: "Post and resolve" }).click();
    await expect(page.getByText("Cache flushed, error rate back to normal.")).toBeVisible();
    await expect(page.locator("header").getByText("Resolved")).toBeVisible();

    // The AI assistant degrades gracefully when it is not configured.
    await expect(page.getByText("Not configured on this instance")).toBeVisible();

    // Clean up: delete the incident and the monitor through the UI.
    await page.getByRole("button", { name: "Delete incident" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete incident" }).click();
    await page.waitForURL(`**${ORG}/incidents`);
    await page.goto(`${ORG}/monitors`);
    await page.getByLabel("Search monitors").fill(name);
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Delete monitor" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete monitor" }).click();
    await page.waitForURL(`**${ORG}/monitors`);
  });

  test("a viewer gets a read-only workspace", async ({ page }) => {
    await signIn(page, "sofia@northwind.example");
    await page.goto(`${ORG}/monitors`);
    await expect(page.getByRole("link", { name: "Checkout API" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New monitor" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
    // The server agrees with the UI.
    const response = await page.request.post("/api/v1/orgs/northwind-demo/monitors", { data: { name: "x", url: "https://example.com" }, headers: { origin: new URL(page.url()).origin } });
    expect(response.status()).toBe(403);
  });

  test("the command palette finds records and the layout works on a phone", async ({ page }) => {
    await signIn(page);
    await expect(page.getByLabel("Key metrics").getByText("Uptime", { exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search monitors, incidents, pages…").fill("Checkout");
    await page.getByRole("option", { name: /Checkout API/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Checkout API");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ORG}/dashboard`);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Incidents" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Incidents" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
