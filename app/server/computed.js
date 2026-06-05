// Registered computed functions — callable from the rules DSL.
// Pure functions. No eval, no dynamic loading. Add new ones here.
// FO §3.6.4: Reistijd berekening met volledige postcode-dekking.

// ============ POSTCODE CENTROIDS ============
// Approximate lat/lon centroids for Dutch 2-digit postcode zones.
// Used for Haversine distance calculation.

const POSTCODE_CENTROIDS = {
  '10': { lat: 52.3676, lon: 4.9041, city: 'Amsterdam' },
  '11': { lat: 52.3833, lon: 4.6500, city: 'Haarlem' },
  '12': { lat: 52.5168, lon: 4.6700, city: 'Beverwijk' },
  '13': { lat: 52.6324, lon: 4.7534, city: 'Den Helder' },
  '14': { lat: 52.7025, lon: 5.0597, city: 'Hoorn' },
  '15': { lat: 52.5125, lon: 5.4714, city: 'Enkhuizen' },
  '16': { lat: 52.2689, lon: 4.5386, city: 'Lisse' },
  '17': { lat: 52.1601, lon: 4.4970, city: 'Leiden' },
  '18': { lat: 52.0799, lon: 4.3113, city: 'Den Haag' },
  '19': { lat: 52.0116, lon: 4.3571, city: 'Delft' },
  '20': { lat: 51.9225, lon: 4.4792, city: 'Rotterdam' },
  '21': { lat: 51.8860, lon: 4.4989, city: 'Rotterdam-Zuid' },
  '22': { lat: 51.9244, lon: 4.4777, city: 'Schiedam' },
  '23': { lat: 51.8417, lon: 4.3278, city: 'Spijkenisse' },
  '24': { lat: 51.7987, lon: 4.6697, city: 'Dordrecht' },
  '25': { lat: 52.0705, lon: 4.3007, city: 'Den Haag-Zuid' },
  '26': { lat: 52.0167, lon: 4.7000, city: 'Gouda' },
  '27': { lat: 51.8125, lon: 4.6903, city: 'Gorinchem' },
  '28': { lat: 52.1561, lon: 4.4931, city: 'Zoetermeer' },
  '29': { lat: 51.9700, lon: 4.1250, city: 'Hoek van Holland' },
  '30': { lat: 51.9851, lon: 4.4997, city: 'Rotterdam-Centrum' },
  '31': { lat: 51.9775, lon: 4.1300, city: 'Westland' },
  '32': { lat: 52.0907, lon: 5.1214, city: 'Utrecht' },
  '33': { lat: 52.2215, lon: 5.1800, city: 'Amersfoort-Oost' },
  '34': { lat: 52.1561, lon: 5.3878, city: 'Amersfoort' },
  '35': { lat: 52.0907, lon: 5.1214, city: 'Utrecht' },
  '36': { lat: 52.1551, lon: 5.3872, city: 'Amersfoort' },
  '37': { lat: 52.2167, lon: 5.9667, city: 'Harderwijk' },
  '38': { lat: 52.3500, lon: 5.9833, city: 'Zwolle' },
  '39': { lat: 52.1417, lon: 5.8333, city: 'Apeldoorn' },
  '40': { lat: 51.4416, lon: 5.4697, city: 'Eindhoven' },
  '41': { lat: 51.6978, lon: 5.3037, city: 's-Hertogenbosch' },
  '42': { lat: 51.5833, lon: 4.7833, city: 'Breda' },
  '43': { lat: 51.5500, lon: 5.0833, city: 'Tilburg' },
  '44': { lat: 51.4408, lon: 5.4778, city: 'Eindhoven-Zuid' },
  '45': { lat: 51.4500, lon: 5.6667, city: 'Helmond' },
  '46': { lat: 51.3667, lon: 6.1667, city: 'Venlo' },
  '47': { lat: 51.4333, lon: 4.9333, city: 'Roosendaal' },
  '48': { lat: 51.5000, lon: 3.6167, city: 'Vlissingen' },
  '49': { lat: 51.5000, lon: 4.0000, city: 'Terneuzen' },
  '50': { lat: 51.2500, lon: 5.7000, city: 'Weert' },
  '51': { lat: 50.8514, lon: 5.6910, city: 'Maastricht' },
  '52': { lat: 52.5167, lon: 6.0833, city: 'Zwolle-Zuid' },
  '53': { lat: 52.7000, lon: 6.1833, city: 'Hoogeveen' },
  '54': { lat: 53.2194, lon: 6.5667, city: 'Groningen' },
  '55': { lat: 52.9917, lon: 6.5583, city: 'Assen' },
  '56': { lat: 51.4416, lon: 5.4697, city: 'Eindhoven' },
  '57': { lat: 51.4333, lon: 5.5000, city: 'Geldrop' },
  '58': { lat: 52.2500, lon: 6.1500, city: 'Deventer' },
  '59': { lat: 52.4333, lon: 6.7667, city: 'Almelo' },
  '60': { lat: 51.9500, lon: 5.9000, city: 'Arnhem' },
  '61': { lat: 51.8428, lon: 5.8528, city: 'Nijmegen' },
  '62': { lat: 51.9667, lon: 5.9167, city: 'Arnhem-Zuid' },
  '63': { lat: 51.9667, lon: 6.2833, city: 'Doetinchem' },
  '64': { lat: 51.8833, lon: 5.8833, city: 'Nijmegen-Zuid' },
  '65': { lat: 51.8500, lon: 5.8667, city: 'Wijchen' },
  '66': { lat: 51.9167, lon: 6.5667, city: 'Winterswijk' },
  '67': { lat: 52.0333, lon: 6.1000, city: 'Velp' },
  '68': { lat: 52.1167, lon: 6.1333, city: 'Dieren' },
  '69': { lat: 52.0000, lon: 5.9500, city: 'Arnhem-West' },
  '70': { lat: 52.2500, lon: 6.7500, city: 'Enschede' },
  '71': { lat: 52.5000, lon: 6.4333, city: 'Emmen' },
  '72': { lat: 52.5167, lon: 4.6500, city: 'Alkmaar' },
  '73': { lat: 51.3500, lon: 6.0000, city: 'Venray' },
  '74': { lat: 52.3167, lon: 6.6667, city: 'Hengelo' },
  '75': { lat: 52.6000, lon: 6.0833, city: 'Meppel' },
  '76': { lat: 52.7667, lon: 6.1000, city: 'Steenwijk' },
  '77': { lat: 52.4500, lon: 6.1167, city: 'Raalte' },
  '78': { lat: 52.5167, lon: 5.4667, city: 'Kampen' },
  '79': { lat: 52.5833, lon: 4.7500, city: 'Schagen' },
  '80': { lat: 52.5500, lon: 5.5333, city: 'Lelystad' },
  '81': { lat: 52.2333, lon: 5.1833, city: 'Hilversum' },
  '82': { lat: 52.3000, lon: 4.9500, city: 'Amstelveen' },
  '83': { lat: 52.5000, lon: 5.0667, city: 'Purmerend' },
  '84': { lat: 52.7833, lon: 4.8500, city: 'Heerhugowaard' },
  '85': { lat: 53.2000, lon: 5.8000, city: 'Leeuwarden' },
  '86': { lat: 53.0000, lon: 5.6500, city: 'Sneek' },
  '87': { lat: 53.1000, lon: 5.6500, city: 'Franeker' },
  '88': { lat: 53.2500, lon: 5.9167, city: 'Leeuwarden-Oost' },
  '89': { lat: 53.3333, lon: 6.2500, city: 'Dokkum' },
  '90': { lat: 53.2000, lon: 6.5500, city: 'Groningen' },
  '91': { lat: 53.2500, lon: 6.8667, city: 'Delfzijl' },
  '92': { lat: 53.1667, lon: 6.7500, city: 'Hoogezand' },
  '93': { lat: 53.0000, lon: 6.7500, city: 'Veendam' },
  '94': { lat: 53.1000, lon: 7.0333, city: 'Winschoten' },
  '95': { lat: 52.9500, lon: 6.9333, city: 'Stadskanaal' },
  '96': { lat: 52.9000, lon: 6.5833, city: 'Emmen-Noord' },
  '97': { lat: 52.7500, lon: 6.9000, city: 'Coevorden' },
  '98': { lat: 52.8500, lon: 6.5000, city: 'Hoogeveen-Zuid' },
  '99': { lat: 52.5833, lon: 6.6167, city: 'Hardenberg' }
};

