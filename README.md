# Website Automation Agent

A  browser automation tool that uses Playwright's real browser control with OpenAI's Agent API and tools  to create a web automation assistant. This tool can autonomously navigate websites, analyze page structures, interact with elements, and complete complex workflows like user registration processes.

## 🎯 Overview

The Website Automation Agent is designed to bridge the gap between traditional browser automation and intelligent decision-making. By leveraging OpenAI's Agent API, it can understand web page contexts, make informed decisions about element interactions, and adapt to different website structures without requiring explicit selectors or rigid scripts.

### Key Features

- **Intelligent Page Analysis**: Automatically extracts and analyzes DOM structure, identifying clickable elements, form fields, and navigation options
- **Adaptive Element Interaction**: Uses multiple selector strategies with fallback mechanisms for robust element targeting
- **Visual Context Understanding**: Optional screenshot capture for enhanced page analysis
- **Human-like Interactions**: Implements realistic typing delays and mouse movements to mimic natural user behavior
- **Error Resilience**: Comprehensive error handling and recovery mechanisms
- **Session Management**: Proper browser lifecycle management with cleanup procedures

## 🛠 Technical Architecture

### Core Components

**Browser Management**
- Shared Playwright Chromium instance for optimal resource usage
- Configurable viewport and launch parameters
- Automatic session cleanup and error recovery

**Page Analysis Engine**
- Real-time DOM extraction with visibility filtering
- Structured data collection (headings, clickable elements, form inputs)
- Optional base64 screenshot capture for visual analysis
- Performance-optimized with element limits to prevent token overflow

**Tool Ecosystem**
- `open_url`: Navigate to any web page with timeout handling
- `analyze_page`: Extract structured page information with optional visual context
- `click_sidebar`: Intelligent text-based element clicking with multiple selector strategies
- `fill_signup_form`: Robust form filling with case-insensitive field detection
- `finalize_session`: Clean browser closure and session termination

**AI Agent Integration**
- OpenAI Agent API orchestration for decision-making
- Context-aware workflow execution
- Adaptive response to varying website structures

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** 
- **OpenAI API Key**


### Installation

```bash
# Clone the repository
git clone https://github.com/Aman-vijay/useBrowser
cd website-automation-agent

# Install dependencies (pnpm recommended)
pnpm install
# or
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-your-openai-api-key-here
```

### Running the Agent

```bash
# Using pnpm
pnpm start

# Using npm
npm start
```

The agent will launch a Chromium browser window and execute the predefined automation workflow.

## 📋 Usage Examples

### Basic Website Navigation

```javascript
const result = await run(websiteAutomationAgent, `
  Open https://example.com
  Analyze the page structure
  Click the "Get Started" button
  Fill out the contact form
  Submit and verify success
`);
```

### Custom Form Automation

```javascript
const result = await run(websiteAutomationAgent, `
  Navigate to registration page
  Fill signup form with: John, Doe, john.doe@email.com, SecurePass123, SecurePass123
  Handle any verification steps
  Complete the registration process
`);
```

### Advanced Page Analysis

```javascript
// Direct API usage for custom workflows
const { page } = await launchBrowser();
await page.goto('https://target-site.com');
const pageData = await extractPageSummary();
console.log('Discovered elements:', pageData.clickable);
```

## 🔧 Configuration Options

### Browser Settings

Modify browser launch parameters in `launchBrowser()`:

```javascript
browser = await chromium.launch({
  headless: false,           // Set to true for background operation
  args: ['--no-sandbox'],    // Remove if running in secure environment
  slowMo: 250,              // Add delays for debugging
});
```

### Agent Behavior

Customize the agent's instructions and model:

```javascript
const websiteAutomationAgent = new Agent({
  name: 'Custom Automation Agent',
  model: 'gpt-5-mini',      // Adjust model as needed
  instructions: `Your custom instructions here`,
  tools: [/* your tool selection */],
});
```

### Form Field Mapping

Extend form field detection by modifying selectors in `fillSignupForm`:

```javascript
const fields = [
  { 
    name: 'customField', 
    selectors: [
      'input[name="custom"]',
      '#customField',
      'input[data-testid="custom"]'
    ] 
  },
  
];
```

## 🔍 Troubleshooting

### Common Issues

**Browser Launch Failures**
- Ensure all dependencies are installed: `pnpm install`
- Check system permissions for browser execution
- Remove `--no-sandbox` flag if running in restricted environment

**API Connection Issues**
- Verify `OPENAI_API_KEY` is correctly set in `.env`
- Confirm API key has Agent API access permissions
- Check network connectivity and firewall settings


### Debug Mode

Enable verbose logging by modifying the `log` function:

```javascript
const log = (msg, data = null) => {
  console.log(`🤖 [${new Date().toISOString()}] ${msg}`);
  if (data) console.log('   ', JSON.stringify(data, null, 2));
};
```

## 🚀 Future Development Roadmap


**Multi-Browser Support**
- Firefox and Safari compatibility
- Browser-specific optimization profiles
- Parallel browser session management

**Improved Robustness**
- Retry mechanisms with exponential backoff
- Advanced element waiting strategies
- Automatic CAPTCHA detection and handling

**Enterprise Features**
- Session recording and playback capabilities
- Comprehensive logging and audit trails
- Integration with testing frameworks (Jest, Mocha)
- Headless CI/CD pipeline support






## 🔗 Related Technologies

- [Playwright](https://playwright.dev/) - Cross-browser automation library
- [OpenAI Agent API](https://platform.openai.com/docs/agents) - AI agent orchestration
- [Zod](https://zod.dev/) - Schema validation library

