/* Air quality and pollen from Open-Meteo. No key required. */
import { getJSON, FetchError } from '../core/net.js';
import { el, kv } from '../core/ui.js';
import { geocode } from './weather.js';

function aqiBand(aqi) {
  if (aqi == null) return { label: 'Unknown', color: 'var(--fg-dim)' };
  if (aqi <= 50) return { label: 'Good', color: 'var(--good)' };
  if (aqi <= 100) return { label: 'Moderate', color: 'var(--warn)' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', color: '#fb923c' };
  if (aqi <= 200) return { label: 'Unhealthy', color: 'var(--bad)' };
  if (aqi <= 300) return { label: 'Very unhealthy', color: '#c084fc' };
  return { label: 'Hazardous', color: '#f472b6' };
}

export default {
  type: 'airquality',
  name: 'Air quality',
  emoji: '😮‍💨',
  blurb: 'US AQI, particulates and pollen, from Open-Meteo',
  defaultSpan: 1,
  fields: [
    { key: 'place', label: 'Place', placeholder: 'e.g. Denver, CO', help: 'Leave blank to use your device location.' }
  ],
  defaultTitle: () => 'Air quality',

  async load({ settings }) {
    let lat, lon, label;
    if (settings.place) {
      ({ lat, lon, label } = await geocode(settings.place));
    } else {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new FetchError('No location support on this device'));
        navigator.geolocation.getCurrentPosition(resolve,
          () => reject(new FetchError('Location denied — set a place in card settings')),
          { timeout: 12000, maximumAge: 600000 });
      });
      lat = pos.coords.latitude; lon = pos.coords.longitude; label = 'Current location';
    }
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
      + `?latitude=${lat}&longitude=${lon}&timezone=auto`
      + '&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,birch_pollen,grass_pollen,ragweed_pollen';
    const data = await getJSON(url);
    if (!data || !data.current) throw new FetchError('Air quality service returned no data');
    const c = data.current;
    return {
      place: label,
      aqi: c.us_aqi ?? null,
      pm25: c.pm2_5 ?? null,
      pm10: c.pm10 ?? null,
      ozone: c.ozone ?? null,
      no2: c.nitrogen_dioxide ?? null,
      pollen: {
        grass: c.grass_pollen ?? null,
        birch: c.birch_pollen ?? null,
        ragweed: c.ragweed_pollen ?? null
      }
    };
  },

  render(p) {
    const band = aqiBand(p.aqi);
    const wrap = el('div', { class: 'stack tight' });
    wrap.append(el('div', {}, [
      el('div', { class: 'big-num mono', style: `color:${band.color}`, text: p.aqi == null ? '—' : Math.round(p.aqi) }),
      el('div', { style: `font-size:13px;color:${band.color};margin-top:3px`, text: band.label }),
      el('div', { class: 'faint', style: 'font-size:11.5px;margin-top:2px', text: 'US AQI · ' + p.place })
    ]));

    const rows = [];
    if (p.pm25 != null) rows.push(['PM2.5', p.pm25.toFixed(1) + ' µg/m³']);
    if (p.pm10 != null) rows.push(['PM10', p.pm10.toFixed(1) + ' µg/m³']);
    if (p.ozone != null) rows.push(['Ozone', Math.round(p.ozone) + ' µg/m³']);
    const pollenTotal = ['grass', 'birch', 'ragweed']
      .map(k => p.pollen[k]).filter(v => v != null).reduce((a, b) => a + b, 0);
    if (pollenTotal > 0) rows.push(['Pollen', Math.round(pollenTotal) + ' grains/m³']);
    if (rows.length) wrap.append(kv(rows));
    return wrap;
  },

  widget(p) {
    return { aqi: p.aqi == null ? '' : String(Math.round(p.aqi)), aqiLabel: aqiBand(p.aqi).label };
  }
};
