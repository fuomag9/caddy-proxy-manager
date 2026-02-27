'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import MapGL, { Layer, Popup, Source, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { ExpressionSpecification, FillLayerSpecification, LineLayerSpecification } from 'maplibre-gl';
import { Box, CircularProgress, Typography } from '@mui/material';
import 'maplibre-gl/dist/maplibre-gl.css';

const A2N: Record<string, string> = {
  AF:'4',AL:'8',DZ:'12',AD:'20',AO:'24',AG:'28',AR:'32',AM:'51',
  AU:'36',AT:'40',AZ:'31',BS:'44',BH:'48',BD:'50',BB:'52',BY:'112',
  BE:'56',BZ:'84',BJ:'204',BT:'64',BO:'68',BA:'70',BW:'72',BR:'76',
  BN:'96',BG:'100',BF:'854',BI:'108',CV:'132',KH:'116',CM:'120',
  CA:'124',CF:'140',TD:'148',CL:'152',CN:'156',CO:'170',KM:'174',
  CG:'178',CD:'180',CR:'188',CI:'384',HR:'191',CU:'192',CY:'196',
  CZ:'203',DK:'208',DJ:'262',DM:'212',DO:'214',EC:'218',EG:'818',
  SV:'222',GQ:'226',ER:'232',EE:'233',SZ:'748',ET:'231',FJ:'242',
  FI:'246',FR:'250',GA:'266',GM:'270',GE:'268',DE:'276',GH:'288',
  GR:'300',GD:'308',GT:'320',GN:'324',GW:'624',GY:'328',HT:'332',
  HN:'340',HU:'348',IS:'352',IN:'356',ID:'360',IR:'364',IQ:'368',
  IE:'372',IL:'376',IT:'380',JM:'388',JP:'392',JO:'400',KZ:'398',
  KE:'404',KI:'296',KP:'408',KR:'410',KW:'414',KG:'417',LA:'418',
  LV:'428',LB:'422',LS:'426',LR:'430',LY:'434',LI:'438',LT:'440',
  LU:'442',MG:'450',MW:'454',MY:'458',MV:'462',ML:'466',MT:'470',
  MH:'584',MR:'478',MU:'480',MX:'484',FM:'583',MD:'498',MC:'492',
  MN:'496',ME:'499',MA:'504',MZ:'508',MM:'104',NA:'516',NR:'520',
  NP:'524',NL:'528',NZ:'554',NI:'558',NE:'562',NG:'566',NO:'578',
  OM:'512',PK:'586',PW:'585',PA:'591',PG:'598',PY:'600',PE:'604',
  PH:'608',PL:'616',PT:'620',QA:'634',RO:'642',RU:'643',RW:'646',
  KN:'659',LC:'662',VC:'670',WS:'882',SM:'674',ST:'678',SA:'682',
  SN:'686',RS:'688',SC:'690',SL:'694',SG:'702',SK:'703',SI:'705',
  SB:'90',SO:'706',ZA:'710',SS:'728',ES:'724',LK:'144',SD:'729',
  SR:'740',SE:'752',CH:'756',SY:'760',TW:'158',TJ:'762',TZ:'834',
  TH:'764',TL:'626',TG:'768',TO:'776',TT:'780',TN:'788',TR:'792',
  TM:'795',TV:'798',UG:'800',UA:'804',AE:'784',GB:'826',US:'840',
  UY:'858',UZ:'860',VU:'548',VE:'862',VN:'704',YE:'887',ZM:'894',
  ZW:'716',PS:'275',
};
const N2A: Record<string, string> = Object.fromEntries(Object.entries(A2N).map(([a, n]) => [n, a]));

