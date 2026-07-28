export const portalCredentialEnvs = {
  IonWave: { usernameEnv: "IONWAVE_USERNAME", passwordEnv: "IONWAVE_PASSWORD" },
  DemandStar: { usernameEnv: "DEMANDSTAR_USERNAME", passwordEnv: "DEMANDSTAR_PASSWORD" },
  Bonfire: { usernameEnv: "BONFIRE_USERNAME", passwordEnv: "BONFIRE_PASSWORD" },
  BidNet: { usernameEnv: "BIDNET_USERNAME", passwordEnv: "BIDNET_PASSWORD" }
};

export function portalCredentials(platform, env = process.env) {
  const names = portalCredentialEnvs[platform];
  if (!names) return null;
  const username = env[names.usernameEnv];
  const password = env[names.passwordEnv];
  if (!username || !password) return null;
  return { username, password };
}

export function missingCredentialMessage(platform) {
  const names = portalCredentialEnvs[platform];
  if (!names) return `${platform} has no credential mapping; run npm run login:portals manually.`;
  return `set ${names.usernameEnv} and ${names.passwordEnv} in .env or run npm run login:portals.`;
}

export function isSessionExpiredWarning(warning) {
  return /appears to need login|login expired|please log in/i.test(warning || "");
}

export async function attemptPortalLogin(page, portal, credentials) {
  try {
    await page.goto(portal.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    if (await hasCaptcha(page)) {
      return { ok: false, reason: "a CAPTCHA challenge is shown; log in manually with npm run login:portals" };
    }

    await loginGeneric(page, credentials.username, credentials.password);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    if (await hasCaptcha(page)) {
      return { ok: false, reason: "a CAPTCHA challenge is shown; log in manually with npm run login:portals" };
    }
    const stillWalled = await page.locator("input[type='password']").first().isVisible().catch(() => false);
    if (stillWalled) {
      return { ok: false, reason: "the login form is still visible after submitting credentials" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function hasCaptcha(page) {
  const frame = await page
    .locator("iframe[src*='captcha' i], iframe[src*='challenge' i], [class*='captcha' i], #captcha")
    .first()
    .isVisible()
    .catch(() => false);
  if (frame) return true;
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return /\bcaptcha\b|verify you are human|are you a robot/i.test(body);
}

export async function loginGeneric(page, username, password) {
  const userSelectors = [
    "input[type='email']",
    "input[name='email']",
    "input[name='username']",
    "input[name='UserName']",
    "input[id*='email' i]",
    "input[id*='user' i]",
    "input[autocomplete='username']",
    "input[type='text']"
  ];

  const passwordSelectors = [
    "input[type='password']",
    "input[name='password']",
    "input[id*='password' i]",
    "input[autocomplete='current-password']"
  ];

  let userInput = await firstVisible(page, userSelectors, { required: false, timeout: 3000 });
  if (!userInput) {
    await submit(page);
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    userInput = await firstVisible(page, userSelectors);
  }
  let passInput = await firstVisible(page, passwordSelectors, { required: false });

  await userInput.fill(username);

  if (!passInput) {
    await submit(page);
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    passInput = await firstVisible(page, passwordSelectors, { timeout: 30000 });
  }

  await passInput.fill(password);
  await submit(page);
}

async function firstVisible(page, selectors, options = {}) {
  const required = options.required ?? true;
  const deadline = Date.now() + (options.timeout ?? 15000);

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = Math.min(await locator.count().catch(() => 0), 20);
      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    await page.waitForTimeout(250);
  }

  if (!required) return null;
  throw new Error(`No visible input found for selectors: ${selectors.join(", ")}`);
}

async function submit(page) {
  const submitButton = page.locator([
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Sign in')",
    "button:has-text('Log in')",
    "button:has-text('Login')",
    "button:has-text('Continue')"
  ].join(", ")).first();

  if (await submitButton.isVisible().catch(() => false)) {
    await submitButton.click();
  } else {
    await page.keyboard.press("Enter");
  }
}
