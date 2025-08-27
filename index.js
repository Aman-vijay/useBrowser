import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { chromium } from 'playwright';
import OpenAI from 'openai';

let browser;
let page;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple logging for important events only
function log(message, data = null) {
  console.log(`🤖 ${message}`);
  if (data) console.log('   ', data);
}

// Launch browser
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

// Screenshot utility
async function getScreenshotBase64() {
  const { page } = await launchBrowser();
  await page.setViewportSize({ width: 1280, height: 800 });
  const screenshot = await page.screenshot({
    type: 'jpeg',
    quality: 60,
    fullPage: false,
  });
  return screenshot.toString('base64');
}

// Navigate with reduced waiting
async function navigateToUrl(url) {
  const { page } = await launchBrowser();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(200); // Reduced from 2000ms
}

// Close browser
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

// Describe screenshot
async function describeImageBase64(base64, prompt = 'Describe key elements, buttons, forms, and navigation. Be concise.') {
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      }],
    });
    return resp.choices?.[0]?.message?.content?.trim() || 'No description';
  } catch (error) {
    return `Analysis failed: ${error.message}`;
  }
}

/* --------------------- Optimized Tools --------------------- */

const takeScreenshotTool = tool({
  name: 'take_screenshot',
  description: 'Take screenshot and get page analysis',
  parameters: z.object({
    url: z.string().nullable(),
  }),
  async execute({ url }) {
    try {
      if (url) await navigateToUrl(url);
      else await launchBrowser();
      
      const base64 = await getScreenshotBase64();
      const description = await describeImageBase64(base64);
      
      return { description, base64, success: true };
    } catch (error) {
      return { error: error.message, success: false };
    }
  },
});

