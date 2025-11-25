export interface XRPLTrustline {
  account: string;
  balance: string;
  currency: string;
  limit: string;
  limit_peer: string;
  no_ripple: boolean;
  no_ripple_peer: boolean;
  quality_in: number;
  quality_out: number;
}

export interface Holder {
  rank: number;
  account: string;
  balance: number;
  percentage: number;
  tier: string;
  tierIcon: string;
  tierColor: string;
  walletLabel?: string;
  walletType?: 'cex' | 'team';
}

export interface FetchStatus {
  isFetching: boolean;
  linesFetched: number;
  statusMessage: string;
  error?: string;
  complete: boolean;
}

export interface AnalysisResult {
  markdown: string;
  isLoading: boolean;
}

export interface TokenMetrics {
  priceUsd: number;
  priceXrp: number;
  marketCap: number;
  totalCap: number; // Fully Diluted Valuation
  circulatingSupply: number;
  totalSupply: number;
  volume24h: number;
  volToMcap: number;
  ath: number;
  atl: number;
  change1h?: number;
  change24h?: number;
  change7d?: number;
  change30d?: number;
  lastUpdated: Date;
}

// XRPL RPC Response Types
export interface XRPLAccountLinesResponse {
  result: {
    account: string;
    lines: XRPLTrustline[];
    marker?: unknown; // marker can be string or object depending on node version
    status: string;
  };
}