const NAMES: Record<string, string> = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AD:'Andorra',AO:'Angola',AG:'Antigua & Barbuda',
  AR:'Argentina',AM:'Armenia',AU:'Australia',AT:'Austria',AZ:'Azerbaijan',BS:'Bahamas',
  BH:'Bahrain',BD:'Bangladesh',BB:'Barbados',BY:'Belarus',BE:'Belgium',BZ:'Belize',
  BJ:'Benin',BT:'Bhutan',BO:'Bolivia',BA:'Bosnia & Herzegovina',BW:'Botswana',BR:'Brazil',
  BN:'Brunei',BG:'Bulgaria',BF:'Burkina Faso',BI:'Burundi',CV:'Cape Verde',KH:'Cambodia',
  CM:'Cameroon',CA:'Canada',CF:'Central African Rep.',TD:'Chad',CL:'Chile',CN:'China',
  CO:'Colombia',KM:'Comoros',CG:'Congo',CD:'DR Congo',CR:'Costa Rica',CI:"Côte d'Ivoire",
  HR:'Croatia',CU:'Cuba',CY:'Cyprus',CZ:'Czech Republic',DK:'Denmark',DJ:'Djibouti',
  DM:'Dominica',DO:'Dominican Republic',EC:'Ecuador',EG:'Egypt',SV:'El Salvador',
  GQ:'Equatorial Guinea',ER:'Eritrea',EE:'Estonia',SZ:'Eswatini',ET:'Ethiopia',
  FJ:'Fiji',FI:'Finland',FR:'France',GA:'Gabon',GM:'Gambia',GE:'Georgia',DE:'Germany',
  GH:'Ghana',GR:'Greece',GD:'Grenada',GT:'Guatemala',GN:'Guinea',GW:'Guinea-Bissau',
  GY:'Guyana',HT:'Haiti',HN:'Honduras',HU:'Hungary',IS:'Iceland',IN:'India',ID:'Indonesia',
  IR:'Iran',IQ:'Iraq',IE:'Ireland',IL:'Israel',IT:'Italy',JM:'Jamaica',JP:'Japan',
  JO:'Jordan',KZ:'Kazakhstan',KE:'Kenya',KI:'Kiribati',KP:'North Korea',KR:'South Korea',
  KW:'Kuwait',KG:'Kyrgyzstan',LA:'Laos',LV:'Latvia',LB:'Lebanon',LS:'Lesotho',LR:'Liberia',
  LY:'Libya',LI:'Liechtenstein',LT:'Lithuania',LU:'Luxembourg',MG:'Madagascar',MW:'Malawi',
  MY:'Malaysia',MV:'Maldives',ML:'Mali',MT:'Malta',MH:'Marshall Islands',MR:'Mauritania',
  MU:'Mauritius',MX:'Mexico',FM:'Micronesia',MD:'Moldova',MC:'Monaco',MN:'Mongolia',
  ME:'Montenegro',MA:'Morocco',MZ:'Mozambique',MM:'Myanmar',NA:'Namibia',NR:'Nauru',
  NP:'Nepal',NL:'Netherlands',NZ:'New Zealand',NI:'Nicaragua',NE:'Niger',NG:'Nigeria',
  NO:'Norway',OM:'Oman',PK:'Pakistan',PW:'Palau',PA:'Panama',PG:'Papua New Guinea',
  PY:'Paraguay',PE:'Peru',PH:'Philippines',PL:'Poland',PT:'Portugal',QA:'Qatar',
  RO:'Romania',RU:'Russia',RW:'Rwanda',KN:'Saint Kitts & Nevis',LC:'Saint Lucia',
  VC:'Saint Vincent',WS:'Samoa',SM:'San Marino',ST:'São Tomé & Príncipe',SA:'Saudi Arabia',
  SN:'Senegal',RS:'Serbia',SC:'Seychelles',SL:'Sierra Leone',SG:'Singapore',SK:'Slovakia',
  SI:'Slovenia',SB:'Solomon Islands',SO:'Somalia',ZA:'South Africa',SS:'South Sudan',
  ES:'Spain',LK:'Sri Lanka',SD:'Sudan',SR:'Suriname',SE:'Sweden',CH:'Switzerland',
  SY:'Syria',TW:'Taiwan',TJ:'Tajikistan',TZ:'Tanzania',TH:'Thailand',TL:'Timor-Leste',
  TG:'Togo',TO:'Tonga',TT:'Trinidad & Tobago',TN:'Tunisia',TR:'Turkey',TM:'Turkmenistan',
  TV:'Tuvalu',UG:'Uganda',UA:'Ukraine',AE:'United Arab Emirates',GB:'United Kingdom',
  US:'United States',UY:'Uruguay',UZ:'Uzbekistan',VU:'Vanuatu',VE:'Venezuela',
  VN:'Vietnam',YE:'Yemen',ZM:'Zambia',ZW:'Zimbabwe',PS:'Palestine',
};

