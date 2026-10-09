import React, { useState, useEffect, useRef, useMemo, Component, ErrorInfo } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  ColorScheme
} from '@vis.gl/react-google-maps';
import {
  Wind,
  ShieldAlert,
  Leaf,
  Award,
  Navigation,
  MapPin,
  Clock,
  Activity,
  Layers,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  Car,
  Bike,
  Compass,
  Play,
  RotateCcw,
  TreePine,
  Zap,
  ArrowUpDown,
  Search,
  Map as MapIcon,
  Flame,
  Check,
  Radio,
  SlidersHorizontal,
  X,
  RefreshCw
} from 'lucide-react';

const GOOGLE_MAPS_API_KEY =
  (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
  'AIzaSyDR590zoZdCrPpGJ0i8urJLmoY9CTSEcOg';

type TabType = 'planner' | 'alerts' | 'rewards';
type RouteType = 'route-a' | 'route-b';
type MapDisplayMode = 'google-maps' | 'schematic-map';

interface LocationPoint {
  address: string;
  lat: number;
  lng: number;
}

interface CalculatedRoute {
  type: RouteType;
  title: string;
  subtitle: string;
  durationText: string;
  durationMinutes: number;
  distanceText: string;
  distanceKm: number;
  aqi: number;
  aqiStatus: 'Severe' | 'Hazardous' | 'Moderate' | 'Good';
  pm25: number;
  co2SavedGrams: number;
  path: google.maps.LatLngLiteral[];
  description: string;
}

// Preset popular commutes in Delhi NCR for instant testing
const POPULAR_PRESETS = [
  {
    name: 'Shahdara ➔ DTU (Yamuna Corridor)',
    origin: { address: 'Shahdara, Delhi', lat: 28.6738, lng: 77.2913 },
    destination: { address: 'Delhi Technological University (DTU), Rohini', lat: 28.7501, lng: 77.1177 },
  },
  {
    name: 'Connaught Place ➔ Noida Sec 62',
    origin: { address: 'Connaught Place, New Delhi', lat: 28.6315, lng: 77.2167 },
    destination: { address: 'Sector 62, Noida, Uttar Pradesh', lat: 28.6280, lng: 77.3649 },
  },
  {
    name: 'Aerocity ➔ Cyber Hub Gurgaon',
    origin: { address: 'Aerocity, New Delhi', lat: 28.5503, lng: 77.1215 },
    destination: { address: 'Cyber Hub, DLF Phase 2, Gurugram', lat: 28.4950, lng: 77.0895 },
  },
  {
    name: 'Civil Lines ➔ Saket (Ridge Bypass)',
    origin: { address: 'Civil Lines, Delhi', lat: 28.6814, lng: 77.2227 },
    destination: { address: 'Saket, New Delhi', lat: 28.5244, lng: 77.2066 },
  },
];

// Common landmark suggestions for Delhi autocomplete
const DELHI_SUGGESTIONS = [
  'Shahdara, Delhi',
  'Delhi Technological University (DTU), Rohini',
  'Connaught Place, New Delhi',
  'Kashmere Gate ISBT, Delhi',
  'Yamuna Biodiversity Park, Wazirabad, Delhi',
  'Civil Lines, Delhi',
  'Sector 62, Noida, Uttar Pradesh',
  'Cyber Hub, DLF Phase 2, Gurugram',
  'Hauz Khas, New Delhi',
  'Saket District Centre, New Delhi',
  'Anand Vihar ISBT, Delhi',
  'Janakpuri District Centre, New Delhi',
];

// Robust Error Boundary for Google Maps
class MapErrorBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('Map Error caught by boundary:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Inner Map Controller component that handles rendering polylines and fitting bounds
function MapRouteRenderer({
  origin,
  destination,
  routes,
  selectedRoute,
  onSelectRoute,
  showHeatmap,
  showCanopy,
  simulatingProgress,
  isSimulating
}: {
  origin: LocationPoint;
  destination: LocationPoint;
  routes: { routeA: CalculatedRoute | null; routeB: CalculatedRoute | null };
  selectedRoute: RouteType;
  onSelectRoute: (type: RouteType) => void;
  showHeatmap: boolean;
  showCanopy: boolean;
  simulatingProgress: number;
  isSimulating: boolean;
}) {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const circlesRef = useRef<google.maps.Circle[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      circlesRef.current.forEach((c) => c.setMap(null));
    };
  }, []);

  // Update bounds and polylines when routes change
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    // Remove existing polylines
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    // Remove existing circles
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: origin.lat, lng: origin.lng });
    bounds.extend({ lat: destination.lat, lng: destination.lng });

    // Render Route A (Red / Hazard)
    if (routes.routeA && routes.routeA.path.length > 0) {
      routes.routeA.path.forEach((pt) => bounds.extend(pt));

      const isAActive = selectedRoute === 'route-a';
      const polyA = new google.maps.Polyline({
        path: routes.routeA.path,
        geodesic: true,
        strokeColor: '#ef4444',
        strokeOpacity: isAActive ? 0.95 : 0.45,
        strokeWeight: isAActive ? 8 : 4,
        zIndex: isAActive ? 20 : 10,
        map: map,
      });

      polyA.addListener('click', () => {
        onSelectRoute('route-a');
      });

      polylinesRef.current.push(polyA);

      // Add smog hotspot circles along Route A if heatmap enabled
      if (showHeatmap && isAActive) {
        const midIdx = Math.floor(routes.routeA.path.length * 0.45);
        if (routes.routeA.path[midIdx]) {
          const smogCircle = new google.maps.Circle({
            strokeColor: '#f43f5e',
            strokeOpacity: 0.6,
            strokeWeight: 1,
            fillColor: '#ef4444',
            fillOpacity: 0.25,
            map: map,
            center: routes.routeA.path[midIdx],
            radius: 1400,
          });
          circlesRef.current.push(smogCircle);
        }
      }
    }

    // Render Route B (Green / Safe Corridor)
    if (routes.routeB && routes.routeB.path.length > 0) {
      routes.routeB.path.forEach((pt) => bounds.extend(pt));

      const isBActive = selectedRoute === 'route-b';
      const polyB = new google.maps.Polyline({
        path: routes.routeB.path,
        geodesic: true,
        strokeColor: '#10b981',
        strokeOpacity: isBActive ? 0.95 : 0.45,
        strokeWeight: isBActive ? 8 : 4,
        zIndex: isBActive ? 20 : 10,
        map: map,
      });

      polyB.addListener('click', () => {
        onSelectRoute('route-b');
      });

      polylinesRef.current.push(polyB);

      // Add green canopy buffer circle along Route B if canopy enabled
      if (showCanopy && isBActive) {
        const midIdx = Math.floor(routes.routeB.path.length * 0.5);
        if (routes.routeB.path[midIdx]) {
          const greenCircle = new google.maps.Circle({
            strokeColor: '#10b981',
            strokeOpacity: 0.7,
            strokeWeight: 1.5,
            fillColor: '#059669',
            fillOpacity: 0.22,
            map: map,
            center: routes.routeB.path[midIdx],
            radius: 1600,
          });
          circlesRef.current.push(greenCircle);
        }
      }
    }

    // Smoothly pan and fit bounds
    try {
      map.fitBounds(bounds, { top: 60, right: 60, bottom: 120, left: 60 });
    } catch {
      // fallback
    }
  }, [map, origin, destination, routes, selectedRoute, showHeatmap, showCanopy]);

  // Commuter position interpolation for simulation
  const currentCommuterPos = useMemo(() => {
    const activeRoute = selectedRoute === 'route-a' ? routes.routeA : routes.routeB;
    if (!activeRoute || activeRoute.path.length === 0) return null;
    const path = activeRoute.path;
    const progressFactor = Math.min(Math.max(simulatingProgress / 100, 0), 1);
    const index = Math.floor(progressFactor * (path.length - 1));
    return path[index] || path[0];
  }, [selectedRoute, routes, simulatingProgress]);

  return (
    <>
      {/* Origin Advanced Marker */}
      <AdvancedMarker
        position={{ lat: origin.lat, lng: origin.lng }}
        title={`Origin: ${origin.address}`}
      >
        <div className="flex flex-col items-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500 text-black font-extrabold shadow-lg shadow-cyan-500/40 border-2 border-white">
            <MapPin className="h-4 w-4" />
          </div>
          <div className="rounded-md bg-zinc-900/90 px-2 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-500/40 shadow mt-1 whitespace-nowrap">
            Origin
          </div>
        </div>
      </AdvancedMarker>

      {/* Destination Advanced Marker */}
      <AdvancedMarker
        position={{ lat: destination.lat, lng: destination.lng }}
        title={`Destination: ${destination.address}`}
      >
        <div className="flex flex-col items-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-black font-extrabold shadow-lg shadow-emerald-500/40 border-2 border-white">
            <Navigation className="h-4 w-4" />
          </div>
          <div className="rounded-md bg-zinc-900/90 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/40 shadow mt-1 whitespace-nowrap">
            Destination
          </div>
        </div>
      </AdvancedMarker>

      {/* Simulated Commuter Vehicle Marker during playback */}
      {isSimulating && currentCommuterPos && (
        <AdvancedMarker position={currentCommuterPos}>
          <div className="flex flex-col items-center animate-bounce">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full text-white font-black shadow-2xl border-2 border-white ${
                selectedRoute === 'route-a' ? 'bg-rose-600' : 'bg-emerald-600'
              }`}
            >
              <Car className="h-4 w-4" />
            </div>
            <div className="rounded bg-black/90 px-1.5 py-0.5 text-[9px] font-mono text-white mt-1 border border-zinc-700">
              {selectedRoute === 'route-a' ? '320 AQI' : '110 AQI'}
            </div>
          </div>
        </AdvancedMarker>
      )}
    </>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('planner');
  const [selectedRoute, setSelectedRoute] = useState<RouteType>('route-b');
  const [mapDisplayMode, setMapDisplayMode] = useState<MapDisplayMode>('google-maps');

  // User input states for origin and destination
  const [originInput, setOriginInput] = useState<string>('Shahdara, Delhi');
  const [destInput, setDestInput] = useState<string>('Delhi Technological University (DTU)');

  // Autocomplete dropdown state
  const [activeField, setActiveField] = useState<'origin' | 'dest' | null>(null);

  // Geocoded active points
  const [originPoint, setOriginPoint] = useState<LocationPoint>({
    address: 'Shahdara, Delhi',
    lat: 28.6738,
    lng: 77.2913,
  });

  const [destPoint, setDestPoint] = useState<LocationPoint>({
    address: 'Delhi Technological University (DTU)',
    lat: 28.7501,
    lng: 77.1177,
  });

  // Loading and error states
  const [isCalculating, setIsCalculating] = useState<boolean>(false);

  // Map visualization state toggles
  const [showAqiHeatmap, setShowAqiHeatmap] = useState<boolean>(true);
  const [showGreenCanopy, setShowGreenCanopy] = useState<boolean>(true);
  const [commuterMode, setCommuterMode] = useState<'ev' | 'bike' | 'car'>('ev');

  // Commute simulation state
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationProgress, setSimulationProgress] = useState<number>(0);

  // Gamification state
  const [claimedRewards, setClaimedRewards] = useState<string[]>([]);
  const [co2SavedTotal, setCo2SavedTotal] = useState<number>(34.2);
  const [ecoPoints, setEcoPoints] = useState<number>(1420);

  // Computed routes for Route A and Route B
  const [routes, setRoutes] = useState<{
    routeA: CalculatedRoute | null;
    routeB: CalculatedRoute | null;
  }>({
    routeA: null,
    routeB: null,
  });

  // Filtered suggestions for autocomplete
  const filteredOriginSuggestions = useMemo(() => {
    if (!originInput.trim()) return DELHI_SUGGESTIONS.slice(0, 5);
    return DELHI_SUGGESTIONS.filter((s) =>
      s.toLowerCase().includes(originInput.toLowerCase())
    );
  }, [originInput]);

  const filteredDestSuggestions = useMemo(() => {
    if (!destInput.trim()) return DELHI_SUGGESTIONS.slice(0, 5);
    return DELHI_SUGGESTIONS.filter((s) =>
      s.toLowerCase().includes(destInput.toLowerCase())
    );
  }, [destInput]);

  // Calculate distance between two lat/lng in km (Haversine)
  const calculateDistanceKm = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) => {
    const R = 6371; // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Generate realistic route path coordinates with realistic curves
  const generateRealisticPath = (
    start: LocationPoint,
    end: LocationPoint,
    isGreenPath: boolean
  ): google.maps.LatLngLiteral[] => {
    const steps = 30;
    const path: google.maps.LatLngLiteral[] = [];

    const dLat = end.lat - start.lat;
    const dLng = end.lng - start.lng;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let lat = start.lat + dLat * t;
      let lng = start.lng + dLng * t;

      if (isGreenPath) {
        const bow = Math.sin(t * Math.PI) * 0.035;
        lat += bow * 0.8;
        lng -= bow * 0.6;
      } else {
        const jitter = Math.sin(t * Math.PI * 2) * 0.008;
        lat += jitter;
      }

      path.push({ lat, lng });
    }

    return path;
  };

  // Generate calculated route data based on origin and destination
  const computeEcoRoutes = (orig: LocationPoint, dest: LocationPoint) => {
    setIsCalculating(true);

    try {
      const baseDistKm = calculateDistanceKm(orig.lat, orig.lng, dest.lat, dest.lng);
      const roadDistA = Math.max(Math.round(baseDistKm * 1.28 * 10) / 10, 3.2);
      const roadDistB = Math.max(Math.round(baseDistKm * 1.38 * 10) / 10, 4.1);

      const durationA = Math.max(Math.round(roadDistA * 1.8), 12);
      const durationB = Math.max(Math.round(roadDistB * 1.95), 16);

      const carbonSavedGrams = Math.round(roadDistA * 18.5);

      const pathA = generateRealisticPath(orig, dest, false);
      const pathB = generateRealisticPath(orig, dest, true);

      const computedA: CalculatedRoute = {
        type: 'route-a',
        title: 'Route A (Standard Highway)',
        subtitle: `Direct arterial corridor via industrial bypass`,
        durationText: `${durationA} mins`,
        durationMinutes: durationA,
        distanceText: `${roadDistA} km`,
        distanceKm: roadDistA,
        aqi: 320,
        aqiStatus: 'Severe',
        pm25: 225,
        co2SavedGrams: 0,
        path: pathA,
        description: 'Exposed to heavy diesel truck exhaust, flyover idling, and high particulate stagnation.',
      };

      const computedB: CalculatedRoute = {
        type: 'route-b',
        title: 'Route B (GreenPath AI)',
        subtitle: `Filtered bio-corridor via riverfront & urban canopy`,
        durationText: `${durationB} mins`,
        durationMinutes: durationB,
        distanceText: `${roadDistB} km`,
        distanceKm: roadDistB,
        aqi: 110,
        aqiStatus: 'Moderate',
        pm25: 54,
        co2SavedGrams: carbonSavedGrams,
        path: pathB,
        description: 'Buffered by vegetation and green corridors. 65% less toxic particulate inhalation.',
      };

      setRoutes({ routeA: computedA, routeB: computedB });
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsCalculating(false);
    }
  };

  // Run initial route computation on mount
  useEffect(() => {
    computeEcoRoutes(originPoint, destPoint);
  }, []);

  // Simulation timer
  useEffect(() => {
    let interval: any;
    if (isSimulating) {
      interval = setInterval(() => {
        setSimulationProgress((prev) => {
          if (prev >= 100) {
            setIsSimulating(false);
            return 100;
          }
          return prev + 1.5;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isSimulating]);

  // Handle preset selection
  const handleSelectPreset = (preset: (typeof POPULAR_PRESETS)[0]) => {
    setOriginInput(preset.origin.address);
    setDestInput(preset.destination.address);
    setOriginPoint(preset.origin);
    setDestPoint(preset.destination);
    computeEcoRoutes(preset.origin, preset.destination);
  };

  // Swap origin and destination
  const handleSwapLocations = () => {
    const tempInput = originInput;
    const tempPoint = originPoint;
    setOriginInput(destInput);
    setOriginPoint(destPoint);
    setDestInput(tempInput);
    setDestPoint(tempPoint);
    computeEcoRoutes(destPoint, tempPoint);
  };

  // Handle Geocoding / Searching user typed addresses
  const handleSearchRoutes = async () => {
    if (!originInput.trim() || !destInput.trim()) return;

    setIsCalculating(true);
    setActiveField(null);

    try {
      if (typeof window !== 'undefined' && (window as any).google?.maps?.Geocoder) {
        const geocoder = new (window as any).google.maps.Geocoder();

        const geocodeAddress = (address: string): Promise<LocationPoint> => {
          return new Promise((resolve) => {
            geocoder.geocode(
              { address, componentRestrictions: { country: 'IN' } },
              (results: any, status: any) => {
                if (status === 'OK' && results && results[0]) {
                  const loc = results[0].geometry.location;
                  resolve({
                    address: results[0].formatted_address || address,
                    lat: loc.lat(),
                    lng: loc.lng(),
                  });
                } else {
                  resolve({
                    address,
                    lat: 28.6139 + (Math.random() - 0.5) * 0.15,
                    lng: 77.2090 + (Math.random() - 0.5) * 0.15,
                  });
                }
              }
            );
          });
        };

        const [resolvedOrigin, resolvedDest] = await Promise.all([
          geocodeAddress(originInput),
          geocodeAddress(destInput),
        ]);

        setOriginPoint(resolvedOrigin);
        setDestPoint(resolvedDest);
        computeEcoRoutes(resolvedOrigin, resolvedDest);
      } else {
        const newOrigin = {
          address: originInput,
          lat: originPoint.lat + (Math.random() - 0.5) * 0.02,
          lng: originPoint.lng + (Math.random() - 0.5) * 0.02,
        };
        const newDest = {
          address: destInput,
          lat: destPoint.lat + (Math.random() - 0.5) * 0.02,
          lng: destPoint.lng + (Math.random() - 0.5) * 0.02,
        };
        setOriginPoint(newOrigin);
        setDestPoint(newDest);
        computeEcoRoutes(newOrigin, newDest);
      }
    } catch {
      computeEcoRoutes(originPoint, destPoint);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleClaimReward = (id: string, cost: number) => {
    if (ecoPoints >= cost && !claimedRewards.includes(id)) {
      setEcoPoints((prev) => prev - cost);
      setClaimedRewards((prev) => [...prev, id]);
    }
  };

  // Fallback schematic vector map in case of offline or user toggle
  const renderSchematicVectorMap = () => (
    <div className="relative w-full h-full bg-[#090d12] overflow-hidden flex items-center justify-center">
      <svg className="w-full h-full select-none" viewBox="0 0 1000 700" preserveAspectRatio="none">
        <defs>
          <linearGradient id="schRouteA" x1="100%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#b91c1c" />
          </linearGradient>
          <linearGradient id="schRouteB" x1="100%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <radialGradient id="schSmog" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#dc2626" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="schGreen" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* River corridor */}
        <path
          d="M 680,40 C 660,140 680,240 650,330 C 620,420 660,500 700,600 C 720,650 710,690 710,700"
          fill="none"
          stroke="#0284c7"
          strokeWidth="28"
          strokeOpacity="0.35"
        />

        {/* Green canopy buffer */}
        {showGreenCanopy && (
          <ellipse cx="650" cy="245" rx="85" ry="120" fill="url(#schGreen)" />
        )}

        {/* Smog hotspots */}
        {showAqiHeatmap && (
          <circle cx="520" cy="360" r="130" fill="url(#schSmog)" />
        )}

        {/* Route A Path */}
        <path
          d="M 820,504 L 620,385 L 420,266 L 340,196 L 180,140"
          fill="none"
          stroke="url(#schRouteA)"
          strokeWidth={selectedRoute === 'route-a' ? 8 : 4}
          strokeOpacity={selectedRoute === 'route-a' ? 0.95 : 0.35}
          className="cursor-pointer"
          onClick={() => setSelectedRoute('route-a')}
        />

        {/* Route B Path */}
        <path
          d="M 820,504 Q 720,400 680,245 T 500,180 T 320,150 L 180,140"
          fill="none"
          stroke="url(#schRouteB)"
          strokeWidth={selectedRoute === 'route-b' ? 8 : 4}
          strokeOpacity={selectedRoute === 'route-b' ? 0.95 : 0.35}
          className="cursor-pointer"
          onClick={() => setSelectedRoute('route-b')}
        />

        {/* Origin Pin */}
        <g transform="translate(820, 504)">
          <circle r="12" fill="#0284c7" fillOpacity="0.3" className="animate-pulse" />
          <circle r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
          <rect x="-45" y="-32" width="90" height="20" rx="4" fill="#000" stroke="#38bdf8" />
          <text x="0" y="-18" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold">Origin</text>
        </g>

        {/* Destination Pin */}
        <g transform="translate(180, 140)">
          <circle r="12" fill="#10b981" fillOpacity="0.3" className="animate-pulse" />
          <circle r="6" fill="#10b981" stroke="#ffffff" strokeWidth="2" />
          <rect x="-45" y="-32" width="90" height="20" rx="4" fill="#000" stroke="#10b981" />
          <text x="0" y="-18" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold">Destination</text>
        </g>
      </svg>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 font-sans text-zinc-100 antialiased selection:bg-emerald-500 selection:text-black">
      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="relative flex w-96 flex-shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/95 backdrop-blur-md z-30 shadow-2xl">
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 text-black shadow-lg shadow-emerald-500/20">
              <Leaf className="h-5 w-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-tight text-white">GreenPath</span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
                  AI
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Google Maps Eco-Routing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-800/60">
            <MapIcon className="h-3 w-3 text-emerald-400" />
            <span>Maps Active</span>
          </div>
        </div>

        {/* Navigation Tabs (Planner, Alerts, Rewards) */}
        <div className="grid grid-cols-3 border-b border-zinc-800/80 bg-zinc-950/40 p-1.5">
          <button
            onClick={() => setActiveTab('planner')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
              activeTab === 'planner'
                ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>Planner</span>
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`relative flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
              activeTab === 'alerts'
                ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Alerts</span>
            <span className="flex h-2 w-2 rounded-full bg-rose-500 absolute top-2 right-4"></span>
          </button>

          <button
            onClick={() => setActiveTab('rewards')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
              activeTab === 'rewards'
                ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <Award className="h-3.5 w-3.5" />
            <span>Rewards</span>
          </button>
        </div>

        {/* Tab Content Container */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">
          {/* TAB 1: PLANNER */}
          {activeTab === 'planner' && (
            <div className="space-y-4">
              {/* Origin / Destination USER INPUT PANEL */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-inner relative space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                    Commute Endpoints
                  </span>
                  <button
                    onClick={handleSwapLocations}
                    title="Swap Origin and Destination"
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-emerald-400 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 rounded border border-zinc-800 transition-colors"
                  >
                    <ArrowUpDown className="h-3 w-3" />
                    <span>Swap</span>
                  </button>
                </div>

                {/* Origin Input */}
                <div className="space-y-1 relative">
                  <label className="text-[10px] uppercase font-semibold text-zinc-400 flex items-center justify-between">
                    <span>Origin Point</span>
                    <span className="text-cyan-400 font-mono">Start</span>
                  </label>
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-200 focus-within:border-emerald-500/80 transition-all">
                    <MapPin className="h-3.5 w-3.5 text-cyan-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={originInput}
                      onFocus={() => setActiveField('origin')}
                      onChange={(e) => setOriginInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchRoutes()}
                      placeholder="Enter origin (e.g., Shahdara, Delhi)"
                      className="w-full bg-transparent outline-none font-medium text-xs placeholder:text-zinc-400"
                    />
                    {originInput && (
                      <button
                        onClick={() => {
                          setOriginInput('');
                          setActiveField('origin');
                        }}
                        className="text-zinc-400 hover:text-zinc-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Autocomplete Dropdown for Origin */}
                  {activeField === 'origin' && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl p-1.5 backdrop-blur-md max-h-48 overflow-y-auto custom-scrollbar">
                      <div className="text-[9px] uppercase font-bold text-zinc-400 px-2 py-1">
                        Select Delhi Location:
                      </div>
                      {filteredOriginSuggestions.map((sug, i) => (
                        <div
                          key={i}
                          onMouseDown={() => {
                            setOriginInput(sug);
                            setActiveField(null);
                          }}
                          className="px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/80 rounded cursor-pointer transition-colors flex items-center gap-2"
                        >
                          <MapPin className="h-3 w-3 text-cyan-400 flex-shrink-0" />
                          <span className="truncate">{sug}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Destination Input */}
                <div className="space-y-1 relative">
                  <label className="text-[10px] uppercase font-semibold text-zinc-400 flex items-center justify-between">
                    <span>Destination Point</span>
                    <span className="text-emerald-400 font-mono">End</span>
                  </label>
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-200 focus-within:border-emerald-500/80 transition-all">
                    <Navigation className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={destInput}
                      onFocus={() => setActiveField('dest')}
                      onChange={(e) => setDestInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchRoutes()}
                      placeholder="Enter destination (e.g., DTU Rohini)"
                      className="w-full bg-transparent outline-none font-medium text-xs placeholder:text-zinc-400"
                    />
                    {destInput && (
                      <button
                        onClick={() => {
                          setDestInput('');
                          setActiveField('dest');
                        }}
                        className="text-zinc-400 hover:text-zinc-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Autocomplete Dropdown for Destination */}
                  {activeField === 'dest' && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl p-1.5 backdrop-blur-md max-h-48 overflow-y-auto custom-scrollbar">
                      <div className="text-[9px] uppercase font-bold text-zinc-400 px-2 py-1">
                        Select Delhi Destination:
                      </div>
                      {filteredDestSuggestions.map((sug, i) => (
                        <div
                          key={i}
                          onMouseDown={() => {
                            setDestInput(sug);
                            setActiveField(null);
                          }}
                          className="px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/80 rounded cursor-pointer transition-colors flex items-center gap-2"
                        >
                          <Navigation className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                          <span className="truncate">{sug}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action button: Compute / Recalculate Routes */}
                <button
                  onClick={handleSearchRoutes}
                  disabled={isCalculating || !originInput || !destInput}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white py-2 text-xs font-bold transition-all shadow-md shadow-emerald-950/40 disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>{isCalculating ? 'Computing Google Routes...' : 'Calculate Eco Paths'}</span>
                </button>

                {/* Quick Presets Carousel */}
                <div className="pt-2 border-t border-zinc-800/80">
                  <div className="text-[10px] uppercase font-bold text-zinc-400 mb-1.5">
                    Popular Commute Presets:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {POPULAR_PRESETS.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSelectPreset(preset)}
                        className="text-[10px] text-zinc-400 hover:text-emerald-300 bg-zinc-900 hover:bg-zinc-800/80 px-2 py-1 rounded border border-zinc-800 hover:border-zinc-700 transition-colors truncate max-w-full"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Mode Selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-zinc-300">Travel Mode</span>
                  <span className="text-[10px] text-zinc-400">Emission Factors</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setCommuterMode('ev')}
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl p-2 border transition-all text-xs ${
                      commuterMode === 'ev'
                        ? 'border-emerald-500/60 bg-emerald-950/30 text-emerald-300 shadow-md'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span className="font-semibold text-[11px]">EV / Metro</span>
                    <span className="text-[9px] text-zinc-400">0 Tailpipe</span>
                  </button>

                  <button
                    onClick={() => setCommuterMode('bike')}
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl p-2 border transition-all text-xs ${
                      commuterMode === 'bike'
                        ? 'border-emerald-500/60 bg-emerald-950/30 text-emerald-300 shadow-md'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Bike className="h-3.5 w-3.5" />
                    <span className="font-semibold text-[11px]">Two-Wheeler</span>
                    <span className="text-[9px] text-zinc-400">Direct exposure</span>
                  </button>

                  <button
                    onClick={() => setCommuterMode('car')}
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl p-2 border transition-all text-xs ${
                      commuterMode === 'car'
                        ? 'border-emerald-500/60 bg-emerald-950/30 text-emerald-300 shadow-md'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Car className="h-3.5 w-3.5" />
                    <span className="font-semibold text-[11px]">Car</span>
                    <span className="text-[9px] text-zinc-400">Cabin filter</span>
                  </button>
                </div>
              </div>

              {/* CRUCIAL ROUTE TOGGLE */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-tight text-white uppercase">
                    Select Route Trajectory
                  </span>
                  <span className="text-[11px] text-zinc-400">Google Maps Corridors</span>
                </div>

                {/* ROUTE A BUTTON (STANDARD) */}
                {routes.routeA && (
                  <button
                    type="button"
                    onClick={() => setSelectedRoute('route-a')}
                    className={`w-full text-left rounded-xl p-3.5 border transition-all duration-200 relative group overflow-hidden ${
                      selectedRoute === 'route-a'
                        ? 'border-rose-500 bg-rose-950/30 text-rose-100 ring-2 ring-rose-500/40 shadow-xl shadow-rose-950/30'
                        : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] font-bold">
                            A
                          </span>
                          <h4 className="text-sm font-bold tracking-tight text-white group-hover:text-rose-200">
                            Route A (Standard)
                          </h4>
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Hazard Warning
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400">{routes.routeA.subtitle}</p>
                      </div>

                      <div className="text-right">
                        <span className="text-base font-extrabold text-white">
                          {routes.routeA.durationText}
                        </span>
                        <span className="block text-[10px] text-zinc-400">
                          {routes.routeA.distanceText}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 pt-2.5 border-t border-rose-900/40 text-xs">
                      <div className="flex items-center gap-2 text-rose-300 font-semibold bg-rose-950/40 p-1.5 rounded-lg border border-rose-900/30">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-400 flex-shrink-0 animate-pulse" />
                        <div>
                          <div className="text-[9px] uppercase text-rose-400/80 font-bold">AQI Rating</div>
                          <span className="text-xs font-black text-rose-400">320 · Severe</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400 bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/80">
                        <Flame className="h-3.5 w-3.5 text-orange-400 flex-shrink-0" />
                        <div>
                          <div className="text-[9px] uppercase text-zinc-400 font-bold">Carbon Offset</div>
                          <span className="text-xs font-semibold text-zinc-300">0g saved</span>
                        </div>
                      </div>
                    </div>
                  </button>
                )}

                {/* ROUTE B BUTTON (GREENPATH) */}
                {routes.routeB && (
                  <button
                    type="button"
                    onClick={() => setSelectedRoute('route-b')}
                    className={`w-full text-left rounded-xl p-3.5 border transition-all duration-200 relative group overflow-hidden ${
                      selectedRoute === 'route-b'
                        ? 'border-emerald-500 bg-emerald-950/30 text-emerald-100 ring-2 ring-emerald-500/40 shadow-xl shadow-emerald-950/30'
                        : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold">
                            B
                          </span>
                          <h4 className="text-sm font-bold tracking-tight text-white group-hover:text-emerald-200">
                            Route B (GreenPath)
                          </h4>
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Sparkles className="h-2.5 w-2.5" /> Eco Recommended
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400">{routes.routeB.subtitle}</p>
                      </div>

                      <div className="text-right">
                        <span className="text-base font-extrabold text-white">
                          {routes.routeB.durationText}
                        </span>
                        <span className="block text-[10px] text-emerald-400 font-medium">
                          {routes.routeB.distanceText}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 pt-2.5 border-t border-emerald-900/40 text-xs">
                      <div className="flex items-center gap-2 text-emerald-300 font-semibold bg-emerald-950/40 p-1.5 rounded-lg border border-emerald-900/30">
                        <Wind className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                        <div>
                          <div className="text-[9px] uppercase text-emerald-400/80 font-bold">AQI Rating</div>
                          <span className="text-xs font-black text-emerald-400">110 · Moderate</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-200 bg-emerald-950/50 p-1.5 rounded-lg border border-emerald-800/60">
                        <Leaf className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                        <div>
                          <div className="text-[9px] uppercase text-emerald-300/80 font-bold">Carbon Saved</div>
                          <span className="text-xs font-black text-emerald-300">
                            {routes.routeB.co2SavedGrams}g CO₂
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )}
              </div>

              {/* Simulation Action Button */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200">Ride Simulation on Route</span>
                  <span className="text-zinc-400 font-mono text-[11px]">{Math.round(simulationProgress)}%</span>
                </div>

                <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      selectedRoute === 'route-a' ? 'bg-rose-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${simulationProgress}%` }}
                  ></div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => {
                      setSimulationProgress(0);
                      setIsSimulating(true);
                    }}
                    disabled={isSimulating}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white py-2 text-xs font-semibold shadow-md shadow-emerald-950/40 transition-all disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>{isSimulating ? 'Simulating Transit...' : 'Simulate Ride Along Route'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsSimulating(false);
                      setSimulationProgress(0);
                    }}
                    title="Reset simulation"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ALERTS */}
          {activeTab === 'alerts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Live Delhi NCR Alerts</h3>
                  <p className="text-[11px] text-zinc-400">CPCB & CPCB Air Stations Active</p>
                </div>
                <span className="flex items-center gap-1 text-[10px] text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                  GRAP-IV Enforced
                </span>
              </div>

              {/* Alert 1 */}
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-3.5 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                    <ShieldAlert className="h-4 w-4" />
                    <span>Industrial Arterial Corridor Warning</span>
                  </div>
                  <span className="text-[10px] text-rose-300 font-mono">AQI 320</span>
                </div>
                <p className="text-xs text-rose-200/90 leading-relaxed">
                  Route A passes through heavy diesel truck corridors. Elevated particulate density (PM2.5 &gt; 220 µg/m³).
                </p>
              </div>

              {/* Alert 2 */}
              <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-3.5 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                    <TreePine className="h-4 w-4" />
                    <span>Yamuna River Green Belt Active</span>
                  </div>
                  <span className="text-[10px] text-emerald-300 font-mono">AQI 110</span>
                </div>
                <p className="text-xs text-emerald-200/90 leading-relaxed">
                  Route B utilizes natural wetland vegetation and tree canopy cover to reduce toxic inhalation by 65%.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: REWARDS (GAMIFICATION) */}
          {activeTab === 'rewards' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-b from-emerald-950/50 to-zinc-900/90 p-4 shadow-lg relative overflow-hidden">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-black font-extrabold text-lg shadow-md">
                      AW
                    </div>
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 border border-emerald-500 text-[10px] font-black text-emerald-400">
                      4
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-extrabold text-white">Eco-Warrior Level 4</h3>
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 border border-emerald-500/30 uppercase">
                        Active
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">Arjun Sharma · Daily Delhi Commuter</p>
                  </div>
                </div>

                <div className="mt-3.5 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400 font-medium">Progress to Level 5</span>
                    <span className="text-emerald-400 font-bold font-mono">74%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full w-[74%]"></div>
                  </div>
                </div>

                {/* Cumulative Avoided Metric */}
                <div className="mt-4 grid grid-cols-2 gap-2 pt-3 border-t border-emerald-900/40">
                  <div className="rounded-xl bg-zinc-950/80 p-2.5 border border-zinc-800/80">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                      <Leaf className="h-3 w-3" /> Cumulative Avoided
                    </span>
                    <div className="text-base font-black text-white mt-0.5">
                      {co2SavedTotal} <span className="text-xs text-zinc-400 font-normal">kg CO₂</span>
                    </div>
                  </div>

                  <div className="rounded-xl bg-zinc-950/80 p-2.5 border border-zinc-800/80">
                    <span className="text-[10px] uppercase font-bold text-teal-400 flex items-center gap-1">
                      <Award className="h-3 w-3" /> Clean Air Points
                    </span>
                    <div className="text-base font-black text-white mt-0.5">
                      {ecoPoints} <span className="text-xs text-zinc-400 font-normal">pts</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rewards Claim */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Redeemable Rewards</h4>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-zinc-200">₹100 Delhi Metro (DMRC) Card Credit</div>
                    <div className="text-[10px] text-zinc-400">Cost: 600 EcoPoints</div>
                  </div>
                  <button
                    onClick={() => handleClaimReward('dmrc', 600)}
                    disabled={claimedRewards.includes('dmrc') || ecoPoints < 600}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                  >
                    {claimedRewards.includes('dmrc') ? 'Claimed ✓' : 'Redeem'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-zinc-800/80 bg-zinc-950/60 p-3.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-zinc-400 font-medium text-[11px]">Google Maps Platform API Linked</span>
          </div>
          <span className="text-zinc-400 font-mono text-[11px]">Live GPS</span>
        </div>
      </aside>

      {/* MAIN CONTENT AREA: MAP INTERFACE */}
      <main className="relative flex-1 h-full overflow-hidden bg-zinc-950 flex flex-col">
        {/* Top Floating Control Bar Over the Map */}
        <header className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
          {/* Active Route Quick Indicator */}
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-zinc-800/90 bg-zinc-900/90 backdrop-blur-md px-4 py-2.5 shadow-2xl">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-xl font-bold text-xs ${
                selectedRoute === 'route-b'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              }`}
            >
              {selectedRoute === 'route-b' ? 'B' : 'A'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">
                  {selectedRoute === 'route-b'
                    ? 'GreenPath Safe Corridor Active'
                    : 'Standard Highway Hazard Selected'}
                </span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    selectedRoute === 'route-b' ? 'bg-emerald-400' : 'bg-rose-500 animate-ping'
                  }`}
                ></span>
              </div>
              <div className="text-[11px] text-zinc-400">
                {selectedRoute === 'route-b' && routes.routeB
                  ? `${routes.routeB.durationText} · AQI 110 (Moderate) · ${routes.routeB.co2SavedGrams}g CO₂ saved`
                  : routes.routeA
                  ? `${routes.routeA.durationText} · AQI 320 (Severe Hazardous)`
                  : 'Computing path...'}
              </div>
            </div>
          </div>

          {/* Map Layer Toggles & Mode Switcher */}
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-zinc-800/90 bg-zinc-900/90 backdrop-blur-md p-1.5 shadow-2xl">
            <button
              onClick={() =>
                setMapDisplayMode((prev) =>
                  prev === 'google-maps' ? 'schematic-map' : 'google-maps'
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-800/90 hover:bg-zinc-700/80 text-zinc-200 border border-zinc-700/80 transition-all"
            >
              <Compass className="h-3.5 w-3.5 text-cyan-400" />
              <span>{mapDisplayMode === 'google-maps' ? 'Google Maps View' : 'Schematic View'}</span>
            </button>

            <button
              onClick={() => setShowAqiHeatmap(!showAqiHeatmap)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                showAqiHeatmap
                  ? 'bg-zinc-800 text-emerald-400 border border-zinc-700/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>AQI Buffer</span>
            </button>

            <button
              onClick={() => setShowGreenCanopy(!showGreenCanopy)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                showGreenCanopy
                  ? 'bg-zinc-800 text-emerald-400 border border-zinc-700/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <TreePine className="h-3.5 w-3.5" />
              <span>Canopy Belts</span>
            </button>
          </div>
        </header>

        {/* MAP CONTAINER */}
        <div className="relative flex-1 w-full h-full">
          {mapDisplayMode === 'google-maps' ? (
            <MapErrorBoundary fallback={renderSchematicVectorMap()}>
              <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['places', 'geometry', 'marker']}>
                <Map
                  defaultCenter={{ lat: 28.69, lng: 77.2 }}
                  defaultZoom={12}
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                  mapId="DEMO_MAP_ID"
                  colorScheme={ColorScheme.DARK}
                  internalUsageAttributionIds={['gmp_git_agentskills_v1']}
                  className="w-full h-full"
                >
                  <MapRouteRenderer
                    origin={originPoint}
                    destination={destPoint}
                    routes={routes}
                    selectedRoute={selectedRoute}
                    onSelectRoute={(type) => setSelectedRoute(type)}
                    showHeatmap={showAqiHeatmap}
                    showCanopy={showGreenCanopy}
                    simulatingProgress={simulationProgress}
                    isSimulating={isSimulating}
                  />
                </Map>
              </APIProvider>
            </MapErrorBoundary>
          ) : (
            renderSchematicVectorMap()
          )}

          {/* DYNAMIC MAP OVERLAYS: HAZARD WARNING (ROUTE A) vs SAFE CORRIDOR (ROUTE B) */}
          <div className="absolute bottom-6 left-6 right-6 z-20 pointer-events-none">
            {selectedRoute === 'route-a' ? (
              /* CRITICAL: ROUTE A RED HAZARD WARNING OVERLAY */
              <div className="pointer-events-auto max-w-2xl mx-auto rounded-2xl border-2 border-rose-500 bg-rose-950/90 backdrop-blur-xl p-4 shadow-2xl shadow-rose-950/80 text-rose-100 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex-shrink-0 animate-bounce">
                    <ShieldAlert className="h-6 w-6 text-rose-400 stroke-[2.5]" />
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black tracking-tight text-white uppercase">
                          Severe AQI Hazard Warning
                        </span>
                        <span className="rounded bg-rose-500 px-2 py-0.5 text-[10px] font-black text-black uppercase tracking-wider">
                          AQI 320
                        </span>
                      </div>
                      <span className="text-xs font-mono text-rose-300">Google Routes Path A</span>
                    </div>

                    <p className="text-xs text-rose-200/90 leading-relaxed font-medium">
                      Route A traverses high diesel particulate corridors. High particulate concentration (PM2.5 &gt; 220 µg/m³). Inhalation equivalent to ~14 cigarettes.
                    </p>

                    <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-rose-300">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                          Mask Mandatory (N95)
                        </span>
                        <span className="flex items-center gap-1.5 text-rose-300 font-mono">
                          {routes.routeA?.durationText} · {routes.routeA?.distanceText}
                        </span>
                      </div>

                      <button
                        onClick={() => setSelectedRoute('route-b')}
                        className="pointer-events-auto flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all shadow-lg shadow-emerald-950/40"
                      >
                        <Leaf className="h-3.5 w-3.5" />
                        <span>Switch to Safe Route B</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* CRITICAL: ROUTE B GREEN SAFE-CORRIDOR VISUALIZATION OVERLAY */
              <div className="pointer-events-auto max-w-2xl mx-auto rounded-2xl border-2 border-emerald-500 bg-emerald-950/90 backdrop-blur-xl p-4 shadow-2xl shadow-emerald-950/80 text-emerald-100 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex-shrink-0">
                    <Leaf className="h-6 w-6 text-emerald-400 stroke-[2.5]" />
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black tracking-tight text-white uppercase">
                          Clean Air Corridor Active
                        </span>
                        <span className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-black uppercase tracking-wider">
                          AQI 110 · Moderate
                        </span>
                      </div>
                      <span className="text-xs font-mono text-emerald-300 font-bold">
                        {routes.routeB?.co2SavedGrams}g CO₂ Saved
                      </span>
                    </div>

                    <p className="text-xs text-emerald-200/90 leading-relaxed font-medium">
                      Commuter shielded along riverfront buffer vegetation and canopy corridors. Natural vegetation and bypass flow filter 65% of toxic PM2.5 particulates.
                    </p>

                    <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          65% Less Particulate Exposure
                        </span>
                        <span className="flex items-center gap-1.5 text-emerald-300 font-mono">
                          {routes.routeB?.durationText} · {routes.routeB?.distanceText}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-emerald-300 bg-emerald-900/50 px-2.5 py-1 rounded-lg border border-emerald-700/50 text-[11px] font-bold">
                        <Award className="h-3.5 w-3.5 text-emerald-400" />
                        <span>+42 EcoPoints Earned</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
