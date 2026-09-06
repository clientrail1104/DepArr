import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://www.trip.com/flights/status/kul/";
const OUTPUT_FILE = path.resolve("flights.json");

const MAX_EXPAND_ROUNDS = 120;
const DETAIL_CONCURRENCY = 6;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function clean(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/svg$/i, "")
    .trim();
}

function dedupeExactHalf(value = "") {
  const text = clean(value);

  if (text.length % 2 === 0) {
    const half = text.length / 2;

    if (text.slice(0, half) === text.slice(half)) {
      return text.slice(0, half);
    }
  }

  return text;
}

function normalizeTerminal(value = "") {
  const text = clean(value).toUpperCase();

  if (text === "1" || text === "TERMINAL 1") return "T1";
  if (text === "2" || text === "TERMINAL 2") return "T2";

  return text || "--";
}

function normalizeCheckInTime(value = "") {
  const text = clean(value);

  if (!text) return "TBA";

  const range = text.match(
    /(\d{1,2}:\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2})/i
  );

  if (range) {
    return `${range[1]} - ${range[2]}`;
  }

  const closes = text.match(
    /(?:check-?in\s+)?closes?(?:\s+at)?\s*(\d{1,2}:\d{2})/i
  );

  if (closes) {
    return `Closes ${closes[1]}`;
  }

  return text.length > 100 ? text.slice(0, 100) : text;
}

function valueAfterLabel(lines, labels) {
  const normalizedLabels = labels.map(label => label.toLowerCase());

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();

    if (!normalizedLabels.includes(lower)) continue;

    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const candidate = clean(lines[j]);

      if (!candidate) continue;
      if (normalizedLabels.includes(candidate.toLowerCase())) continue;

      return candidate;
    }
  }

  return "";
}

async function existingMap() {
  try {
    const raw = JSON.parse(await fs.readFile(OUTPUT_FILE, "utf8"));
    const rows = Array.isArray(raw) ? raw : raw.flights;

    return new Map(
      (Array.isArray(rows) ? rows : []).map(row => [
        `${clean(row.flight).toUpperCase()}|${clean(row.destination).toUpperCase()}`,
        row
      ])
    );
  } catch {
    return new Map();
  }
}

async function activateDepartures(page) {
  const roleCandidates = [
    page.getByRole("tab", { name: /^Departures$/i }),
    page.getByRole("button", { name: /^Departures$/i }),
    page.getByText("Departures", { exact: true })
  ];

  for (const candidate of roleCandidates) {
    const count = await candidate.count();

    for (let i = 0; i < count; i++) {
      const target = candidate.nth(i);

      try {
        if (!await target.isVisible()) continue;

        await target.click({ timeout: 5000 });
        await page.waitForTimeout(1800);
        return;
      } catch {
        // Try another visible candidate.
      }
    }
  }

  throw new Error("Could not activate Trip.com Departures tab.");
}

async function visibleFlightLinkCount(page) {
  return await page.locator('a[href*="/flights/status-"]').evaluateAll(
    nodes => nodes.filter(node => {
      const style = getComputedStyle(node);

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        node.getClientRects().length > 0
      );
    }).length
  );
}

async function expandEveryDeparture(page) {
  let previousCount = -1;
  let unchangedRounds = 0;

  for (let round = 0; round < MAX_EXPAND_ROUNDS; round++) {
    const currentCount = await visibleFlightLinkCount(page);

    if (currentCount === previousCount) {
      unchangedRounds += 1;
    } else {
      unchangedRounds = 0;
    }

    previousCount = currentCount;

    const showMore = page.getByText("Show more", { exact: true });
    const count = await showMore.count();

    let clicked = false;

    for (let i = 0; i < count; i++) {
      const candidate = showMore.nth(i);

      try {
        if (!await candidate.isVisible()) continue;

        await candidate.scrollIntoViewIfNeeded();
        await candidate.click({ timeout: 5000 });
        await page.waitForTimeout(900);
        clicked = true;
        break;
      } catch {
        // Try next visible Show more.
      }
    }

    if (!clicked || unchangedRounds >= 3) {
      break;
    }
  }
}

async function scrapeVisibleDepartureBoard(page) {
  return await page.evaluate(() => {
    const clean = value =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .replace(/svg$/i, "")
        .trim();

    const isVisible = node => {
      const style = getComputedStyle(node);

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        node.getClientRects().length > 0
      );
    };

    const grouped = new Map();

    for (const anchor of document.querySelectorAll(
      'a[href*="/flights/status-"]'
    )) {
      if (!isVisible(anchor)) continue;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref) continue;

      const href = new URL(rawHref, location.href).href;
      const value = clean(anchor.innerText || anchor.textContent);

      if (!value) continue;

      if (!grouped.has(href)) grouped.set(href, []);
      grouped.get(href).push(value);
    }

    const timePattern = /^\d{1,2}:\d{2}$/;
    const flightPattern = /^[A-Z0-9]{2,3}\s?\d{1,4}[A-Z]?$/i;
    const results = [];

    for (const [href, rawValues] of grouped.entries()) {
      const values = [];

      for (const item of rawValues) {
        const value = clean(item);

        if (!value) continue;

        // The same value is often repeated by nested clickable elements.
        if (values.at(-1) !== value) values.push(value);
      }

      const timeIndex = values.findIndex(value => timePattern.test(value));
      if (timeIndex < 0) continue;

      const flightIndex = values.findIndex(
        (value, index) =>
          index > timeIndex &&
          flightPattern.test(value)
      );

      if (flightIndex < 0) continue;

      const time = values[timeIndex];
      const flight = values[flightIndex];

      const destination = values[flightIndex + 1];
      const airline = values[flightIndex + 2];
      const terminal = values[flightIndex + 3];
      const status = values[flightIndex + 4];

      if (
        !destination ||
        !airline ||
        !terminal ||
        !status
      ) {
        continue;
      }

      results.push({
        time,
        flight,
        destination,
        airline,
        terminal,
        status,
        detailUrl: href
      });
    }

    const seen = new Set();

    return results.filter(row => {
      const key =
        `${row.flight.toUpperCase()}|` +
        `${row.destination.toUpperCase()}`;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
  });
}