function flag(code: string): string {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// Unwrap polygon rings so consecutive vertices never jump more than 180° in longitude.
// This prevents MapLibre from drawing giant artifacts for countries crossing ±180° (Russia, Fiji, etc.).
// Coordinates outside [-180, 180] are intentional — MapLibre renders them via world-copy tiling.
function cutAntimeridian(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  function unwrapRing(ring: GeoJSON.Position[]): GeoJSON.Position[] {
    if (ring.length === 0) return ring;
    const out: GeoJSON.Position[] = [[ring[0][0], ring[0][1]]];
    for (let i = 1; i < ring.length; i++) {
      let lng = ring[i][0];
      const prev = out[i - 1][0];
      while (lng - prev > 180) lng -= 360;
      while (prev - lng > 180) lng += 360;
      out.push([lng, ring[i][1]]);
    }
    return out;
  }

  function fixGeometry(geom: GeoJSON.Geometry): GeoJSON.Geometry {
    if (geom.type === 'Polygon') {
      return { ...geom, coordinates: geom.coordinates.map(unwrapRing) };
    }
    if (geom.type === 'MultiPolygon') {
      return { ...geom, coordinates: geom.coordinates.map(p => p.map(unwrapRing)) };
    }
    return geom;
  }

  return {
    ...fc,
    features: fc.features.map(f => f.geometry ? { ...f, geometry: fixGeometry(f.geometry) } : f),
  };
}

const OCEAN = '#0a1628';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MAP_STYLE: any = {
  version: 8,
  name: 'blank',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': OCEAN } }],
};

const FILL_LAYER: Omit<FillLayerSpecification, 'source'> = {
  id: 'countries-fill',
  type: 'fill',
  paint: {
    'fill-color': [
      'interpolate', ['linear'],
      ['coalesce', ['get', 'norm'], 0],
      0,     '#1e293b',  // no traffic — slate-800, clearly distinct from ocean
      0.001, '#1e3a8a',  // any traffic
      0.4,   '#3b82f6',
      1,     '#93c5fd',
    ] as ExpressionSpecification,
    'fill-opacity': 1,
  },
};

const HIGHLIGHT_LAYER: Omit<FillLayerSpecification, 'source'> = {
  id: 'countries-highlight',
  type: 'fill',
  paint: {
    'fill-color': '#7dd3fc',
    'fill-opacity': 0.45,
  },
};

const OUTLINE_LAYER: Omit<LineLayerSpecification, 'source'> = {
  id: 'countries-outline',
  type: 'line',
  paint: {
    'line-color': 'rgba(148,163,184,0.18)',
    'line-width': 0.6,
  },
};

export interface CountryStats { countryCode: string; total: number; blocked: number; }

interface HoverInfo {
  longitude: number;
  latitude: number;
  alpha2: string;
  total: number;
  blocked: number;
}

export default function WorldMapInner({ data }: { data: CountryStats[] }) {
  const [baseGeojson, setBaseGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const countMap = useMemo(() => new Map(data.map(d => [d.countryCode, d.total])), [data]);
  const blockedMap = useMemo(() => new Map(data.map(d => [d.countryCode, d.blocked])), [data]);
  const max = useMemo(() => data.reduce((m, d) => Math.max(m, d.total), 0), [data]);

  useEffect(() => {
    fetch('/geo/countries-110m.json')
      .then(r => r.json())
      .then((topo: Topology) => {
        const fc = feature(topo, topo.objects.countries as GeometryCollection) as GeoJSON.FeatureCollection;
        setBaseGeojson(cutAntimeridian(fc));
      })
      .catch(() => setBaseGeojson({ type: 'FeatureCollection', features: [] }));
  }, []);

  const geojson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!baseGeojson) return null;
    const safeMax = Math.max(max, 1);
    return {
      ...baseGeojson,
      features: baseGeojson.features.map(f => {
        const alpha2 = N2A[String(f.id ?? '')] ?? null;
        const total = alpha2 ? (countMap.get(alpha2) ?? 0) : 0;
        const blocked = alpha2 ? (blockedMap.get(alpha2) ?? 0) : 0;
        return { ...f, properties: { ...f.properties, alpha2, total, blocked, norm: total / safeMax } };
      }),
    };
  }, [baseGeojson, countMap, blockedMap, max]);

  const onHover = useCallback((event: MapLayerMouseEvent) => {
    const f = event.features?.[0];
    if (!f) { setHoverInfo(null); return; }
    const alpha2 = f.properties?.alpha2 as string | null;
    if (!alpha2) { setHoverInfo(null); return; }
    setHoverInfo({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
      alpha2,
      total: (f.properties?.total as number) ?? 0,
      blocked: (f.properties?.blocked as number) ?? 0,
    });
  }, []);

  const highlightFilter = useMemo<ExpressionSpecification>(
    () => ['==', ['get', 'alpha2'], hoverInfo?.alpha2 ?? ''],
    [hoverInfo?.alpha2],
  );

  if (!geojson) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative' }}>
      {/* Override MapLibre popup chrome to match dark theme */}
      <style>{`
        .wm-popup .maplibregl-popup-content {
          background: rgba(8,16,30,0.96) !important;
          border: 1px solid rgba(148,163,184,0.15) !important;
          border-radius: 10px !important;
          padding: 10px 14px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
          backdrop-filter: blur(12px) !important;
          min-width: 152px;
        }
        .wm-popup .maplibregl-popup-tip { display: none !important; }
      `}</style>

      <Box sx={{
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid rgba(148,163,184,0.08)',
        height: 340,
      }}>
        <MapGL
          mapStyle={MAP_STYLE}
          initialViewState={{
            bounds: [[-168, -56], [168, 74]],
            fitBoundsOptions: { padding: 4 },
          }}
          minZoom={0.5}
          interactiveLayerIds={['countries-fill']}
          onMouseMove={onHover}
          onMouseLeave={() => setHoverInfo(null)}
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
          dragRotate={false}
          pitchWithRotate={false}
          cursor={hoverInfo ? 'crosshair' : 'grab'}
        >
          <Source id="countries" type="geojson" data={geojson}>
            <Layer {...FILL_LAYER} source="countries" />
            <Layer {...HIGHLIGHT_LAYER} source="countries" filter={highlightFilter} />
            <Layer {...OUTLINE_LAYER} source="countries" />
          </Source>

          {hoverInfo && (
            <Popup
              longitude={hoverInfo.longitude}
              latitude={hoverInfo.latitude}
              offset={[0, -6] as [number, number]}
              closeButton={false}
              closeOnClick={false}
              anchor="bottom"
              className="wm-popup"
            >
              <div style={{ color: '#f1f5f9', fontFamily: 'inherit', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, fontWeight: 600, fontSize: 14 }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{flag(hoverInfo.alpha2)}</span>
                  <span>{NAMES[hoverInfo.alpha2] ?? hoverInfo.alpha2}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                  <span style={{ color: '#94a3b8' }}>Requests</span>
                  <span style={{ color: '#60a5fa', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {hoverInfo.total.toLocaleString()}
                  </span>
                </div>
                {hoverInfo.blocked > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginTop: 3 }}>
                    <span style={{ color: '#94a3b8' }}>Blocked</span>
                    <span style={{ color: '#f87171', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {hoverInfo.blocked.toLocaleString()}
                    </span>
                  </div>
                )}
                {hoverInfo.total === 0 && (
                  <div style={{ color: '#475569', marginTop: 3, fontSize: 12 }}>No traffic recorded</div>
                )}
              </div>
            </Popup>
          )}
        </MapGL>
      </Box>

      {max > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, px: 0.5 }}>
          <Typography variant="caption" color="text.disabled">Low</Typography>
          <Box sx={{
            flex: 1, height: 5, borderRadius: 3,
            background: 'linear-gradient(to right, #1e3a8a, #3b82f6, #93c5fd)',
          }} />
          <Typography variant="caption" color="text.disabled">High</Typography>
        </Box>
      )}
    </Box>
  );
}
