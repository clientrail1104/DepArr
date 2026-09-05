const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.static('public'));

const TARGET_URL = 'https://www.malaysiaairports.com.my/en/klia1/flight-information';

// In-memory data store
let flightStore = {
  departures: [],
  arrivals: [],
  lastUpdated: null,
  isFetching: false,
  errorCount: 0
};

/**
 * Scrapes KLIA1 departures and arrivals cleanly
 */
async function scrapeKLIA1() {
  if (flightStore.isFetching) return;
  flightStore.isFetching = true;

  console.log(`[${new Date().toLocaleTimeString()}] Fetching live flight data from KLIA1...`);
  
  let browser = null;
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    // Allow dynamic UI components to stabilize
    await page.waitForTimeout(3000);

    // Helper parser executed inside browser context
    const extractTableRows = async (type) => {
      return await page.evaluate((flightType) => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        return rows.map(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 4) return null;

          const textOf = (idx) => (cells[idx] ? cells[idx].innerText.trim() : '');

          return {
            time: textOf(0) || '--:--',
            location: textOf(1) || 'N/A',
            flight: textOf(2) || 'N/A',
            status: textOf(3) || 'Scheduled',
            gateBelt: textOf(4) || '-',
            type: flightType
          };
        }).filter(item => item !== null && item.flight !== 'N/A');
      }, type);
    };

    // 1. Parse Departures
    const departures = await extractTableRows('departures');

    // 2. Switch to Arrivals Tab & Parse
    let arrivals = [];
    const arrivalTab = page.locator('text=Arrivals').first();
    if (await arrivalTab.isVisible()) {
      await arrivalTab.click();
      await page.waitForTimeout(2000);
      arrivals = await extractTableRows('arrivals');
    }

    // Update global store
    flightStore.departures = departures;
    flightStore.arrivals = arrivals;
    flightStore.lastUpdated = new Date().toISOString();
    flightStore.errorCount = 0;

    console.log(`[SUCCESS] Synced ${departures.length} Departures & ${arrivals.length} Arrivals`);

  } catch (err) {
    flightStore.errorCount++;
    console.error(`[SCRAPE ERROR] (${flightStore.errorCount}): ${err.message}`);
  } finally {
    if (browser) await browser.close();
    flightStore.isFetching = false;
  }
}

// Initial fetch on server start
scrapeKLIA1();

// Run background scrape every 30 seconds
setInterval(scrapeKLIA1, 30000);

// Fast REST Endpoint (<10ms latency for 5s frontend polling)
app.get('/api/live-flights', (req, res) => {
  res.json({
    success: true,
    lastUpdated: flightStore.lastUpdated,
    data: {
      departures: flightStore.departures,
      arrivals: flightStore.arrivals
    }
  });
});

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`  KLIA1 Live Flight Server running on port ${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`===================================================`);
});
