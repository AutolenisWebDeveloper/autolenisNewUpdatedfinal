// Lookup of common US ZIP codes / cities to lat/lon coordinates.
// Used for distance-based inventory search (Haversine formula server-side).
// No external API — all data baked in.

export interface LatLng { lat: number; lng: number }

// ~250 ZIP codes covering top US metros — keyed by 5-digit ZIP
export const ZIP_COORDS: Record<string, LatLng> = {
  // New York / NJ
  "10001": { lat: 40.7506, lng: -73.9971 }, "10002": { lat: 40.7156, lng: -73.9866 },
  "10011": { lat: 40.7414, lng: -74.0006 }, "10025": { lat: 40.7984, lng: -73.9682 },
  "11201": { lat: 40.6940, lng: -73.9903 }, "11215": { lat: 40.6634, lng: -73.9839 },
  "07030": { lat: 40.7445, lng: -74.0324 }, "07302": { lat: 40.7201, lng: -74.0467 },
  "07728": { lat: 40.2206, lng: -74.2755 },
  // Boston / MA
  "02108": { lat: 42.3580, lng: -71.0648 }, "02115": { lat: 42.3434, lng: -71.0908 },
  "02139": { lat: 42.3654, lng: -71.1037 }, "02199": { lat: 42.3479, lng: -71.0832 },
  // Philadelphia
  "19103": { lat: 39.9525, lng: -75.1740 }, "19104": { lat: 39.9588, lng: -75.1953 },
  "19146": { lat: 39.9430, lng: -75.1820 },
  // Washington DC
  "20001": { lat: 38.9099, lng: -77.0166 }, "20002": { lat: 38.9023, lng: -76.9853 },
  "20009": { lat: 38.9192, lng: -77.0364 }, "22202": { lat: 38.8584, lng: -77.0540 },
  "22301": { lat: 38.8278, lng: -77.0587 },
  // Atlanta / GA
  "30301": { lat: 33.7488, lng: -84.3878 }, "30303": { lat: 33.7544, lng: -84.3893 },
  "30309": { lat: 33.7948, lng: -84.3859 }, "30318": { lat: 33.7950, lng: -84.4239 },
  "30339": { lat: 33.8722, lng: -84.4663 }, "30342": { lat: 33.8742, lng: -84.3778 },
  "30605": { lat: 33.9479, lng: -83.3522 }, // Athens GA
  // Charlotte / NC
  "28202": { lat: 35.2271, lng: -80.8431 }, "28203": { lat: 35.2147, lng: -80.8517 },
  "28210": { lat: 35.1611, lng: -80.8587 }, "27601": { lat: 35.7796, lng: -78.6382 }, // Raleigh
  "27514": { lat: 35.9132, lng: -79.0558 }, // Chapel Hill
  // Nashville / TN
  "37201": { lat: 36.1659, lng: -86.7825 }, "37203": { lat: 36.1538, lng: -86.7872 },
  "37206": { lat: 36.1812, lng: -86.7456 }, "37919": { lat: 35.9311, lng: -83.9869 },
  // Memphis
  "38103": { lat: 35.1429, lng: -90.0482 }, "38120": { lat: 35.1207, lng: -89.8489 },
  // Florida
  "33101": { lat: 25.7743, lng: -80.1937 }, "33139": { lat: 25.7826, lng: -80.1340 },
  "33172": { lat: 25.7770, lng: -80.3624 }, // Miami area
  "32801": { lat: 28.5383, lng: -81.3792 }, "32789": { lat: 28.5995, lng: -81.3409 }, // Orlando
  "33602": { lat: 27.9506, lng: -82.4572 }, "33606": { lat: 27.9434, lng: -82.4734 }, // Tampa
  "32202": { lat: 30.3322, lng: -81.6557 }, // Jacksonville
  "33301": { lat: 26.1224, lng: -80.1373 }, // Fort Lauderdale
  // Texas
  "75024": { lat: 33.0795, lng: -96.8088 }, // Plano
  // Frisco — added for the buyer-location backfill
  // (docs/plans/BUYER-LOCATION-BACKFILL.md). Both ZIPs carry the Frisco
  // city centroid rather than a per-ZIP centroid: this table feeds a
  // 50-150 mile radius filter, the two ZIPs are ~5mi apart, and a
  // documented city-level approximation is preferable to a per-ZIP figure
  // that cannot be sourced. Set GOOGLE_GEOCODING_API_KEY to stop curating
  // this table by hand.
  "75034": { lat: 33.1507, lng: -96.8236 }, // Frisco
  "75035": { lat: 33.1507, lng: -96.8236 }, // Frisco
  "75201": { lat: 32.7831, lng: -96.8067 }, "75204": { lat: 32.8025, lng: -96.7856 },
  "75080": { lat: 32.9756, lng: -96.7325 }, // Richardson
  "76102": { lat: 32.7531, lng: -97.3284 }, // Fort Worth
  "77002": { lat: 29.7589, lng: -95.3677 }, "77005": { lat: 29.7174, lng: -95.4188 },
  "77024": { lat: 29.7721, lng: -95.5151 }, // Houston
  "78701": { lat: 30.2711, lng: -97.7437 }, "78704": { lat: 30.2421, lng: -97.7669 }, // Austin
  "78201": { lat: 29.4595, lng: -98.5288 }, "78205": { lat: 29.4253, lng: -98.4892 }, // San Antonio
  "79401": { lat: 33.5779, lng: -101.8552 }, // Lubbock
  "79901": { lat: 31.7619, lng: -106.4850 }, // El Paso
  // Oklahoma
  "73102": { lat: 35.4676, lng: -97.5164 }, // OKC
  "74103": { lat: 36.1540, lng: -95.9928 }, // Tulsa
  // Arkansas / Louisiana
  "72201": { lat: 34.7465, lng: -92.2896 }, // Little Rock
  "70112": { lat: 29.9569, lng: -90.0738 }, // New Orleans
  "70806": { lat: 30.4515, lng: -91.1871 }, // Baton Rouge
  // Mississippi / Alabama
  "39201": { lat: 32.2988, lng: -90.1848 }, // Jackson MS
  "35203": { lat: 33.5186, lng: -86.8104 }, // Birmingham
  "35801": { lat: 34.7304, lng: -86.5861 }, // Huntsville
  "36104": { lat: 32.3792, lng: -86.3077 }, // Montgomery
  // Midwest
  "60601": { lat: 41.8853, lng: -87.6216 }, "60611": { lat: 41.8920, lng: -87.6195 },
  "60614": { lat: 41.9214, lng: -87.6513 }, "60622": { lat: 41.9007, lng: -87.6776 },
  "60302": { lat: 41.8852, lng: -87.7848 }, // Oak Park
  "53202": { lat: 43.0389, lng: -87.9065 }, // Milwaukee
  "55401": { lat: 44.9842, lng: -93.2750 }, "55403": { lat: 44.9707, lng: -93.2739 }, // Minneapolis
  "55101": { lat: 44.9537, lng: -93.0900 }, // St Paul
  "50309": { lat: 41.5868, lng: -93.6250 }, // Des Moines
  "63101": { lat: 38.6270, lng: -90.1994 }, "63110": { lat: 38.6265, lng: -90.2495 }, // St Louis
  "64108": { lat: 39.0997, lng: -94.5786 }, // Kansas City
  "68102": { lat: 41.2585, lng: -95.9421 }, // Omaha
  "66101": { lat: 39.1142, lng: -94.6275 }, "66202": { lat: 39.0357, lng: -94.6469 }, // KC KS
  "68508": { lat: 40.8136, lng: -96.7026 }, // Lincoln
  // Ohio
  "44113": { lat: 41.4849, lng: -81.7088 }, "44114": { lat: 41.5081, lng: -81.6906 }, // Cleveland
  "43215": { lat: 39.9700, lng: -83.0021 }, "43210": { lat: 40.0040, lng: -83.0203 }, // Columbus
  "45202": { lat: 39.1078, lng: -84.5125 }, // Cincinnati
  "43604": { lat: 41.6539, lng: -83.5379 }, // Toledo
  // Michigan / Indiana
  "48226": { lat: 42.3294, lng: -83.0458 }, "48201": { lat: 42.3478, lng: -83.0594 }, // Detroit
  "48104": { lat: 42.2697, lng: -83.7331 }, // Ann Arbor
  "46204": { lat: 39.7684, lng: -86.1581 }, "46202": { lat: 39.7799, lng: -86.1568 }, // Indianapolis
  // Kentucky
  "40202": { lat: 38.2542, lng: -85.7594 }, // Louisville
  "40508": { lat: 38.0449, lng: -84.4977 }, // Lexington
  // West / Mountain
  "80202": { lat: 39.7497, lng: -104.9953 }, "80203": { lat: 39.7340, lng: -104.9842 }, // Denver
  "80301": { lat: 40.0274, lng: -105.2519 }, // Boulder
  "80906": { lat: 38.7949, lng: -104.8270 }, // Colorado Springs
  "84101": { lat: 40.7589, lng: -111.8883 }, "84111": { lat: 40.7628, lng: -111.8795 }, // SLC
  "85003": { lat: 33.4509, lng: -112.0780 }, "85004": { lat: 33.4515, lng: -112.0683 }, // Phoenix
  "85281": { lat: 33.4255, lng: -111.9400 }, // Tempe
  "85701": { lat: 32.2226, lng: -110.9747 }, // Tucson
  "87102": { lat: 35.0844, lng: -106.6504 }, // Albuquerque
  "89101": { lat: 36.1716, lng: -115.1391 }, "89109": { lat: 36.1147, lng: -115.1728 }, // Vegas
  "89701": { lat: 39.1638, lng: -119.7674 }, // Carson City
  "59601": { lat: 46.5891, lng: -112.0391 }, // Helena
  "82001": { lat: 41.1399, lng: -104.8202 }, // Cheyenne
  "83702": { lat: 43.6150, lng: -116.2023 }, // Boise
  // West Coast
  "98101": { lat: 47.6101, lng: -122.3344 }, "98109": { lat: 47.6256, lng: -122.3471 }, // Seattle
  "98004": { lat: 47.6202, lng: -122.2009 }, // Bellevue
  "98660": { lat: 45.6283, lng: -122.6749 }, // Vancouver WA
  "97201": { lat: 45.5152, lng: -122.6784 }, "97214": { lat: 45.5152, lng: -122.6390 }, // Portland
  "94102": { lat: 37.7793, lng: -122.4192 }, "94103": { lat: 37.7726, lng: -122.4099 },
  "94110": { lat: 37.7488, lng: -122.4144 }, "94133": { lat: 37.8004, lng: -122.4114 }, // SF
  "94501": { lat: 37.7652, lng: -122.2416 }, // Alameda
  "95014": { lat: 37.3230, lng: -122.0322 }, // Cupertino
  "94301": { lat: 37.4419, lng: -122.1430 }, // Palo Alto
  "94025": { lat: 37.4530, lng: -122.1817 }, // Menlo Park
  "95113": { lat: 37.3382, lng: -121.8863 }, // San Jose
  "94704": { lat: 37.8716, lng: -122.2727 }, // Berkeley
  "90001": { lat: 33.9731, lng: -118.2479 }, "90017": { lat: 34.0510, lng: -118.2655 },
  "90024": { lat: 34.0648, lng: -118.4429 }, "90048": { lat: 34.0760, lng: -118.3717 },
  "90210": { lat: 34.1030, lng: -118.4105 }, "90291": { lat: 33.9928, lng: -118.4659 }, // LA
  "92101": { lat: 32.7157, lng: -117.1611 }, "92103": { lat: 32.7470, lng: -117.1589 }, // San Diego
  "92614": { lat: 33.6859, lng: -117.7947 }, // Irvine
  "92660": { lat: 33.6189, lng: -117.8742 }, // Newport Beach
  "92806": { lat: 33.8301, lng: -117.8721 }, // Anaheim
  "93101": { lat: 34.4144, lng: -119.6929 }, // Santa Barbara
  "93720": { lat: 36.8504, lng: -119.7726 }, // Fresno
  "95814": { lat: 38.5816, lng: -121.4944 }, "95825": { lat: 38.5915, lng: -121.4035 }, // Sacramento
  "96813": { lat: 21.3099, lng: -157.8581 }, // Honolulu
  "99501": { lat: 61.2181, lng: -149.9003 }, // Anchorage
  // Carolinas / Virginia / WV
  "29401": { lat: 32.7765, lng: -79.9311 }, // Charleston SC
  "29201": { lat: 34.0007, lng: -81.0348 }, // Columbia SC
  "29403": { lat: 32.8083, lng: -79.9520 },
  "29615": { lat: 34.8526, lng: -82.3940 }, // Greenville SC
  "23219": { lat: 37.5407, lng: -77.4360 }, "23220": { lat: 37.5602, lng: -77.4504 }, // Richmond
  "23510": { lat: 36.8508, lng: -76.2859 }, // Norfolk
  "22102": { lat: 38.9290, lng: -77.2241 }, "22030": { lat: 38.8462, lng: -77.3064 }, // McLean / Fairfax
  "25301": { lat: 38.3498, lng: -81.6326 }, // Charleston WV
  // Pittsburgh
  "15222": { lat: 40.4495, lng: -79.9889 }, "15213": { lat: 40.4441, lng: -79.9608 },
  // Maryland / Delaware
  "21201": { lat: 39.2904, lng: -76.6122 }, "21202": { lat: 39.2999, lng: -76.6118 }, // Baltimore
  "21401": { lat: 38.9784, lng: -76.4922 }, // Annapolis
  "19801": { lat: 39.7391, lng: -75.5398 }, // Wilmington DE
  // New England
  "06103": { lat: 41.7637, lng: -72.6851 }, // Hartford
  "06510": { lat: 41.3083, lng: -72.9279 }, // New Haven
  "02903": { lat: 41.8240, lng: -71.4128 }, // Providence
  "03101": { lat: 42.9956, lng: -71.4548 }, // Manchester NH
  "04101": { lat: 43.6591, lng: -70.2568 }, // Portland ME
  "05401": { lat: 44.4759, lng: -73.2121 }, // Burlington VT
};