// ============ HAVERSINE DISTANCE ============

/**
 * Calculate distance in km between two lat/lon points using Haversine formula
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Extract 2-digit postcode zone from full postcode
 */
function pcZone(pc) {
  if (!pc) return null;
  return String(pc).replace(/\s/g, '').slice(0, 2);
}

/**
 * Calculate estimated travel time in minutes between two postcodes
 * Uses Haversine distance with road factor approximation
 */
function calculateTravelTime(fromPC, toPC) {
  const zone1 = pcZone(fromPC);
  const zone2 = pcZone(toPC);

  if (!zone1 || !zone2) return null;

  const c1 = POSTCODE_CENTROIDS[zone1];
  const c2 = POSTCODE_CENTROIDS[zone2];

  if (!c1 || !c2) {
    // Unknown zone, return conservative estimate
    return 75;
  }

  // Same zone = short trip
  if (zone1 === zone2) {
    return 10;
  }

  // Calculate straight-line distance
  const directKm = haversineKm(c1.lat, c1.lon, c2.lat, c2.lon);

  // Apply road factor (roads are not straight)
  // Netherlands average: ~1.3x straight-line distance
  const roadKm = directKm * 1.3;

  // Average speed in Netherlands: ~50 km/h urban/suburban, ~80 km/h highway
  // Use weighted average based on distance
  let avgSpeedKmh;
  if (roadKm < 20) {
    avgSpeedKmh = 35; // Mostly urban
  } else if (roadKm < 50) {
    avgSpeedKmh = 50; // Mixed
  } else if (roadKm < 100) {
    avgSpeedKmh = 65; // More highway
  } else {
    avgSpeedKmh = 75; // Mostly highway
  }

  const minutes = Math.round((roadKm / avgSpeedKmh) * 60);

  // Cap at reasonable values
  return Math.max(5, Math.min(180, minutes));
}

