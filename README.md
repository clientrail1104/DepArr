# KLIA — All Live Trip.com Departures

## What was fixed

The old `index.html` contained exactly 10 objects in `DEMO_FLIGHTS`. That is why
GitHub Pages displayed only 10 startup flights whenever `/api/tripcom/kul`
did not exist.

This version removes that 10-flight source completely.

## How the live data works

`index.html` reads `./flights.json`.

The included GitHub Action:

1. Opens `https://www.trip.com/flights/status/kul/` with Chromium.
2. Activates **Departures**.
3. Clicks every visible **Show more** until the departure list stops growing.
4. Collects every visible Trip.com departure.
5. Opens the individual Trip.com flight status pages.
6. Collects these extra fields when Trip.com exposes them:
   - Check-in Counter
   - Check-in Time
   - Boarding Gate
   - Arrival Gate
   - Baggage
7. Rewrites `flights.json`.
8. Commits it back to the repository.

The frontend checks `flights.json` every 10 seconds.

## Upload to GitHub

Upload **all** of these files and folders to the same repository:

- `index.html`
- `flights.json`
- `package.json`
- `scripts/scrape-tripcom.mjs`
- `.github/workflows/refresh-tripcom.yml`

The `.github` directory is required.

## First live refresh

After uploading:

1. Open the repository on GitHub.
2. Open **Actions**.
3. Choose **Refresh All Trip.com Departures**.
4. Click **Run workflow**.
5. Wait for the run to finish.
6. Refresh the GitHub Pages site.

## Important GitHub limitation

GitHub Pages is static. It cannot execute Chromium or read Trip.com's page DOM
by itself. GitHub Actions therefore performs the direct Trip.com browser
collection and updates `flights.json`.

The workflow is scheduled every 5 minutes, which is GitHub Actions' minimum
cron interval. The page itself polls the regenerated JSON every 10 seconds.


## Operational detail capture

For every departure, the scraper opens the corresponding Trip.com flight-status
page and attempts to capture all five operational fields:

1. Check-in Counter
2. Check-in Time
3. Boarding Gate
4. Arrival Gate
5. Baggage

The extractor uses multiple fallbacks:

- visible Trip.com DOM label/value pairs
- visible text immediately following the field label
- field-specific regular-expression matching
- the previous known Trip.com value only if that flight's detail page fails to refresh

If Trip.com does not publish a particular field, the UI displays `TBA`.
No counter, time, gate or baggage value is invented.
