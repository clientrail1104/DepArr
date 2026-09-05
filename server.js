const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.static('public'));

const DEPARTURES_URL = 'https://www.malaysiaairports.com.my/en/klia1/flight-information/departures';
const ARRIVALS_URL = 'https://www.malaysiaairports.com.my/en/klia1/flight-information/arrivals';

let flightStore = {
  departures: [],
  arrivals: [],
  lastUpdated: null,
  isFetching: false
};

/**
 * Scrapes a specific KLIA1 sub-page (departures or arrivals)
 */
async function scrapeSubPage(browser, targetUrl, flightType) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  let results = [];

  // 1. Intercept JSON API calls if background fetch occurs
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('flight') || url.includes('api') || url.includes('json')) {
      try {
        const json = await response.json();
        const list = Array.isArray(json) ? json : (json.data || json.flights || []);
        if (list.length > 0) {
          results = list.map(item => ({
            time: item.time || item.scheduled_time || item.time_scheduled || '--:--',
            location: item.location || item.destination || item.origin || 'N/A',
            flight: item.flight_no || item.flight || item.code || 'N/A',
            status: item.status || item.flight_status || 'Scheduled',
            gateBelt: item.gate || item.belt || item.counter || '-',
            type: flightType
          }));
        }
      } catch (e) {
        // Non-JSON payload, ignore
      }
    }
  });

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000); // Allow dynamic cards to render

    // 2. Fallback to extracting card elements directly from the DOM
    if (results.length === 0) {
      results = await page.evaluate((type) => {
        // Collect card containers or fallback text blocks
        const blocks = Array.from(document.querySelectorAll('div, tr, article')).filter(el => {
          const text = el.innerText || '';
          // Flight code pattern (e.g. MH 0020, OD 0191, KL 0810)
          return /\b[A-Z0-9]{2}\s?\d{3,4}\b/.test(text) && text.length < 300 && text.length > 15;
        });

        const seenFlights = new Set();
        const parsed = [];

        for (const block of blocks) {
          const text = block.innerText.trim();
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

          const flightMatch = text.match(/\b([A-Z0-9]{2}\s?\d{3,4})\b/);
          const timeMatch = text.match(/\b(\d{2}:\d{2})\b/);

          if (!flightMatch) continue;

          const flightCode = flightMatch[1];
          if (seenFlights.has(flightCode)) continue; // Avoid duplicate nested card elements

          seenFlights.add(flightCode);

          let location = 'N/A';
          let status = 'Scheduled';
          let gateBelt = '-';

          for (const line of lines) {
            if (/Gate|Counter|Belt|Carousel/i.test(line)) {
              gateBelt = line;
            } else if (/Depart|Landed|Arrived|Boarding|Delayed|Cancelled|Scheduled|Flight Depart/i.test(line)) {
              status = line;
            } else if (line.length > 3 && !line.includes(flightCode) && !/\d{2}:\d{2}/.test(line) && location === 'N/A') {
              location = line;
            }
          }

          parsed.push({
            time: timeMatch ? timeMatch[1] : '--:--',
            location,
            flight: flightCode,
            status,
            gateBelt,
            type
          });
        }

        return parsed;
      }, flightType);
    }

  } catch (err) {
    console.error(`[ERROR] Scraping ${flightType}: ${err.message}`);
  } finally {
    await context.close();
  }

  return results;
}

/**
 * Main Sync Runner
 */
async function syncAllFlights() {
  if (flightStore.isFetching) return;
  flightStore.isFetching = true;

  console.log(`[${new Date().toLocaleTimeString()}] Fetching live KLIA1 data...`);

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Execute scraping in parallel
    const [departures, arrivals] = await Promise.all([
      scrapeSubPage(browser, DEPARTURES_URL, 'departures'),
      scrapeSubPage(browser, ARRIVALS_URL, 'arrivals')
    ]);

    if (departures.length > 0 || arrivals.length > 0) {
      flightStore.departures = departures;
      flightStore.arrivals = arrivals;
      flightStore.lastUpdated = new Date().toISOString();
      console.log(`[SYNC SUCCESS] Retrieved ${departures.length} Departures and ${arrivals.length} Arrivals.`);
    } else {
      console.warn(`[SYNC WARNING] No records found. Retrying in next cycle...`);
    }

  } catch (err) {
    console.error(`[SYNC ERROR] ${err.message}`);
  } finally {
    if (browser) await browser.close();
    flightStore.isFetching = false;
  }
}

// Initial Sync
syncAllFlights();

// Sync every 30 seconds in background
setInterval(syncAllFlights, 30000);

// Fast API endpoint for 5-second frontend polling
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
  console.log(`KLIA1 Live Flight API running on http://localhost:${PORT}`);
});
