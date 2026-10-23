/**
 * Pure client-safe utility — cross-references FRED indicators with Finnhub calendar
 * events to attach forecast data. No server-side imports (Redis, rate limiter, etc.).
 */

import type { FedCalendarEvent, FedData } from '@/lib/types';

// Maps FRED series keys to Finnhub event search terms for matching calendar forecasts.
const SERIES_TO_CALENDAR: Record<string, string[]> = {
  balanceSheet: ['Fed Balance Sheet', 'Federal Reserve Balance Sheet'],
  m2: ['M2 Money Supply', 'Money Supply M2'],
  fedFunds: ['Fed Interest Rate Decision', 'Federal Funds Rate'],
  unemployment: ['Unemployment Rate'],
  gdp: ['GDP', 'Gross Domestic Product'],
  cpi: ['CPI', 'Consumer Price Index'],
  pce: ['PCE Price Index', 'Core PCE Price Index'],
  treasury10Y: ['10-Year Note Auction', 'Treasury Yield'],
  yieldSpread: [],
  initialClaims: ['Initial Jobless Claims', 'Unemployment Insurance Weekly Claims'],
  industrialProduction: ['Industrial Production', 'Industrial Production and Capacity'],
  consumerSentiment: ['Michigan Consumer Sentiment', 'Consumer Sentiment'],
  retailSales: ['Retail Sales'],
  housingStarts: ['Housing Starts'],
};

/**
 * Cross-reference indicators with upcoming calendar events to attach forecast data.
 * Calendar data is already fetched separately — this just links forecasts to indicators.
 */
export function enrichIndicatorsWithForecasts(
  fedData: FedData,
  calendarEvents: FedCalendarEvent[],
): FedData {
  if (!calendarEvents || calendarEvents.length === 0) return fedData;

  const forecasts: Record<string, { forecast: string; releaseDate: string }> = {};

  for (const [indicatorKey, searchTerms] of Object.entries(SERIES_TO_CALENDAR)) {
    if (searchTerms.length === 0) continue;

    // Find the nearest future calendar event with a forecast for this indicator
    const match = calendarEvents.find((evt) => {
      if (evt.isPast) return false;
      if (!evt.forecast) return false;

      const evtNameLower = evt.releaseName.toLowerCase();
      return searchTerms.some((term) => evtNameLower.includes(term.toLowerCase()));
    });

    if (match?.forecast) {
      forecasts[indicatorKey] = {
        forecast: match.forecast,
        releaseDate: match.date,
      };
    }
  }

  if (Object.keys(forecasts).length > 0) {
    fedData._forecasts = forecasts;
  }

  return fedData;
}
