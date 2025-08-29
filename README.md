# Fast Website Automation Agent (Playwright + OpenAI Agents)

A browser automation agent that opens a browser, analyzes a page, clicks item, fills a signup form, and closes the session. It uses Playwright for real browser control and the OpenAI Agents API to orchestrate tool usage.

Main entrypoint: `index.js`.

## What it does
- Launches Chromium via Playwright.
- Provides tools the agent can call:
  - `open_url(url)` – navigate to a page.
  - `analyze_page(include_image?)` – return a fast DOM summary, optionally includes a base64 screenshot.
  - `click_sidebar(label)` – click a sidebar item by visible text.
  - `fill_signup_form({...})` – fill common signup fields and submit.
  - `finalize_session()` – close the browser to end the task.
- Runs an agent with a short workflow: open → analyze → click Sign Up → analyze → fill form → analyze → finalize.

## Requirements
- Node.js 18+ (recommended)
- Windows PowerShell (you can also use other shells)
- An OpenAI API key in your environment

## Setup
1) Install dependencies

Using pnpm (preferred):
```powershell
pnpm install
```

Using npm:
```powershell
npm install
```

2) Create a `.env` with your API key
```env
OPENAI_API_KEY=sk-...
```

3) Run

Using pnpm:
```powershell
pnpm start
```
or 

Using npm:
```powershell
npm start
```

If everything is set, a Chromium window will open and the automation will proceed.

## How it works
### Browser helpers
- `launchBrowser()`/`closeBrowser()` manage a single shared Playwright instance.
- `extractPageSummary()` runs in the page to collect:
  - `title`, `url`
  - `headings`: first 10 h1/h2/h3 texts
  - `clickable`: up to 30 visible anchors/buttons with center coordinates
  - `inputs`: up to 40 input/textarea/select descriptors
- `getScreenshotBase64()` captures a compressed JPEG and returns a base64 string.

### Tools (agent-callable)
- `open_url({ url })` → `{ success, opened }`
- `analyze_page({ include_image?: boolean })` → `{ success, analysis, base64? }`
- `click_sidebar({ label })` → `{ success, clicked, selector }` or `{ success:false, error }`
- `fill_signup_form({ firstName, lastName, email, password, confirmPassword })`
  - Uses robust, case-insensitive selectors and `locator.fill()`
  - Avoids filling confirm field as the main password by excluding `confirm`-like attributes
- `finalize_session({})` → closes browser

### Agent configuration
`websiteAutomationAgent` (model `gpt-5-mini`) is given clear instructions matching the tool names. The default run prompt in `main()` asks it to:
1. Open Your website
2. Analyze the page
3. Click "Sign Up" in the sidebar
4. Fill the signup form
5. Verify and finalize

You can change the target site or steps by editing the string passed to `run(websiteAutomationAgent, ...)` inside `index.js`.

## Using extractPageSummary directly
You can call it after navigating:
```js
const { page } = await launchBrowser();
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
const summary = await extractPageSummary();
console.log(summary);
```

To click one of the discovered clickable items by coordinates (fallback):
```js
const target = summary.clickable.find(c => /sign\s*up/i.test(c.text));
if (target) {
  await page.mouse.click(target.x, target.y);
}
```
Prefer using the `click_sidebar` tool for text-based clicking when possible.

## Notes & options
- `analyze_page` returns a DOM summary quickly. Set `include_image: true` to also include a base64 screenshot. (This code does not send the image to a model by default.) To save tokens
- The script warns if `OPENAI_API_KEY` is missing; the agent will not function without it.
- Browser launches with `--no-sandbox`. If your environment blocks this, remove that arg in `launchBrowser()`.

## Troubleshooting
- No browser window? Ensure dependencies are installed and you’re not in a headless environment.
- API key errors? Double-check `.env` and that PowerShell session sees it.
- Element not found? UI text/structure may differ. Update selectors in `click_sidebar` and `fill_signup_form` or analyze the page output and adjust.
- Deprecation warnings (e.g., punycode) are safe to ignore.

## Extending
- Add new tools with `tool({ name, description, parameters, async execute() { ... } })`.
- Update the agent instructions to describe when to use them.
- Keep selectors resilient: prefer roles/labels and `locator.fill()`/`locator.click()`.
