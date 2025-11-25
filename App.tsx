import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fetchTrustlinesBatch, fetchTokenMetrics } from './services/xrplService';
import { Holder, FetchStatus, TokenMetrics } from './types';
import { RichListTable } from './components/RichListTable';
import { PriceCalculator } from './components/PriceCalculator';
import { TokenStatistics } from './components/TokenStatistics';
import { Sidebar } from './components/Sidebar';
import { MarketChart } from './components/MarketChart';
import { LuckyGames } from './components/LuckyGames';
import { DonationBox } from './components/DonationBox';
import { LuckyHashPromo } from './components/LuckyHashPromo';
import { 
  Loader2, 
  StopCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
  Database,
  Dices,
  Activity,
  Zap,
  Moon,
  Sun,
  RefreshCw
} from 'lucide-react';

// Known Wallet Dictionary
const KNOWN_WALLETS: Record<string, { label: string; type: 'cex' | 'team' }> = {
  // Official Team / Issuer
  'rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr': { label: 'Issuer / Foundation', type: 'team' },
  
  // Exchanges
  'raLPjTYeGEzf4yt4lqZz5AmfTDMhfq6F7q': { label: 'Bitrue', type: 'cex' },
  'rLNaPoKeeBJZe2nz6oXAG9Jy9it8r912Fk': { label: 'Bitrue Hot', type: 'cex' },
  'rMdG3ju8pgyVh29ELPWaDuA74CpWW6Fxns': { label: 'Uphold', type: 'cex' },
  'rhub8VRN55sF4G7xQ1G1dfyE863FdrVk93': { label: 'GateHub', type: 'cex' },
  'rPVMhWBsfF9iMXYj3aAzJVkPDTFNSyWdKy': { label: 'Bittrex', type: 'cex' },
  'rNfwFmsgM97YW43d7s1832J8f4i7eG8xG3': { label: 'Xumm / XRPL Labs', type: 'cex' }, 
};

