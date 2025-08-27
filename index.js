import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { chromium } from 'playwright';
import OpenAI from 'openai';

let browser;
let page;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple logger
function log(msg, data = null) {
  console.log(`🤖 ${msg}`);
  if (data) console.log('   ', data);
}

/* ----------------- Browser helpers ----------------- */

async function launchBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: false,
      chromiumSandbox: true,
      args: ['--disable-extensions', '--disable-file-system', '--no-sandbox'],
    });
    page = await browser.newPage();
  }
  return { browser, page };
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

/* ----------------- Fast DOM summary (small, local) -----------------
   This returns a tiny JSON describing visible text, buttons/links, inputs,
   and bounding boxes for clickable elements. Very fast because it runs
   inside the browser using page.evaluate (no model call).
---------------------------------------------------------------------*/
async function extractPageSummary() {
  const { page } = await launchBrowser();
  // run in page context and only return a compact summary
  const summary = await page.evaluate(() => {
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }

    // collect headings
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, 10)
      .map((h) => h.innerText.trim())
      .filter(Boolean);

    // collect buttons/links with text and rects (limit)
    const clickable = [];
    const candidates = Array.from(document.querySelectorAll('a,button,input[type=button],input[type=submit]'));
    for (const el of candidates) {
      try {
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
        if (!text) continue;
        if (!isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        clickable.push({
          text: text.slice(0, 80),
          tag: el.tagName.toLowerCase(),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
        if (clickable.length >= 30) break;
      } catch (e) {
        // ignore
      }
    }

    // inputs + placeholders
    const inputs = Array.from(document.querySelectorAll('input,textarea,select'))
      .slice(0, 40)
      .map((el) => ({
        type: el.tagName.toLowerCase() === 'input' ? (el.getAttribute('type') || 'text') : el.tagName.toLowerCase(),
        name: el.getAttribute('name') || el.getAttribute('id') || null,
        placeholder: el.getAttribute('placeholder') || null,
        label: (() => {
          const id = el.getAttribute('id');
          if (!id) return null;
          const label = document.querySelector(`label[for="${id}"]`);
          return label ? label.innerText.trim() : null;
        })(),
      }))
      .filter(Boolean);

    const title = document.title || null;
    const url = window.location.href;
    return { title, url, headings, clickable, inputs };
  });

  return summary;
}

/* ----------------- Screenshot helper (optional, compressed) ----------------- */
async function getScreenshotBase64() {
  const { page } = await launchBrowser();
  await page.setViewportSize({ width: 1000, height: 700 });
  // use jpeg + quality to keep payload small
  const buffer = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false });
  return buffer.toString('base64');
}

/* ----------------- Small text-based analysis (fast) -----------------
   We send the tiny DOM summary (JSON) to the model, instead of a huge image.
   This is fast and should drastically reduce latency compared to images.
---------------------------------------------------------------------*/
async function analyzeSummaryText(summary, prompt = 'Given the page summary JSON, describe key interactive items and where to click if we want the Signup form.') {
  const content = `Page summary JSON:\n${JSON.stringify(summary)}\n\nInstruction: Briefly list
- the most likely control to open a signup form (by its text),
- candidate selectors/types if present,
- and whether more visual analysis (image) is required (reply with "needs_image": true/false).
Respond in JSON only: { "action_suggestion": "...", "candidates": [ ... ], "needs_image": true|false }`;

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content }],
    max_tokens: 140,
    temperature: 0.0,
  });

  const txt = resp.choices?.[0]?.message?.content?.trim() || '';
  // try to parse JSON from the model (defensive)
  try {
    const jsonStart = txt.indexOf('{');
    if (jsonStart >= 0) {
      const jsonText = txt.slice(jsonStart);
      return JSON.parse(jsonText);
    }
  } catch (e) {
    // fallback: return plain text
  }
  // fallback non-JSON
  return { action_suggestion: txt, candidates: [], needs_image: true };
}

/* ----------------- Optional image-based description (slower) ----------------- */
async function describeImageBase64(base64, prompt = 'Describe the screenshot concisely: key elements, buttons, form visibility') {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: prompt },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }] },
    ],
    max_tokens: 180,
  });
  return resp.choices?.[0]?.message?.content?.trim() || '';
}

/* ----------------- Simple in-memory cache for summaries ----------------- */
const summaryCache = new Map(); // key: url|scroll -> { summary, ts }