// ============ COMPUTED FUNCTIONS ============

/**
 * Reistijd in minuten tussen client.postcode en label.location.postcode.
 * FO §3.6.4: Scoring bij <30 min = +3, 30-60 min = -1, >60 min = -5
 * Returnt null als locatie online is of postcodes onbekend.
 */
function travel_time_minutes(args, ctx) {
  const loc = ctx.label?.__location;
  if (loc?.is_online) return null;

  const from = ctx.client?.postcode;
  const to = loc?.postcode;

  if (!from || !to) return null;

  return calculateTravelTime(from, to);
}

/**
 * Percentage van plafond benut bij de actieve verzekeraar voor dit label.
 * Returnt null als geen contract / geen plafond / geen verzekeraar.
 */
function plafond_pct_benut(args, ctx) {
  const insurer = ctx.client?.insurer_name;
  if (!insurer) return null;
  const contracts = ctx.label?.__contracts || [];
  const c = contracts.find(c => c.insurer_name?.toLowerCase() === insurer?.toLowerCase());
  if (!c || !c.has_contract || c.plafond_max == null) return null;
  return c.plafond_used / c.plafond_max; // 0.0 - 1.0+
}

/**
 * Huidige bezetting van de locatie (0.0 - 1.0).
 */
function bezetting_pct(args, ctx) {
  const loc = ctx.label?.__location;
  if (!loc) return null;
  return (loc.current_load_pct || 0) / 100;
}

/**
 * Client age validation check
 */
function client_age(args, ctx) {
  return ctx.client?.leeftijd || ctx.client?.age || 0;
}

/**
 * Check if client postcode is within travel range of location
 */
function is_within_range(args, ctx) {
  const maxMinutes = args.max_minutes || 60;
  const time = travel_time_minutes({}, ctx);
  if (time === null) return true; // Online or unknown = within range
  return time <= maxMinutes;
}

// ============ EXPORTS ============

export const COMPUTED_FUNCTIONS = {
  travel_time_minutes,
  plafond_pct_benut,
  bezetting_pct,
  client_age,
  is_within_range
};

export function isKnownComputed(name) {
  return Object.prototype.hasOwnProperty.call(COMPUTED_FUNCTIONS, name);
}

// Export helper for testing
export { calculateTravelTime, haversineKm, POSTCODE_CENTROIDS };
