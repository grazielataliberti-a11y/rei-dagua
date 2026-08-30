const SITE = "https://grazielataliberti-a11y.github.io/rei-dagua/";
const ORIGEM_SITE = "https://grazielataliberti-a11y.github.io";
const ORIGENS_OK = new Set([
  ORIGEM_SITE,
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const VAZIO = JSON.stringify({
  clientes: [],
  produtos: [],
  vendas: [],
  contas: [],
  lancamentos: [],
  receitas: [],
  despesas: []
});

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ORIGENS_OK.has(origin) ? origin : ORIGEM_SITE;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-ReiDagua-Chave",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function autorizado(request, env) {
  const esperada = String(env.API_CHAVE || "");
  if (!esperada) return false;
  const enviada = request.headers.get("X-ReiDagua-Chave") || "";
  return enviada === esperada;
}

function json(body, status, request) {
  return Response.json(body, { status, headers: cors(request) });
}

const LOJA = {
  cep: "09751120",
  endereco: "Rua Itapeva, 158, Baeta Neves, São Bernardo do Campo - SP",
  lat: -23.6859695,
  lng: -46.5444094
};
const LIMITE_KM = 5;
const UA = { "User-Agent": "ReiDagua/1.0 (distribuidora)" };

function soCep(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 8);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function viaCep(cep) {
  const res = await fetch("https://viacep.com.br/ws/" + cep + "/json/");
  if (!res.ok) return null;
  const j = await res.json();
  if (j.erro) return null;
  const partes = [j.logradouro, j.bairro, j.localidade, j.uf].filter(Boolean);
  return {
    label: partes.join(", "),
    query: [...partes, "Brasil"].join(", ")
  };
}

async function geocodeNominatim(q) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&q=" +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!arr?.[0]) return null;
  return {
    lat: Number(arr[0].lat),
    lng: Number(arr[0].lon),
    label: arr[0].display_name
  };
}

async function geocodeGoogle(env, q) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key) return null;
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?language=pt-BR&region=br&address=" +
    encodeURIComponent(q) +
    "&key=" +
    encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const r = j.results?.[0];
  if (!r) return null;
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    label: r.formatted_address
  };
}

async function distanciaGoogle(env, origem, dest) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key) return null;
  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&language=pt-BR&mode=driving&origins=" +
    encodeURIComponent(origem.lat + "," + origem.lng) +
    "&destinations=" +
    encodeURIComponent(dest.lat + "," + dest.lng) +
    "&key=" +
    encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const el = j.rows?.[0]?.elements?.[0];
  if (el?.status !== "OK" || el.distance?.value == null) return null;
  return el.distance.value / 1000;
}

function decodePolyline(encoded) {
  const pts = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

async function rotaGoogle(env, origem, dest) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key) return null;
  const url =
    "https://maps.googleapis.com/maps/api/directions/json?language=pt-BR&region=br&mode=driving&alternatives=false&origin=" +
    encodeURIComponent(origem.lat + "," + origem.lng) +
    "&destination=" +
    encodeURIComponent(dest.lat + "," + dest.lng) +
    "&key=" +
    encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const route = j.routes?.[0];
  const leg = route?.legs?.[0];
  if (!leg?.distance?.value) return null;
  const poly = route.overview_polyline?.points;
  return {
    km: leg.distance.value / 1000,
    minutos: Math.round((leg.duration?.value || 0) / 60),
    percurso: poly ? decodePolyline(poly) : null,
    fonte: "google"
  };
}

async function rotaOsrm(origem, dest) {
  const pontos = origem.lng + "," + origem.lat + ";" + dest.lng + "," + dest.lat;
  const urls = [
    "https://router.project-osrm.org/route/v1/driving/" + pontos + "?overview=full&geometries=geojson",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/" + pontos + "?overview=full&geometries=geojson"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) continue;
      const j = await res.json();
      const route = j.routes?.[0];
      if (route?.distance == null) continue;
      const coords = route.geometry?.coordinates || [];
      return {
        km: route.distance / 1000,
        minutos: Math.round((route.duration || 0) / 60),
        percurso: coords.map(([lng, lat]) => [lat, lng]),
        fonte: "rota"
      };
    } catch {
      /* tenta o próximo servidor */
    }
  }
  return null;
}

function cepFormatado(cep) {
  const d = soCep(cep);
  if (d.length !== 8) return "";
  return d.slice(0, 5) + "-" + d.slice(5);
}