const openURL = tool({
  name: 'open_url',
  description: 'Open URL in browser',
  parameters: z.object({
    url: z.string(),
  }),
  async execute({ url }) {
    try {
      await navigateToUrl(url);
      return { success: true, opened: url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
});

const clickOnScreen = tool({
  name: 'click_screen',
  description: 'Click coordinates (x, y)',
  parameters: z.object({
    x: z.number(),
    y: z.number(),
  }),
  async execute({ x, y }) {
    try {
      const { page } = await launchBrowser();
      await page.mouse.click(x, y);
    //   await page.waitForTimeout(500); 
      return { clicked: { x, y }, success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
});

const clickSidebar = tool({
  name: 'click_sidebar',
  description: 'Click sidebar item by text',
  parameters: z.object({
    label: z.string(),
  }),
  async execute({ label }) {
    try {
      const { page } = await launchBrowser();
      
      // Quick element finding strategies
      const selectors = [
        `text="${label}"`,
        `text=${label}`,
        `*:has-text("${label}")`,
        `a:has-text("${label}"), button:has-text("${label}")`,
        `[data-text="${label}"], [aria-label="${label}"]`
      ];
      
      for (const selector of selectors) {
        const element = page.locator(selector);
        if (await element.count() > 0) {
          await element.first().click();
        //   await page.waitForTimeout(1000); 
          log(`✅ Clicked "${label}" successfully`);
          return { clicked: label, success: true };
        }
      }
      
      log(`❌ "${label}" not found`);
      return { error: `"${label}" not found`, success: false };
      
    } catch (error) {
      return { error: error.message, success: false };
    }
  },
});

const fillSignupForm = tool({
  name: 'fill_signup_form',
  description: 'Fill and submit signup form quickly',
  parameters: z.object({
    firstName: z.string().default('Test'),
    lastName: z.string().default('User'),
    email: z.string().email().default('test@example.com'),
    password: z.string().default('StrongPass123'),
    confirmPassword: z.string().default('StrongPass123'),
  }),
  async execute({ firstName, lastName, email, password, confirmPassword }) {
    try {
      const { page } = await launchBrowser();
    //   await page.waitForTimeout(1000); 
      
      // Fast field mapping with common selectors
      const fieldMap = {
        firstName: ['input[name*="first"]', 'input#firstName', 'input[placeholder*="First"]'],
        lastName: ['input[name*="last"]', 'input#lastName', 'input[placeholder*="Last"]'],
        email: ['input[type="email"]', 'input[name="email"]', 'input#email'],
        password: ['input[type="password"]', 'input[name="password"]:first'],
        confirmPassword: ['input[name*="confirm"]', 'input[type="password"]:last']
      };
      
      const values = { firstName, lastName, email, password, confirmPassword };
      const filled = {};
      
      // Quick fill - first selector that works
      for (const [field, selectors] of Object.entries(fieldMap)) {
        for (const selector of selectors) {
          try {
            const element = page.locator(selector);
            if (await element.count() > 0) {
              await element.first().fill(values[field]);
              await page.waitForTimeout(300); // Small wait after fill
              filled[field] = values[field];
              break;
            }
          } catch {}
        }
      }
      
      // Quick submit
      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Sign Up")',
        'button:has-text("Register")',
        'input[type="submit"]'
      ];
      
      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const btn = page.locator(selector);
          if (await btn.count() > 0) {
            await btn.first().click();
            submitted = true;
            await page.waitForTimeout(2000); 
            break;
          }
        } catch {}
      }
      
      log(`📝 Form filled: ${Object.keys(filled).length} fields, Submitted: ${submitted}`);
      return { filled, submitted, success: true };
      
    } catch (error) {
      return { error: error.message, success: false };
    }
  },
});

const scroll = tool({
  name: 'scroll',
  description: 'Scroll page',
  parameters: z.object({
    x: z.number().default(0),
    y: z.number().default(300),
  }),
  async execute({ x, y }) {
    try {
      const { page } = await launchBrowser();
      await page.mouse.wheel(x, y);
      return { scrolledBy: { x, y }, success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
});

const sendKeys = tool({
  name: 'send_keys',
  description: 'Type text',
  parameters: z.object({
    text: z.string(),
  }),
  async execute({ text }) {
    try {
      const { page } = await launchBrowser();
      await page.keyboard.type(text);
      return { typed: text, success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
});

/* --------------------- Optimized Agent --------------------- */

const screenshotExplainAgent = new Agent({
    name: 'Screenshot Explain Agent',
    model: 'gpt-5-mini',
    instructions: `
      Analyze the webpage screenshot and provide a detailed description of key elements, buttons, forms, and navigation.
    `,
    tools: [
      takeScreenshotTool,
      describeImageTool
    ]
});

const websiteAutomationAgent = new Agent({
  name: 'Fast Website Automation Agent',
  model: 'gpt-5-mini',
  instructions: `
    You are a fast, efficient website automation agent. Be concise and direct.
    
    WORKFLOW:
    1. You should handOff screenshotExplainAgent first
    2. For "Sign Up": use click_sidebar with exact visible text
    3. After clicking, take screenshot to verify form appeared
    4. Use fill_signup_form when form is visible
    5. Verify final result with screenshot
    
    EFFICIENCY RULES:
    - Be direct and quick
    - Don't over-analyze
    - Use exact text from screenshots
    - Take action immediately when you see the target
    - Don't repeat failed attempts
  `,
  tools: [
    openURL,
    clickOnScreen,
    scroll,
    sendKeys,
    fillSignupForm,
    clickSidebar
  ],
  handsOff:[screenshotExplainAgent]
});

/* --------------------- Main Execution --------------------- */

async function main() {
  console.log('🚀 Starting website automation...\n');
  const startTime = Date.now();
  
  try {
    const result = await run(
      websiteAutomationAgent,
      `
      Automate this quickly:
      1. Open https://ui.chaicode.com/
      2. Click "Sign Up" in sidebar
      3. Fill form with: TestUser, Demo, testuser@example.com, TestPass123
      4. Submit form
      
      Be fast and efficient. Take screenshots only when needed to verify progress.
      `
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 AUTOMATION COMPLETED');
    console.log(`⏱️  Total time: ${duration} seconds`);
    console.log('📋 Final result:');
    console.log(result.finalOutput);
    console.log('='.repeat(50));
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n❌ Failed after ${duration} seconds:`, error.message);
  } finally {
    await closeBrowser();
    console.log('🔒 Browser closed');
  }
}

// Cleanup handlers
process.on('SIGINT', async () => {
  console.log('\n🛑 Stopping automation...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Terminating...');
  await closeBrowser();
  process.exit(0);
});

main();