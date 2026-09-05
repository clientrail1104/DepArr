const express = require('express');
const { chromium } = require('playwright');
const NodeCache = require('node-cache');
const cors = require('cors');

const app = express();
const cache = new NodeCache({ stdTTL: 10 }); // 10s cache to handle tight 5s polling safely
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.static('public'));

const TARGET_URL = 'https://www.malaysiaairports.com.my/en/klia1/flight-information';

async function fetchBothFlightTypes() {
  const cachedData = cache.get('klia1_combined');
  if (cachedData) return cachedData;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Scrape Departures
    const departures = await parseTableData(page, 'departures');

    // Switch to Arrivals Tab
    const arrivalTab = page.locator('text=Arrivals').first();
    if (await arrivalTab.isVisible()) {
      await arrivalTab.click();
      await page.waitForTimeout(1500);
    }

    // Scrape Arrivals
    const arrivals = await parseTableData(page, 'arrivals');

    await browser.close();

    const payload = { departures, arrivals };
    cache.set('klia1_combined', payload);
    return payload;
  } catch (error) {
    await browser.close();
    throw new Error(`Scraping Failed: ${error.message}`);
  }
}

async function parseTableData(page, type) {
  return await page.evaluate((flightType) => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return null;

      return {
        time: cells[0]?.innerText.trim() || '--:--',
        location: cells[1]?.innerText.trim() || 'N/A',
        flight: cells[2]?.innerText.trim() || 'N/A',
        status: cells[3]?.innerText.trim() || 'Scheduled',
        gateBelt: cells[4]?.innerText.trim() || '-',
        type: flightType
      };
    }).filter(Boolean);
  }, type);
}

// Combined Endpoint
app.get('/api/live-flights', async (req, res) => {
  try {
    const data = await fetchBothFlightTypes();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Combined Flight API running on http://localhost:${PORT}`));