/* ----------------- Tool: take_screenshot (optimized) -----------------
   New parameters:
     - url: navigate if provided (nullable)
     - include_image: nullable boolean. If null -> default false (do text-first)
---------------------------------------------------------------------*/
const takeScreenshotTool = tool({
  name: 'take_screenshot',
  description: 'Take a screenshot and/or analyze quickly using DOM summary. include_image true to force full image analysis.',
  parameters: z.object({
    url: z.string().nullable(),
    include_image: z.boolean().nullable(),
  }),
  async execute({ url, include_image }) {
    try {
      if (url) {
        const { page } = await launchBrowser();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }

      // small cache key
      const key = `${(await page.url())}::scroll:${await page.evaluate(() => window.scrollY)}`;

      // fast DOM summary
      let pageSummary;
      if (summaryCache.has(key) && (Date.now() - summaryCache.get(key).ts) < 8_000) {
        pageSummary = summaryCache.get(key).summary;
      } else {
        pageSummary = await extractPageSummary();
        summaryCache.set(key, { summary: pageSummary, ts: Date.now() });
      }

      // Ask model to analyze the small JSON summary first (fast)
      const textAnalysis = await analyzeSummaryText(pageSummary);

      // If include_image true or model explicitly requests an image, do image analysis
      let imageDescription = null;
      const shouldIncludeImage = include_image === true || textAnalysis.needs_image === true;
      if (shouldIncludeImage) {
        const b64 = await getScreenshotBase64();
        imageDescription = await describeImageBase64(b64);
        return { success: true, summary: pageSummary, textAnalysis, imageDescription, base64: b64 };
      } else {
        return { success: true, summary: pageSummary, textAnalysis, imageDescription: null };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

/* ----------------- click_sidebar tool: prefers locator but falls back to click coords ----------------- */
const clickSidebar = tool({
  name: 'click_sidebar',
  description: 'Click a sidebar item by visible text. Will try locator-based click first for speed.',
  parameters: z.object({
    label: z.string(),
  }),
  async execute({ label }) {
    try {
      const { page } = await launchBrowser();

      // Try fast locator clicks first
      const selectors = [
        `text="${label}"`,
        `text=${label}`,
        `a:has-text("${label}")`,
        `button:has-text("${label}")`,
        `[aria-label="${label}"]`,
        `[data-testid="${label}"]`,
      ];

      for (const sel of selectors) {
        const loc = page.locator(sel);
        if (await loc.count() > 0) {
          await loc.first().click();
          await page.waitForTimeout(700);
          return { clicked: label, method: 'locator', selector: sel, success: true };
        }
      }

      // fallback: look up candidate clickable items from extraction and click by coordinates
      const summary = await extractPageSummary();
      const candidate = summary.clickable.find(c => c.text.toLowerCase().includes(label.toLowerCase()));
      if (candidate) {
        await page.mouse.click(candidate.x, candidate.y);
        await page.waitForTimeout(700);
        return { clicked: label, method: 'coords', coords: { x: candidate.x, y: candidate.y }, success: true };
      }

      return { success: false, error: 'not_found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

/* ----------------- fill_signup_form (fast, tries multiple selectors) ----------------- */
const fillSignupForm = tool({
  name: 'fill_signup_form',
  description: 'Fill a signup form using common field selectors; try to be brief and fast.',
  parameters: z.object({
    firstName: z.string().default('Test'),
    lastName: z.string().default('User'),
    email: z.string().default('test@example.com'),
    password: z.string().default('StrongPass123'),
  }),
  async execute({ firstName, lastName, email, password }) {
    try {
      const { page } = await launchBrowser();

      // quick attempt to find and fill fields using common selectors (no model)
      const fields = [
        { name: 'firstName', selectors: ['input[name*="first"]', 'input#firstName', 'input[placeholder*="First"]'] },
        { name: 'lastName', selectors: ['input[name*="last"]', 'input#lastName', 'input[placeholder*="Last"]'] },
        { name: 'email', selectors: ['input[type="email"]', 'input[name="email"]', 'input#email'] },
        { name: 'password', selectors: ['input[type="password"]', 'input[name="password"]', 'input#password'] },
      ];

      const values = { firstName, lastName, email, password };
      const filled = {};

      for (const field of fields) {
        for (const sel of field.selectors) {
          try {
            const loc = page.locator(sel);
            if (await loc.count() > 0) {
              await loc.first().fill(values[field.name]);
              filled[field.name] = values[field.name];
              break;
            }
          } catch (e) {
            // ignore this selector and try next
          }
        }
      }

      // quick submit attempts
      const submitCandidates = ['button[type="submit"]', 'button:has-text("Sign Up")', 'button:has-text("Register")', 'input[type="submit"]'];
      let submitted = false;
      for (const sel of submitCandidates) {
        try {
          const btn = page.locator(sel);
          if (await btn.count() > 0) {
            await btn.first().click();
            submitted = true;
            await page.waitForTimeout(1200);
            break;
          }
        } catch {}
      }

      return { success: true, filled, submitted };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

/* ----------------- Other small tools (unchanged, fast) ----------------- */
const scroll = tool({
  name: 'scroll',
  description: 'Scroll page by x,y',
  parameters: z.object({ x: z.number().default(0), y: z.number().default(300) }),
  async execute({ x, y }) {
    try {
      const { page } = await launchBrowser();
      await page.mouse.wheel(x, y);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

const openURL = tool({
  name: 'open_url',
  description: 'Open a URL',
  parameters: z.object({ url: z.string() }),
  async execute({ url }) {
    try {
      await (await launchBrowser()).page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(400);
      return { success: true, opened: url };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

/* ----------------- Agent ----------------- */
const websiteAutomationAgent = new Agent({
  name: 'Fast Website Automation Agent',
  model: 'gpt-4o-mini',
  instructions: `
    You are a fast website automation agent. Prefer deterministic (DOM) actions
    first. Use take_screenshot with include_image=true only when strictly needed.
    Use click_sidebar and fill_signup_form for the signup flow.
  `,
  tools: [openURL, takeScreenshotTool, clickSidebar, fillSignupForm, scroll],
});

/* ----------------- Main ----------------- */
async function main() {
  console.log('🚀 Starting optimized automation...');
  const start = Date.now();
  try {
    const result = await run(websiteAutomationAgent, `
      Open https://ui.chaicode.com/
      Click "Sign Up" in sidebar
      Fill signup form with: TestUser, Demo, testuser@example.com, TestPass123
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

main();