async function scrapeFlightDetails(context, row, cached) {
  const page = await context.newPage();

  try {
    await page.goto(row.detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(900);

    // Expand optional detail areas if Trip.com exposes them.
    const showMore = page.getByText("Show more", { exact: true });
    const count = await showMore.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const candidate = showMore.nth(i);

      try {
        if (await candidate.isVisible()) {
          await candidate.click({ timeout: 2500 });
          await page.waitForTimeout(250);
        }
      } catch {
        // Optional.
      }
    }

    const bodyText = await page.locator("body").innerText();
    const lines = bodyText
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);

    const checkInCounter =
      valueAfterLabel(lines, [
        "Check-in Counter",
        "Check-in counter"
      ]) || cached?.checkInCounter || "TBA";

    const checkInTimeRaw =
      valueAfterLabel(lines, [
        "Check-in Time",
        "Check-in time"
      ]);

    const checkInTime =
      checkInTimeRaw
        ? normalizeCheckInTime(checkInTimeRaw)
        : cached?.checkInTime || "TBA";

    const boardingGate =
      valueAfterLabel(lines, [
        "Boarding Gate",
        "Boarding gate",
        "Gate"
      ]) || cached?.boardingGate || "TBA";

    const arrivalGate =
      valueAfterLabel(lines, [
        "Arrival Gate",
        "Arrival gate"
      ]) || cached?.arrivalGate || "TBA";

    const baggage =
      valueAfterLabel(lines, [
        "Baggage",
        "Baggage Belt",
        "Baggage belt",
        "Carousel"
      ]) || cached?.baggage || "TBA";

    return {
      checkInCounter,
      checkInTime,
      boardingGate,
      arrivalGate,
      baggage
    };

  } catch (error) {
    console.warn(
      `Trip.com detail failed for ${row.flight}: ${error.message}`
    );

    return {
      checkInCounter: cached?.checkInCounter || "TBA",
      checkInTime: cached?.checkInTime || "TBA",
      boardingGate: cached?.boardingGate || "TBA",
      arrivalGate: cached?.arrivalGate || "TBA",
      baggage: cached?.baggage || "TBA"
    };

  } finally {
    await page.close().catch(() => {});
  }
}

async function mapConcurrent(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;

      if (index >= items.length) return;

      output[index] = await mapper(items[index], index);
      await sleep(100);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => worker()
    )
  );

  return output;
}

const previous = await existingMap();

const browser = await chromium.launch({
  headless: true
});

const context = await browser.newContext({
  locale: "en-MY",
  timezoneId: "Asia/Kuala_Lumpur",
  viewport: {
    width: 1440,
    height: 1200
  },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/128.0.0.0 Safari/537.36"
});

const page = await context.newPage();

try {
  await page.goto(SOURCE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(2200);

  await activateDepartures(page);
  await expandEveryDeparture(page);

  let rows = await scrapeVisibleDepartureBoard(page);

  rows = rows.map(row => ({
    ...row,
    airline: dedupeExactHalf(row.airline),
    terminal: normalizeTerminal(row.terminal),
    status: clean(row.status)
  }));

  if (rows.length < 20) {
    throw new Error(
      `Only ${rows.length} departure rows detected. ` +
      "Refusing to overwrite a complete dataset with a partial Trip.com page."
    );
  }

  console.log(`Complete visible Trip.com departures detected: ${rows.length}`);

  const flights = await mapConcurrent(
    rows,
    DETAIL_CONCURRENCY,
    async row => {
      const key =
        `${clean(row.flight).toUpperCase()}|` +
        `${clean(row.destination).toUpperCase()}`;

      const cached = previous.get(key);
      const details = await scrapeFlightDetails(
        context,
        row,
        cached
      );

      return {
        time: clean(row.time),
        checkInTime: details.checkInTime,
        flight: clean(row.flight),
        destination: clean(row.destination),
        airline: dedupeExactHalf(row.airline),
        terminal: normalizeTerminal(row.terminal),
        checkInCounter: details.checkInCounter,
        boardingGate: details.boardingGate,
        arrivalGate: details.arrivalGate,
        baggage: details.baggage,
        status: clean(row.status),
        estimatedTime: "",
        detailUrl: row.detailUrl
      };
    }
  );

  const payload = {
    updatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    mode: "live-tripcom-playwright",
    count: flights.length,
    flights
  };

  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `flights.json updated with ${flights.length} Trip.com departures.`
  );

} finally {
  await page.close().catch(() => {});
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