// Major US cities → centroid lat/lon (used as fallback when ZIP unknown)
export const CITY_COORDS: Record<string, LatLng> = {
  "atlanta,ga": { lat: 33.7490, lng: -84.3880 },
  "augusta,ga": { lat: 33.4735, lng: -82.0105 },
  "savannah,ga": { lat: 32.0809, lng: -81.0912 },
  "macon,ga": { lat: 32.8407, lng: -83.6324 },
  "dallas,tx": { lat: 32.7767, lng: -96.7970 },
  "houston,tx": { lat: 29.7604, lng: -95.3698 },
  "austin,tx": { lat: 30.2672, lng: -97.7431 },
  "san antonio,tx": { lat: 29.4241, lng: -98.4936 },
  "fort worth,tx": { lat: 32.7555, lng: -97.3308 },
  "el paso,tx": { lat: 31.7619, lng: -106.4850 },
  "plano,tx": { lat: 33.0198, lng: -96.6989 },
  "frisco,tx": { lat: 33.1507, lng: -96.8236 },
  "miami,fl": { lat: 25.7617, lng: -80.1918 },
  "orlando,fl": { lat: 28.5383, lng: -81.3792 },
  "tampa,fl": { lat: 27.9506, lng: -82.4572 },
  "jacksonville,fl": { lat: 30.3322, lng: -81.6557 },
  "tallahassee,fl": { lat: 30.4383, lng: -84.2807 },
  "fort lauderdale,fl": { lat: 26.1224, lng: -80.1373 },
  "new york,ny": { lat: 40.7128, lng: -74.0060 },
  "buffalo,ny": { lat: 42.8864, lng: -78.8784 },
  "rochester,ny": { lat: 43.1566, lng: -77.6088 },
  "albany,ny": { lat: 42.6526, lng: -73.7562 },
  "los angeles,ca": { lat: 34.0522, lng: -118.2437 },
  "san francisco,ca": { lat: 37.7749, lng: -122.4194 },
  "san diego,ca": { lat: 32.7157, lng: -117.1611 },
  "san jose,ca": { lat: 37.3382, lng: -121.8863 },
  "sacramento,ca": { lat: 38.5816, lng: -121.4944 },
  "fresno,ca": { lat: 36.7378, lng: -119.7871 },
  "long beach,ca": { lat: 33.7701, lng: -118.1937 },
  "anaheim,ca": { lat: 33.8366, lng: -117.9143 },
  "oakland,ca": { lat: 37.8044, lng: -122.2712 },
  "chicago,il": { lat: 41.8781, lng: -87.6298 },
  "springfield,il": { lat: 39.7817, lng: -89.6501 },
  "phoenix,az": { lat: 33.4484, lng: -112.0740 },
  "tucson,az": { lat: 32.2226, lng: -110.9747 },
  "philadelphia,pa": { lat: 39.9526, lng: -75.1652 },
  "pittsburgh,pa": { lat: 40.4406, lng: -79.9959 },
  "harrisburg,pa": { lat: 40.2732, lng: -76.8867 },
  "boston,ma": { lat: 42.3601, lng: -71.0589 },
  "worcester,ma": { lat: 42.2626, lng: -71.8023 },
  "seattle,wa": { lat: 47.6062, lng: -122.3321 },
  "spokane,wa": { lat: 47.6588, lng: -117.4260 },
  "denver,co": { lat: 39.7392, lng: -104.9903 },
  "colorado springs,co": { lat: 38.8339, lng: -104.8214 },
  "boulder,co": { lat: 40.0150, lng: -105.2705 },
  "washington,dc": { lat: 38.9072, lng: -77.0369 },
  "nashville,tn": { lat: 36.1627, lng: -86.7816 },
  "memphis,tn": { lat: 35.1495, lng: -90.0490 },
  "knoxville,tn": { lat: 35.9606, lng: -83.9207 },
  "chattanooga,tn": { lat: 35.0456, lng: -85.3097 },
  "detroit,mi": { lat: 42.3314, lng: -83.0458 },
  "ann arbor,mi": { lat: 42.2808, lng: -83.7430 },
  "grand rapids,mi": { lat: 42.9634, lng: -85.6681 },
  "minneapolis,mn": { lat: 44.9778, lng: -93.2650 },
  "saint paul,mn": { lat: 44.9537, lng: -93.0900 },
  "st paul,mn": { lat: 44.9537, lng: -93.0900 },
  "saint louis,mo": { lat: 38.6270, lng: -90.1994 },
  "st louis,mo": { lat: 38.6270, lng: -90.1994 },
  "kansas city,mo": { lat: 39.0997, lng: -94.5786 },
  "kansas city,ks": { lat: 39.1142, lng: -94.6275 },
  "indianapolis,in": { lat: 39.7684, lng: -86.1581 },
  "columbus,oh": { lat: 39.9612, lng: -82.9988 },
  "cleveland,oh": { lat: 41.4993, lng: -81.6944 },
  "cincinnati,oh": { lat: 39.1031, lng: -84.5120 },
  "louisville,ky": { lat: 38.2527, lng: -85.7585 },
  "lexington,ky": { lat: 38.0406, lng: -84.5037 },
  "milwaukee,wi": { lat: 43.0389, lng: -87.9065 },
  "madison,wi": { lat: 43.0731, lng: -89.4012 },
  "charlotte,nc": { lat: 35.2271, lng: -80.8431 },
  "raleigh,nc": { lat: 35.7796, lng: -78.6382 },
  "durham,nc": { lat: 35.9940, lng: -78.8986 },
  "greensboro,nc": { lat: 36.0726, lng: -79.7920 },
  "charleston,sc": { lat: 32.7765, lng: -79.9311 },
  "columbia,sc": { lat: 34.0007, lng: -81.0348 },
  "greenville,sc": { lat: 34.8526, lng: -82.3940 },
  "birmingham,al": { lat: 33.5186, lng: -86.8104 },
  "huntsville,al": { lat: 34.7304, lng: -86.5861 },
  "montgomery,al": { lat: 32.3792, lng: -86.3077 },
  "mobile,al": { lat: 30.6954, lng: -88.0399 },
  "jackson,ms": { lat: 32.2988, lng: -90.1848 },
  "new orleans,la": { lat: 29.9511, lng: -90.0715 },
  "baton rouge,la": { lat: 30.4515, lng: -91.1871 },
  "shreveport,la": { lat: 32.5252, lng: -93.7502 },
  "little rock,ar": { lat: 34.7465, lng: -92.2896 },
  "oklahoma city,ok": { lat: 35.4676, lng: -97.5164 },
  "tulsa,ok": { lat: 36.1540, lng: -95.9928 },
  "salt lake city,ut": { lat: 40.7608, lng: -111.8910 },
  "las vegas,nv": { lat: 36.1699, lng: -115.1398 },
  "reno,nv": { lat: 39.5296, lng: -119.8138 },
  "albuquerque,nm": { lat: 35.0844, lng: -106.6504 },
  "santa fe,nm": { lat: 35.6870, lng: -105.9378 },
  "portland,or": { lat: 45.5152, lng: -122.6784 },
  "eugene,or": { lat: 44.0521, lng: -123.0868 },
  "boise,id": { lat: 43.6150, lng: -116.2023 },
  "anchorage,ak": { lat: 61.2181, lng: -149.9003 },
  "honolulu,hi": { lat: 21.3099, lng: -157.8581 },
  "richmond,va": { lat: 37.5407, lng: -77.4360 },
  "virginia beach,va": { lat: 36.8529, lng: -75.9780 },
  "norfolk,va": { lat: 36.8508, lng: -76.2859 },
  "fairfax,va": { lat: 38.8462, lng: -77.3064 },
  "arlington,va": { lat: 38.8816, lng: -77.0910 },
  "baltimore,md": { lat: 39.2904, lng: -76.6122 },
  "annapolis,md": { lat: 38.9784, lng: -76.4922 },
  "wilmington,de": { lat: 39.7391, lng: -75.5398 },
  "newark,nj": { lat: 40.7357, lng: -74.1724 },
  "jersey city,nj": { lat: 40.7178, lng: -74.0431 },
  "trenton,nj": { lat: 40.2206, lng: -74.7597 },
  "providence,ri": { lat: 41.8240, lng: -71.4128 },
  "hartford,ct": { lat: 41.7637, lng: -72.6851 },
  "new haven,ct": { lat: 41.3083, lng: -72.9279 },
  "bridgeport,ct": { lat: 41.1865, lng: -73.1952 },
  "manchester,nh": { lat: 42.9956, lng: -71.4548 },
  "concord,nh": { lat: 43.2081, lng: -71.5376 },
  "portland,me": { lat: 43.6591, lng: -70.2568 },
  "burlington,vt": { lat: 44.4759, lng: -73.2121 },
  "des moines,ia": { lat: 41.5868, lng: -93.6250 },
  "omaha,ne": { lat: 41.2565, lng: -95.9345 },
  "lincoln,ne": { lat: 40.8136, lng: -96.7026 },
  "fargo,nd": { lat: 46.8772, lng: -96.7898 },
  "bismarck,nd": { lat: 46.8083, lng: -100.7837 },
  "sioux falls,sd": { lat: 43.5446, lng: -96.7311 },
  "billings,mt": { lat: 45.7833, lng: -108.5007 },
  "helena,mt": { lat: 46.5891, lng: -112.0391 },
  "cheyenne,wy": { lat: 41.1399, lng: -104.8202 },
  "charleston,wv": { lat: 38.3498, lng: -81.6326 },
  "tacoma,wa": { lat: 47.2529, lng: -122.4443 },
  "bellevue,wa": { lat: 47.6101, lng: -122.2015 },
  "vancouver,wa": { lat: 45.6387, lng: -122.6615 },
};

export function lookupZip(zip: string): LatLng | null {
  const clean = (zip || "").trim().slice(0, 5);
  return ZIP_COORDS[clean] ?? null;
}

export function lookupCity(city: string | null | undefined, state: string | null | undefined): LatLng | null {
  if (!city || !state) return null;
  const key = `${city.trim().toLowerCase()},${state.trim().toLowerCase()}`;
  return CITY_COORDS[key] ?? null;
}

// Haversine — distance between two lat/lng points in miles
export function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8; // Earth radius miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Bounding box — quick filter before exact Haversine
export function boundingBox(center: LatLng, radiusMiles: number) {
  const latDelta = radiusMiles / 69; // ~69 miles per degree latitude
  const lngDelta = radiusMiles / (Math.cos((center.lat * Math.PI) / 180) * 69);
  return {
    minLat: center.lat - latDelta, maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta, maxLng: center.lng + lngDelta,
  };
}
