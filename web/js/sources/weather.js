/* Weather via Open-Meteo. No API key, CORS-friendly, free for personal use. */
import { getJSON, FetchError, formatTime } from '../core/net.js';
import { el, list } from '../core/ui.js';
import { getSettings } from '../core/store.js';

const WMO = {
  0:  ['Clear', '☀️', '🌙'],
  1:  ['Mostly clear', '🌤️', '🌙'],
  2:  ['Partly cloudy', '⛅', '☁️'],
  3:  ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Rime fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],
  73: ['Snow', '❄️', '❄️'],
  75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Showers', '🌦️', '🌧️'],
  81: ['Showers', '🌧️', '🌧️'],
  82: ['Violent showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Snow showers', '❄️', '❄️'],
  95: ['Thunderstorm', '⛈️', '⛈️'],
  96: ['Storm with hail', '⛈️', '⛈️'],
  99: ['Storm with hail', '⛈️', '⛈️']
};

export function describe(code, isDay = true) {
  const entry = WMO[code] || ['Unknown', '❓', '❓'];
  return { label: entry[0], icon: isDay ? entry[1] : entry[2] };
}

export async function geocode(query) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(query);
  const data = await getJSON(url);
  const hit = data && data.results && data.results[0];
  if (!hit) throw new FetchError(`Could not find a place called "${query}"`);
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    label: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ')
  };
}

function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new FetchError('This device has no location support'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Current location' }),
      err => reject(new FetchError(
        err.code === 1 ? 'Location permission denied — set a place name in card settings instead'
                       : 'Could not get device location'
      )),
      { timeout: 12000, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false }
    );
  });
}

async function resolvePlace(settings) {
  if (settings.useDeviceLocation) {
    try { return await deviceLocation(); }
    catch (e) { if (!settings.place) throw e; }
  }
  if (settings.place) return geocode(settings.place);
  return deviceLocation();
}

