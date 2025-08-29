import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { chromium } from 'playwright';


let browser, page;

/* ----------------- Logger ----------------- */
const log = (msg, data = null) => {
  console.log(`🤖 ${msg}`);
  if (data) console.log('   ', data);
};

/* ----------------- Browser helpers ----------------- */
async function launchBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
    page = await browser.newPage();
  }
  return { browser, page };
}
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = page = null;
  }
}

/* ----------------- DOM + Screenshot helpers ----------------- */
async function extractPageSummary() {
  const { page } = await launchBrowser();
  return await page.evaluate(() => {
    const isVisible = el => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const headings = [...document.querySelectorAll('h1,h2,h3')].map(h => h.innerText.trim()).filter(Boolean).slice(0, 10);
    const clickable = [...document.querySelectorAll('a,button,input[type=button],input[type=submit]')]
      .filter(isVisible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.innerText || el.value || el.title || '').trim().slice(0, 80),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      }).slice(0, 30);
    const inputs = [...document.querySelectorAll('input,textarea,select')].map(el => ({
      type: el.type || el.tagName.toLowerCase(),
      placeholder: el.placeholder || null,
    })).slice(0, 40);
    return { title: document.title, url: location.href, headings, clickable, inputs };
  });
}

async function getScreenshotBase64() {
  const { page } = await launchBrowser();
  await page.setViewportSize({ width: 1280, height: 900 });
  return (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');
}

/* ----------------- Tools ----------------- */

// Unified analyze_page tool (summary first, image optional)
const analyzePage = tool({
  name: 'analyze_page',
  description: 'Analyze page via DOM summary first, screenshot if needed.',
  parameters: z.object({ include_image: z.boolean().nullable() }),
  async execute({ include_image }) {
    try {
      // Always gather a fast DOM-based summary first
      const analysis = await extractPageSummary();

      const includeImage = Boolean(include_image);
      if (!includeImage) {
        return { success: true, analysis };
      }

      // Optionally include a screenshot (no LLM call to avoid API mismatches)
      const b64 = await getScreenshotBase64();
      return { success: true, analysis, base64: b64 };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
});

// Click sidebar by text
const clickSidebar = tool({
  name: 'click_sidebar',
  description: 'Click a sidebar item by visible text.',
  parameters: z.object({ label: z.string() }),
  async execute({ label }) {
    try {
      const { page } = await launchBrowser();
      const selectors = [`text=${label}`, `a:has-text("${label}")`, `button:has-text("${label}")`];
      for (const sel of selectors) {
        const loc = page.locator(sel);
        if (await loc.count() > 0) {
          await loc.first().scrollIntoViewIfNeeded();
        
          await loc.first().hover();
          await page.waitForTimeout(100 + Math.floor(Math.random() * 200)); 
          await loc.first().click();
          return { success: true, clicked: label, selector: sel };
        }
      }
      return { success: false, error: 'not_found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
});

/* ----------------- fill_signup_form (fast, tries multiple selectors) ----------------- */
let formSubmitted = false;

const fillSignupForm = tool({
  name: 'fill_signup_form',
  description: 'Fill a signup form quickly with common selectors.',
  parameters: z.object({
  firstName: z.string().default('Test'),
  lastName: z.string().default('User'),
  email: z.string().default('test@example.com'),
  password: z.string().default('StrongPass123'),
  confirmPassword: z.string().default('StrongPass123'),
}),

  async execute(vals) {
     if (formSubmitted) {
      return { success: false, error: 'Form already submitted' };
    }
    try {
      const { page } = await launchBrowser();
     const fields = [
  { name: 'firstName', selectors: [
      'input[name*="first" i]',
      '#firstName',
      'input[placeholder*="first" i]'
    ] },
  { name: 'lastName', selectors: [
      'input[name*="last" i]',
      '#lastName',
      'input[placeholder*="last" i]'
    ] },
  { name: 'email', selectors: [
      'input[type="email"]',
      'input[name="email" i]',
      '#email',
      'input[placeholder*="email" i]'
    ] },
  { name: 'password', selectors: [
      'input[name="password" i]',
      '#password',
      'input[placeholder*="password" i]',
      'input[type="password"]:not([name*="confirm" i]):not([id*="confirm" i]):not([placeholder*="confirm" i])'
    ] },
  { name: 'confirmPassword', selectors: [
      'input[name*="confirm" i]',
      '#confirmPassword',
      'input[placeholder*="confirm" i]'
    ] },
];

      const filled = {};
      for (const field of fields) {
        for (const sel of field.selectors) {
          const loc = page.locator(sel).first();
          if (await loc.count() > 0) {
        await loc.scrollIntoViewIfNeeded();
        await loc.click({ timeout: 2000 }).catch(() => {});
        await loc.clear().catch(() => {});
  
        const text = String(vals[field.name] ?? '');
        for (const char of text) {
          await loc.type(char, { delay: 50 + Math.floor(Math.random() * 100) });
        }
        filled[field.name] = vals[field.name];
        await page.waitForTimeout(300 + Math.floor(Math.random() * 200));
        break;
          }
        }
      }
      const btn = page.locator('button[type="submit"], button:has-text("Sign Up"), button:has-text("Create Account")');
      if (await btn.count()) {
        await btn.first().click();
      }
        formSubmitted = true;
      return { success: true, filled };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
});

const openURL = tool({
  name: 'open_url',
  description: 'Open a URL',
  parameters: z.object({ url: z.string() }),
  async execute({ url }) {
    try {
      const { page } = await launchBrowser();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      return { success: true, opened: url };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
});

const finalizeSession = tool({
  name: 'finalize_session',
  description: 'Call this after successful signup to close browser and end task.',
  parameters: z.object({}),
  async execute() {
    await closeBrowser();
    return { success: true, message: 'Browser closed, session ended.' };
  }
});


/* ----------------- Agent ----------------- */
const websiteAutomationAgent = new Agent({
  name: 'Fast Website Automation Agent',
  model: 'gpt-5-mini',
  instructions: `
    You are an efficient browser automation agent. Use these tools smartly:
    
  Tools:
  - open_url: Navigate to a specific URL.
  - analyze_page: Get a fast DOM summary; include a screenshot only if needed.
  - click_sidebar: Click a sidebar item by visible text.
  - fill_signup_form: Fill a signup form with provided values.
  - finalize_session: Close the browser and end the task.

    Workflow:
   1. Use open_url to navigate.
   2. Use analyze_page to understand structure and find signup options (set include_image only if necessary).
   3. Use click_sidebar with exact text.
   4. Use analyze_page again to verify the form.
   5. Use fill_signup_form to complete and submit.
   6. Use analyze_page to verify success, then finalize_session.

    Be direct and efficient - the tools handle the complexity.
  `,
  tools: [openURL, analyzePage, clickSidebar, fillSignupForm, finalizeSession],
});

/* ----------------- Main ----------------- */
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY is not set. The agent will fail to call the model.');
  }
  console.log('🚀 Starting optimized automation...');
  const start = Date.now();
  try {
    const result = await run(websiteAutomationAgent, `
      Open https://ui.chaicode.com/
      Analyze the page
      Click "Sign Up" in sidebar
      Fill signup form with: TestUser, Demo, testuser@example.com, TestPass123,TestPass123
      Submit and verify
    `);
    log('Final agent output', result.finalOutput);
    log('Duration (s):', ((Date.now() - start) / 1000).toFixed(1));
  } catch (err) {
    log('Error', err.message || err);
  } finally {
    await closeBrowser();
  }
}

// Surface unexpected errors
process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
});

main();
 


