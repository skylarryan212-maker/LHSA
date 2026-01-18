// Mock market suggestion types
export interface MarketSuggestion {
  id: string;
  title: string;
  description: string;
}

export interface MarketSuggestionEvent {
  id?: string;
  suggestionId?: string;
  createdAt?: string;
  eventId?: string | null;
  cadence?: any;
  watchlist?: any;
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}
