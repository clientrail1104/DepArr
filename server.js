const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for all ports and origins
app.use(cors({ origin: '*' }));
app.use(express.static('public'));

const DEPARTURES_URL = 'https://www.malaysiaairports.com.my/en/klia1/flight-information/departures';
const ARRIVALS_URL = 'https://www.malaysiaairports.com.my/en/klia1/flight-information/arrivals';

let flightStore = {
  departures: [],
  arrivals: [],
  lastUpdated: new Date().toISOString(),
  isFetching: false
};

async function scrapePage(page, url, type) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    return await page.evaluate((flightType) => {
      const items = [];
      const textBlocks = document.querySelectorAll('tr, div, article');

      textBlocks.forEach(el => {
        const text = el.innerText || '';
        const flightMatch = text.match(/\b([A-Z0-9]{2}\s?\d{3,4})\b/);
        const timeMatch = text.match(/\b(\d{2}:\d{2})\b/);

        if (flightMatch && text.length < 250) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          items.push({
            time: timeMatch ? timeMatch[1] : '--:--',
            location: lines[1] || 'N/A',
            flight: flightMatch[1],
            status: lines.find(l => /departed|landed|arrived|boarding|delayed|scheduled/i.test(l)) || 'Scheduled',
            gateBelt: lines.find(l => /gate|belt|counter/i.test(l)) || '-',
            type: flightType
          });
        }
      });
      return items;
    }, type);
  } catch (err) {
    console.warn(`[SCRAPE WARNING] ${type}: ${err.message}`);
    return [];
  }
}

async function syncAll() {
  if (flightStore.isFetching) return;
  flightStore.isFetching = true;

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const deps = await scrapePage(page, DEPARTURES_URL, 'departures');
    const arrs = await scrapePage(page, ARRIVALS_URL, 'arrivals');

    if (deps.length > 0) flightStore.departures = deps;
    if (arrs.length > 0) flightStore.arrivals = arrs;
    flightStore.lastUpdated = new Date().toISOString();

  } catch (err) {
    console.error(`[SYNC ERROR] ${err.message}`);
  } finally {
    if (browser) await browser.close();
    flightStore.isFetching = false;
  }
}

// Run initial sync & trigger cycle every 30s
syncAll();
setInterval(syncAll, 30000);

// Endpoint guaranteed to return HTTP 200
app.get('/api/live-flights', (req, res) => {
  res.status(200).json({
    success: true,
    lastUpdated: flightStore.lastUpdated,
    data: {
      departures: flightStore.departures,
      arrivals: flightStore.arrivals
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(` Server running! Open: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
