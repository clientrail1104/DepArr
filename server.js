const express = require('express');
const { chromium } = require('playwright');
const NodeCache = require('node-cache');
const cors = require('cors');

const app = express();
const cache = new NodeCache({ stdTTL: 60 }); // Cache data for 60 seconds
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.static('public'));

const TARGET_URL = 'https://www.malaysiaairports.com.my/en/klia1/flight-information';

/**
 * Scrapes real-time flight information from KLIA Terminal 1
 * @param {'departures' | 'arrivals'} flightType
 */
async function scrapeKliaFlights(flightType = 'departures') {
  const cacheKey = `klia1_${flightType}`;
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    console.log(`[CACHE HIT] Returning cached ${flightType} data`);
    return cachedData;
  }

  console.log(`[SCRAPE] Fetching live ${flightType} from KLIA1 website...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Switch tab if 'arrivals' requested
    if (flightType === 'arrivals') {
      const arrivalTab = page.locator('text=Arrivals').first();
      if (await arrivalTab.isVisible()) {
        await arrivalTab.click();
        await page.waitForTimeout(2000); // Allow dynamic table re-render
      }
    }

    // Extract table row data
    const flights = await page.evaluate((type) => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) return null;

        // Parse standard flight table columns
        const time = cells[0]?.innerText.trim() || '--:--';
        const destinationOrigin = cells[1]?.innerText.trim() || 'N/A';
        const airlineFlight = cells[2]?.innerText.trim() || 'N/A';
        const status = cells[3]?.innerText.trim() || 'Scheduled';
        const gateBelt = cells[4]?.innerText.trim() || '-';

        return {
          time,
          location: destinationOrigin,
          flight: airlineFlight,
          status,
          gateBelt,
          type
        };
      }).filter(item => item !== null);
    }, flightType);

    await browser.close();

    // Store in cache
    cache.set(cacheKey, flights);
    return flights;

  } catch (error) {
    await browser.close();
    console.error(`Scraping Error [${flightType}]:`, error.message);
    throw new Error('Failed to fetch real-time flight data');
  }
}

// API Routes
app.get('/api/flights', async (req, res) => {
  const type = req.query.type === 'arrivals' ? 'arrivals' : 'departures';
  try {
    const data = await scrapeKliaFlights(type);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      type,
      count: data.length,
      data
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`KLIA1 Flight API running on http://localhost:${PORT}`);
});
