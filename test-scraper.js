const { chromium } = require('playwright');

(async () => {
  console.log('Testing KLIA1 Scraper Direct Fetch...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.malaysiaairports.com.my/en/klia1/flight-information/departures', { 
    waitUntil: 'domcontentloaded' 
  });
  await page.waitForTimeout(3000);

  const text = await page.innerText('body');
  const flightMatches = text.match(/\b([A-Z0-9]{2}\s?\d{3,4})\b/g) || [];

  console.log(`\nFound ${flightMatches.length} raw flight references on page.`);
  console.log('Sample Flight Numbers:', flightMatches.slice(0, 10));

  await browser.close();
})();