async function localizar(env, cep, endereco) {
  let extra = String(endereco || "").trim();
  let via = null;
  if (cep && !extra) {
    via = await viaCep(cep);
    if (via?.query) extra = via.label || via.query;
  }
  const texto = [extra, cepFormatado(cep)].filter(Boolean).join(", ");
  const g = await geocodeGoogle(env, texto || extra || cep);
  if (g?.lat) return g;
  if (extra) {
    const n = await geocodeNominatim(extra + (cep ? ", " + cep : "") + ", Brasil");
    if (n?.lat) return n;
  }
  if (cep) {
    via = via || await viaCep(cep);
    if (via?.query) {
      const n = await geocodeNominatim(via.query);
      if (n?.lat) return { ...n, label: via.label };
    }
  }
  return null;
}

async function origemLoja(env) {
  const g = await geocodeGoogle(env, LOJA.endereco);
  if (g?.lat) return { ...g, cep: LOJA.cep };
  return { lat: LOJA.lat, lng: LOJA.lng, label: LOJA.endereco, cep: LOJA.cep };
}

async function distanciaGoogleTexto(env, destTexto) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key || !destTexto) return null;
  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&language=pt-BR&region=br&mode=driving" +
    "&origins=" + encodeURIComponent(LOJA.endereco) +
    "&destinations=" + encodeURIComponent(destTexto) +
    "&key=" + encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const el = j.rows?.[0]?.elements?.[0];
  if (el?.status !== "OK" || el.distance?.value == null) return null;
  return {
    km: el.distance.value / 1000,
    minutos: Math.round((el.duration?.value || 0) / 60),
    originLabel: j.origin_addresses?.[0] || LOJA.endereco,
    destLabel: j.destination_addresses?.[0] || destTexto
  };
}

async function calcularDistancia(env, cep, endereco) {
  const dest = await localizar(env, cep, endereco);
  if (!dest?.lat) {
    return { ok: false, erro: "Nao foi possivel localizar este CEP ou endereco." };
  }
  const origem = await origemLoja(env);
  const linha = haversineKm(origem.lat, origem.lng, dest.lat, dest.lng);
  const destTexto = [endereco || dest.label, cepFormatado(cep)].filter(Boolean).join(", ");
  const googleTxt = await distanciaGoogleTexto(env, destTexto);
  let rota = googleTxt
    ? { km: googleTxt.km, minutos: googleTxt.minutos, fonte: "google", percurso: null }
    : await rotaGoogle(env, origem, dest);
  if (!rota) {
    const kmGoogle = await distanciaGoogle(env, origem, dest);
    const osrm = await rotaOsrm(origem, dest);
    if (kmGoogle != null) {
      rota = {
        km: kmGoogle,
        minutos: osrm?.minutos || null,
        percurso: osrm?.percurso || null,
        fonte: "google"
      };
    } else {
      rota = osrm;
    }
  }
  let km = rota?.km;
  if (km == null) km = linha;
  km = Math.round(km * 10) / 10;
  const percurso = (rota?.percurso && rota.percurso.length > 1)
    ? rota.percurso
    : [[origem.lat, origem.lng], [dest.lat, dest.lng]];
  return {
    ok: true,
    km,
    kmLinha: Math.round(linha * 10) / 10,
    minutos: rota?.minutos || null,
    atende: km <= LIMITE_KM,
    limiteKm: LIMITE_KM,
    origem,
    destino: dest,
    percurso,
    fonte: rota?.fonte || "linha"
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "") {
      return Response.redirect(SITE, 302);
    }

    if (url.pathname === "/api/saude") {
      return json({ ok: true, servico: "Rei D'Água" }, 200, request);
    }

    if (url.pathname === "/api/distancia" && request.method === "GET") {
      const cep = soCep(url.searchParams.get("cep"));
      const endereco = String(url.searchParams.get("endereco") || "").trim();
      if (cep.length !== 8 && !endereco) {
        return json({ ok: false, erro: "Informe o CEP ou o endereco do cliente." }, 400, request);
      }
      try {
        const resultado = await calcularDistancia(env, cep.length === 8 ? cep : "", endereco);
        return json(resultado, resultado.ok ? 200 : 404, request);
      } catch {
        return json({ ok: false, erro: "Nao foi possivel calcular a distancia agora." }, 500, request);
      }
    }

    if (url.pathname === "/api/dados" && (request.method === "GET" || request.method === "PUT")) {
      if (!autorizado(request, env)) {
        return json({ ok: false }, 401, request);
      }
      if (request.method === "GET") {
        const dados = (await env.DADOS.get("main")) || VAZIO;
        return new Response(dados, {
          headers: { ...cors(request), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      try {
        const texto = await request.text();
        JSON.parse(texto);
        await env.DADOS.put("main", texto);
        return json({ ok: true }, 200, request);
      } catch {
        return json({ ok: false }, 400, request);
      }
    }

    return json({ ok: false }, 404, request);
  }
};