export default {
  type: 'weather',
  name: 'Weather',
  emoji: '🌤️',
  blurb: 'Current conditions, hourly and 7-day, from Open-Meteo',
  defaultSpan: 2,
  fields: [
    { key: 'place', label: 'Place', placeholder: 'e.g. Austin, TX', help: 'Leave blank to use your device location.' },
    { key: 'useDeviceLocation', type: 'boolean', label: 'Prefer device location', help: 'Falls back to the place above if permission is denied.', default: false },
    { key: 'view', type: 'select', label: 'Show', default: 'full', options: [
      { value: 'full', label: 'Now + hourly + 7-day' },
      { value: 'now', label: 'Current conditions only' },
      { value: 'hourly', label: 'Now + next 12 hours' },
      { value: 'daily', label: 'Now + 7-day forecast' }
    ] }
  ],
  defaultTitle: s => s.place ? `Weather · ${s.place}` : 'Weather',

  async load({ settings }) {
    const place = await resolvePlace(settings);
    const imperial = getSettings().units === 'imperial';
    const params = new URLSearchParams({
      latitude: place.lat,
      longitude: place.lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '7',
      temperature_unit: imperial ? 'fahrenheit' : 'celsius',
      wind_speed_unit: imperial ? 'mph' : 'kmh',
      precipitation_unit: imperial ? 'inch' : 'mm'
    });
    const data = await getJSON('https://api.open-meteo.com/v1/forecast?' + params.toString());
    if (!data || !data.current) throw new FetchError('Weather service returned no data');

    const nowIso = data.current.time;
    const hourly = [];
    if (data.hourly && Array.isArray(data.hourly.time)) {
      let start = data.hourly.time.findIndex(t => t >= nowIso);
      if (start < 0) start = 0;
      for (let i = start; i < Math.min(start + 12, data.hourly.time.length); i++) {
        hourly.push({
          time: data.hourly.time[i],
          temp: data.hourly.temperature_2m[i],
          pop: data.hourly.precipitation_probability ? data.hourly.precipitation_probability[i] : null,
          code: data.hourly.weather_code[i]
        });
      }
    }

    const daily = [];
    if (data.daily && Array.isArray(data.daily.time)) {
      for (let i = 0; i < data.daily.time.length; i++) {
        daily.push({
          date: data.daily.time[i],
          code: data.daily.weather_code[i],
          hi: data.daily.temperature_2m_max[i],
          lo: data.daily.temperature_2m_min[i],
          pop: data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[i] : null,
          sunrise: data.daily.sunrise ? data.daily.sunrise[i] : null,
          sunset: data.daily.sunset ? data.daily.sunset[i] : null
        });
      }
    }

    return {
      place: place.label,
      lat: place.lat,
      lon: place.lon,
      unitKey: imperial ? 'fahrenheit' : 'celsius',
      units: {
        temp: data.current_units ? data.current_units.temperature_2m : (imperial ? '°F' : '°C'),
        wind: data.current_units ? data.current_units.wind_speed_10m : (imperial ? 'mph' : 'km/h')
      },
      current: {
        temp: data.current.temperature_2m,
        feels: data.current.apparent_temperature,
        humidity: data.current.relative_humidity_2m,
        wind: data.current.wind_speed_10m,
        code: data.current.weather_code,
        isDay: data.current.is_day === 1
      },
      hourly,
      daily
    };
  },

  render(p, { settings }) {
    const view = settings.view || 'full';
    const cond = describe(p.current.code, p.current.isDay);
    const today = p.daily[0];
    const wrap = el('div', { class: 'stack' });

    wrap.append(el('div', { class: 'row between' }, [
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'big-num mono' }, [
          Math.round(p.current.temp),
          el('span', { class: 'unit', text: p.units.temp })
        ]),
        el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:4px', text: cond.label }),
        el('div', { class: 'faint', style: 'font-size:12px;margin-top:2px', text: p.place })
      ]),
      el('div', { style: 'font-size:46px;line-height:1;flex:none', text: cond.icon })
    ]));

    const bits = [`Feels ${Math.round(p.current.feels)}${p.units.temp}`];
    if (today) bits.push(`H ${Math.round(today.hi)}° · L ${Math.round(today.lo)}°`);
    bits.push(`${Math.round(p.current.wind)} ${p.units.wind}`);
    bits.push(`${p.current.humidity}% hum`);
    wrap.append(el('div', { class: 'faint', style: 'font-size:12.5px', text: bits.join('  ·  ') }));

    if ((view === 'full' || view === 'hourly') && p.hourly.length) {
      const strip = el('div', { class: 'scroll-x', style: 'margin-top:2px' });
      for (const h of p.hourly) {
        const hc = describe(h.code, true);
        strip.append(el('div', { class: 'hour' }, [
          el('div', { text: formatTime(h.time, { minute: undefined }) }),
          el('div', { style: 'font-size:17px;margin-top:3px', text: hc.icon }),
          el('div', { class: 't mono', text: Math.round(h.temp) + '°' }),
          h.pop != null && h.pop >= 10
            ? el('div', { style: 'font-size:10.5px;color:var(--accent)', text: h.pop + '%' })
            : null
        ]));
      }
      wrap.append(strip);
    }

    if ((view === 'full' || view === 'daily') && p.daily.length > 1) {
      wrap.append(list(p.daily.slice(0, 7), d => {
        const dc = describe(d.code, true);
        const day = new Date(d.date + 'T12:00:00');
        const isToday = new Date().toDateString() === day.toDateString();
        return el('div', { class: 'row between' }, [
          el('span', { style: 'width:42px;flex:none;font-size:13.5px', text: isToday ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short' }) }),
          el('span', { style: 'font-size:16px;flex:none', text: dc.icon }),
          el('span', { class: 'faint mono', style: 'font-size:11.5px;width:34px;text-align:right;flex:none', text: d.pop != null && d.pop >= 10 ? d.pop + '%' : '' }),
          el('span', { class: 'mono', style: 'flex:1;text-align:right;font-size:13.5px' }, [
            el('span', { class: 'faint', text: Math.round(d.lo) + '°' }),
            el('span', { text: '  ' + Math.round(d.hi) + '°' })
          ])
        ]);
      }));
    }

    if (view === 'full' && today && today.sunrise && today.sunset) {
      wrap.append(el('div', { class: 'faint', style: 'font-size:12px', text: `🌅 ${formatTime(today.sunrise)}   🌇 ${formatTime(today.sunset)}` }));
    }

    return wrap;
  },

  widget(p) {
    const cond = describe(p.current.code, p.current.isDay);
    const today = p.daily[0];
    return {
      weatherTemp: `${Math.round(p.current.temp)}${p.units.temp}`,
      weatherCond: cond.label,
      weatherIcon: cond.icon,
      weatherHiLo: today ? `H ${Math.round(today.hi)}°  L ${Math.round(today.lo)}°` : '',
      weatherPlace: p.place,
      /* The Android widget re-fetches these coordinates on its own schedule,
         so the temperature stays current while the app is closed. */
      weatherLat: p.lat == null ? '' : String(p.lat),
      weatherLon: p.lon == null ? '' : String(p.lon),
      weatherUnit: p.unitKey || 'fahrenheit'
    };
  }
};
