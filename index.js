import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { fi } from 'zod/v4/locales';

let browser, page;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
// async function extractPageSummary() {
//   const { page } = await launchBrowser();
//   return await page.evaluate(() => {
//     const isVisible = el => {
//       const r = el.getBoundingClientRect();
//       return r.width > 1 && r.height > 1;
//     };
//     const headings = [...document.querySelectorAll('h1,h2,h3')].map(h => h.innerText.trim()).filter(Boolean).slice(0, 10);
//     const clickable = [...document.querySelectorAll('a,button,input[type=button],input[type=submit]')]
//       .filter(isVisible)
//       .map(el => {
//         const rect = el.getBoundingClientRect();
//         return {
//           text: (el.innerText || el.value || el.title || '').trim().slice(0, 80),
//           x: Math.round(rect.left + rect.width / 2),
//           y: Math.round(rect.top + rect.height / 2),
//         };
//       }).slice(0, 30);
//     const inputs = [...document.querySelectorAll('input,textarea,select')].map(el => ({
//       type: el.type || el.tagName.toLowerCase(),
//       placeholder: el.placeholder || null,
//     })).slice(0, 40);
//     return { title: document.title, url: location.href, headings, clickable, inputs };
//   });
// }

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
      let imageDescription = null;
      if (analysis.needs_image) {
        const b64 = await getScreenshotBase64();
        const imgResp = await openai.chat.completions.create({
          model: 'gpt-5-mini',
          messages: [
            { role: 'user', content: 'Describe the screenshot: signup visibility, buttons, key elements.' },
            { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] },
          ],
        });
        imageDescription = imgResp.choices[0].message.content.trim();
        return { success: true, analysis, imageDescription, base64: b64 };
      }

      return { success: true, analysis };
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
}),

  async execute(vals) {
     if (formSubmitted) {
      return { success: false, error: 'Form already submitted' };
    }
    try {
      const { page } = await launchBrowser();
     const fields = [
  { name: 'firstName', selectors: ['input[name*="first"]', 'input#firstName', 'input[placeholder*="First"]'] },
  { name: 'lastName', selectors: ['input[name*="last"]', 'input#lastName', 'input[placeholder*="Last"]'] },
  { name: 'email', selectors: ['input[type="email"]', 'input[name="email"]', 'input#email'] },
  { name: 'password', selectors: ['input[type="password"]', 'input[name="password"]', 'input#password'] },
];

      const filled = {};
      for (const field of fields) {
        for (const sel of field.selectors) {
          const loc = page.locator(sel);
          if (await loc.count() > 0) {
            await loc.first().click();
            await page.waitForTimeout(100);
             await page.type(sel, vals[field.name], { delay: 100 }); 
             filled[field.name] = vals[field.name];
                         await page.waitForTimeout(500 + Math.floor(Math.random() * 300)); 
            break;

          }
        }
      }
      const btn = page.locator('button[type="submit"], button:has-text("Sign Up")');
      if (await btn.count()) await btn.first().click();
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
    
   1.analyzePage - Opens the browser and then url , then it takes a screenshot
   2.clickSidebar - Clicks a sidebar item by visible text
   3.fillSignupForm - Fills a signup form with provided values
   4.finalizeSession - Closes the browser and ends the task

    Workflow:
    1. Analyze page to understand structure and find signup options
    2. Click signup using smart_click with exact text from analysis
    3. Analyze again to verify form appeared  
    4. Use smart_fill to complete and submit form
    5. Analyze final result
    6. Call finalizeSession to end the automation

    Be direct and efficient - the tools handle the complexity.
  `,
  tools: [openURL, analyzePage, clickSidebar, fillSignupForm, finalizeSession],
});

/* ----------------- Main ----------------- */
async function main() {
  console.log('🚀 Starting optimized automation...');
  const start = Date.now();
  try {
    const result = await run(websiteAutomationAgent, `
      Open https://ui.chaicode.com/
      Analyze the page
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
 