const App: React.FC = () => {
  // Theme State - Default to Light Mode (false)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Data State
  const [holders, setHolders] = useState<Holder[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>({
    isFetching: false,
    linesFetched: 0,
    statusMessage: '',
    complete: false
  });
  
  const [metrics, setMetrics] = useState<TokenMetrics | null>(null);
  const [isMetricsLoading, setIsMetricsLoading] = useState<boolean>(false);
  const [excludeIssuer, setExcludeIssuer] = useState<boolean>(true);
  const [isLiveUpdate, setIsLiveUpdate] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Calculate Total Trustline Supply (Memoized)
  const trustlineSupply = useMemo(() => {
    return holders.reduce((acc, h) => acc + h.balance, 0);
  }, [holders]);

  // Initialize Theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Initial Data Load
  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 60000); // Auto refresh price every 60s
    return () => clearInterval(interval);
  }, []);

  // Live Update Logic
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    
    // If Live Update is ON, and we aren't currently fetching...
    if (isLiveUpdate && !fetchStatus.isFetching) {
      // If we just completed a scan, wait 10s then restart
      if (fetchStatus.complete) {
        timeout = setTimeout(() => {
          startScan();
        }, 10000);
      } 
      // If we haven't started yet (and holders is empty), start immediately
      else if (holders.length === 0) {
        startScan();
      }
    }

    return () => clearTimeout(timeout);
  }, [isLiveUpdate, fetchStatus.isFetching, fetchStatus.complete, holders.length]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  const loadMetrics = async () => {
    setIsMetricsLoading(true);
    const data = await fetchTokenMetrics();
    setMetrics(data);
    setIsMetricsLoading(false);
  };

  const startScan = async () => {
    if (fetchStatus.isFetching) return;

    // Detect if this is a background update (data already exists)
    const isBackgroundUpdate = holders.length > 0;

    setFetchStatus({
      isFetching: true,
      linesFetched: 0,
      // If background, keep the current message (e.g., 'Scan complete') to be quiet
      statusMessage: isBackgroundUpdate ? fetchStatus.statusMessage : 'Initializing connection to XRPL...',
      complete: false
    });

    abortControllerRef.current = new AbortController();

    try {
      let allLines: any[] = [];
      let marker: unknown | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error("Scan aborted by user");
        }

        const batch = await fetchTrustlinesBatch(marker);
        
        const holdersBatch = batch.lines.map(line => {
           const rawBalance = parseFloat(line.balance);
           return {
             account: line.account,
             balance: rawBalance < 0 ? Math.abs(rawBalance) : 0
           };
        }).filter(h => h.balance > 0);

        allLines = [...allLines, ...holdersBatch];
        
        // Only update the progress UI if this is an INITIAL scan.
        // If it's a background update, we stay quiet.
        if (!isBackgroundUpdate) {
          setFetchStatus(prev => ({
            ...prev,
            linesFetched: allLines.length,
            statusMessage: `Scanning ledger... found ${allLines.length} holders so far`
          }));
        }

        if (batch.nextMarker) {
          marker = batch.nextMarker;
        } else {
          hasMore = false;
        }
      }

      processResults(allLines, isBackgroundUpdate);

    } catch (error: any) {
      setFetchStatus(prev => ({
        ...prev,
        isFetching: false,
        statusMessage: 'Error during scan.',
        error: error.message
      }));
      // If error occurs, turn off live update to prevent infinite error loops
      setIsLiveUpdate(false);
    }
  };

  const stopScan = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setFetchStatus(prev => ({
        ...prev,
        isFetching: false,
        statusMessage: 'Scan stopped by user.',
        complete: false // Incomplete
      }));
      setIsLiveUpdate(false); // Disable live update on stop
    }
  };

  const processResults = (rawHolders: {account: string, balance: number}[], isBackgroundUpdate: boolean) => {
    if (!isBackgroundUpdate) {
      setFetchStatus(prev => ({
        ...prev,
        statusMessage: 'Processing rich list data...',
      }));
    }

    let sorted = rawHolders.sort((a, b) => b.balance - a.balance);

    if (excludeIssuer) {
      sorted = sorted.filter(h => h.account !== 'rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr');
    }

    const supplyBasis = metrics?.totalSupply || 65_000_000_000; 

    const processed: Holder[] = sorted.map((h, index) => {
      const known = KNOWN_WALLETS[h.account];
      let tier = 'Microbe';
      let tierIcon = '🦠';
      let tierColor = 'text-slate-500 dark:text-slate-500';

      // Ranking Thresholds Logic
      if (h.balance >= 1_000_000_000) { 
        tier = 'Kraken'; 
        tierIcon = '🦑'; 
        tierColor = 'text-purple-600 dark:text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]';
      }
      else if (h.balance >= 500_000_000) { 
        tier = 'Megalodon'; 
        tierIcon = '🦈'; 
        tierColor = 'text-red-600 dark:text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]';
      }
      else if (h.balance >= 250_000_000) { 
        tier = 'Sperm Whale'; 
        tierIcon = '🐳'; 
        tierColor = 'text-indigo-600 dark:text-indigo-400';
      }
      else if (h.balance >= 100_000_000) { 
        tier = 'Whale'; 
        tierIcon = '🐋'; 
        tierColor = 'text-blue-600 dark:text-blue-400';
      }
      else if (h.balance >= 50_000_000) { 
        tier = 'Orca'; 
        tierIcon = '🐋'; 
        tierColor = 'text-slate-900 dark:text-slate-100 drop-shadow-[0_0_5px_rgba(255,255,255,0.3)]';
      }
      else if (h.balance >= 25_000_000) { 
        tier = 'Shark'; 
        tierIcon = '🦈'; 
        tierColor = 'text-slate-600 dark:text-slate-400';
      }
      else if (h.balance >= 10_000_000) { 
        tier = 'Dolphin'; 
        tierIcon = '🐬'; 
        tierColor = 'text-cyan-600 dark:text-cyan-400';
      }
      else if (h.balance >= 5_000_000) { 
        tier = 'Swordfish'; 
        tierIcon = '🐟'; 
        tierColor = 'text-sky-600 dark:text-sky-400';
      }
      else if (h.balance >= 1_000_000) { 
        tier = 'Turtle'; 
        tierIcon = '🐢'; 
        tierColor = 'text-emerald-600 dark:text-emerald-400';
      }
      else if (h.balance >= 500_000) { 
        tier = 'Octopus'; 
        tierIcon = '🐙'; 
        tierColor = 'text-orange-600 dark:text-orange-400';
      }
      else if (h.balance >= 100_000) { 
        tier = 'Crab'; 
        tierIcon = '🦀'; 
        tierColor = 'text-rose-500 dark:text-rose-400';
      }
      else if (h.balance >= 50_000) { 
        tier = 'Shrimp'; 
        tierIcon = '🦐'; 
        tierColor = 'text-pink-500 dark:text-pink-400';
      }
      else if (h.balance >= 10_000) { 
        tier = 'Plankton'; 
        tierIcon = '🌿'; 
        tierColor = 'text-lime-600 dark:text-lime-400';
      }

      return {
        rank: index + 1,
        account: h.account,
        balance: h.balance,
        percentage: (h.balance / supplyBasis) * 100,
        tier,
        tierIcon,
        tierColor,
        walletLabel: known?.label,
        walletType: known?.type
      };
    });

    setHolders(processed);
    setLastUpdated(new Date());
    setFetchStatus({
      isFetching: false,
      linesFetched: processed.length,
      statusMessage: 'Scan complete.',
      complete: true
    });
  };

  const toggleExcludeIssuer = () => {
    setExcludeIssuer(!excludeIssuer);
  };

  const toggleLiveUpdate = () => {
    setIsLiveUpdate(!isLiveUpdate);
  };

  return (
    <div className="min-h-screen text-slate-800 dark:text-slate-200 pb-0 flex flex-col selection:bg-emerald-500/30 selection:text-emerald-900 dark:selection:text-white transition-colors duration-300">
      
      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-emerald-500/10 dark:border-white/5 shadow-sm dark:shadow-[0_4px_30px_rgba(0,0,0,0.8)] transition-all">
        <div className="container mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-white/50 dark:bg-black/50 p-2 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
              <Dices className="text-emerald-600 dark:text-emerald-500 w-8 h-8 drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
            </div>
            <div className="flex flex-col justify-center">
              <h1 className="flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white uppercase italic">CasinoCoin</span>
                <span className="text-sm font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500 dark:from-emerald-400 dark:to-teal-400 text-glow tracking-[0.2em]">CENTRAL</span>
              </h1>
              <div className="flex items-center gap-2 text-[9px] text-emerald-700 dark:text-emerald-600/70 font-mono tracking-widest uppercase mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse box-shadow-[0_0_8px_currentColor]"></span>
                XRPL Mainnet Connected
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
             {/* Theme Toggle */}
             <div className="flex flex-col items-center">
               <span className="text-[8px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Theme</span>
               <button 
                onClick={toggleTheme}
                className="p-2 rounded-full bg-slate-200 dark:bg-white/5 text-slate-700 dark:text-yellow-400 hover:bg-slate-300 dark:hover:bg-white/10 transition-all border border-slate-300 dark:border-white/10"
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
             </div>

            <div className="hidden md:block text-right">
              <div className="text-[10px] uppercase text-emerald-700 dark:text-emerald-700/80 font-bold tracking-wider">Market Price</div>
              <div className="text-lg font-mono font-medium text-emerald-600 dark:text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]">
                ${metrics?.priceUsd.toFixed(6) || "0.000000"}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 flex-grow">
        
        {/* Main 3-Column Layout: Changed breakpoints from xl to lg to fix laptop layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* COL 1: Left Sidebar (Links) - Sticky */}
          <div className="lg:col-span-2 hidden lg:block sticky top-24">
             <Sidebar />
          </div>
          
          {/* Mobile/Tablet Sidebar View (Not sticky) */}
          <div className="lg:hidden block mb-6">
             <Sidebar />
          </div>

          {/* COL 2: Main Content (Scanner + List) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Scanner Controls */}
            <div className="glass-panel rounded-2xl p-1 shadow-xl dark:shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-900 via-emerald-500 to-emerald-900 opacity-80"></div>
              
              {/* Removed h-full here to prevent vertical stretching */}
              <div className="bg-white/80 dark:bg-black/80 rounded-xl p-6 flex flex-col justify-between relative z-10 backdrop-blur-sm transition-colors">
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
                      <Database className="text-emerald-600 dark:text-emerald-500" size={20} />
                      Ledger Scanner
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      Scan XRPL trustlines to analyze CSC distribution.
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                     <button 
                      onClick={toggleLiveUpdate}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition text-xs font-medium w-full sm:w-auto justify-center ${
                        isLiveUpdate 
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]' 
                          : 'bg-transparent border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                      }`}
                      title="Automatically rescan every 10 seconds after completion"
                     >
                       <RefreshCw size={14} className={isLiveUpdate && fetchStatus.isFetching ? "animate-spin" : ""} />
                       Live Update: {isLiveUpdate ? "ON" : "OFF"}
                     </button>

                     <button 
                      onClick={toggleExcludeIssuer}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 hover:bg-emerald-500/10 hover:border-emerald-500/30 transition text-xs font-medium text-emerald-700 dark:text-emerald-100/70 w-full sm:w-auto justify-center"
                      title="Exclude the issuer wallet from rankings"
                     >
                       {excludeIssuer ? <ToggleRight className="text-emerald-500" /> : <ToggleLeft className="text-slate-400 dark:text-slate-600" />}
                       Exclude Issuer
                     </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-center">
                  {!fetchStatus.isFetching || holders.length > 0 ? (
                    <button
                      onClick={() => startScan()}
                      className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 dark:from-emerald-800 dark:to-emerald-600 hover:from-emerald-500 hover:to-emerald-400 dark:hover:from-emerald-700 dark:hover:to-emerald-500 text-white rounded-lg font-bold uppercase tracking-wider shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2 border border-emerald-500/20 whitespace-nowrap"
                    >
                      <Zap size={18} fill="currentColor" />
                      Start Live Scan
                    </button>
                  ) : (
                    <button
                      onClick={stopScan}
                      className="w-full sm:w-auto px-6 py-3 bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-800 rounded-lg font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                      <StopCircle size={18} />
                      Abort Scan
                    </button>
                  )}

                  <div className="flex-grow w-full bg-slate-100 dark:bg-black/60 rounded-lg border border-slate-200 dark:border-white/5 p-3 flex items-center gap-3 shadow-inner transition-colors min-h-[50px]">
                    {fetchStatus.isFetching && holders.length === 0 ? (
                       <Loader2 className="animate-spin text-emerald-500" size={20} />
                    ) : fetchStatus.complete ? (
                       <Activity className="text-emerald-500" size={20} />
                    ) : (
                       <div className="w-5 h-5 rounded-full border-2 border-slate-300 dark:border-slate-800"></div>
                    )}
                    
                    <div className="flex flex-col w-full">
                      <span className={`text-xs font-mono ${fetchStatus.error ? 'text-rose-500 dark:text-red-400' : 'text-slate-600 dark:text-slate-400'}`}>
                        {fetchStatus.statusMessage || "Ready to initiate scan sequence..."}
                      </span>
                      
                      {fetchStatus.isFetching && holders.length === 0 && (
                         <div className="w-full h-1 bg-slate-200 dark:bg-slate-900 rounded-full mt-1.5 overflow-hidden">
                           <div className="h-full bg-emerald-500 animate-progress origin-left shadow-[0_0_10px_#10b981]"></div>
                         </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pop-up Stats Box on Complete */}
                {holders.length > 0 ? (
                  <div className="mt-6 bg-slate-100 dark:bg-white/5 rounded-xl p-5 border border-slate-200 dark:border-white/10 animate-in fade-in slide-in-from-top-2 duration-500">
                     <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-200 dark:border-white/5">
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg">
                          <Database size={20} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-slate-900 dark:text-white font-bold text-sm">Completed. Scanned {holders.length.toLocaleString()} holders.</div>
                          {lastUpdated && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                               <Clock size={10} />
                               Updated: {lastUpdated.toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                     </div>
                     
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                       <div>
                         <div className="text-[10px] uppercase text-slate-500 dark:text-slate-500 font-bold tracking-wider mb-1">Holders</div>
                         <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white">{holders.length.toLocaleString()}</div>
                       </div>
                       <div>
                         <div className="text-[10px] uppercase text-slate-500 dark:text-slate-500 font-bold tracking-wider mb-1">Total Supply (Trustlines)</div>
                         <div className="text-2xl font-mono font-bold text-emerald-600 dark:text-emerald-400 text-glow">{trustlineSupply.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                       </div>
                     </div>
                  </div>
                ) : (
                  lastUpdated && (
                    <div className="mt-4 flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-600/60 font-mono">
                      <Clock size={10} />
                      Last Updated: {lastUpdated.toLocaleTimeString()}
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Token Stats (Full width in Center Col) */}
            <TokenStatistics metrics={metrics} isLoading={isMetricsLoading} />

            {/* Market Chart */}
            <MarketChart />

            {/* Rich List (Full width in Center Col) */}
            <div className="glass-panel rounded-xl border border-white/10 p-1 shadow-2xl">
              <RichListTable holders={holders} />
            </div>

          </div>

          {/* COL 3: Right Sidebar (Calc) */}
          <div className="lg:col-span-3 space-y-6 sticky top-24">
             <PriceCalculator metrics={metrics} onRefresh={loadMetrics} isLoading={isMetricsLoading} />
             <LuckyGames />
             <LuckyHashPromo />
             <DonationBox />
          </div>

        </div>

      </main>

      <footer className="border-t border-emerald-500/10 dark:border-white/5 bg-white/50 dark:bg-black/80 backdrop-blur-md py-8 text-center transition-colors">
        <p className="text-slate-500 dark:text-slate-600 text-xs font-mono mb-2">CasinoCoin Central</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-800">
          Data sourced from XRPL public nodes. Not financial advice.
        </p>
      </footer>
      
      <style>{`
        .animate-progress {
          animation: progress 1.5s infinite ease-in-out;
          width: 40%;
        }
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default App;