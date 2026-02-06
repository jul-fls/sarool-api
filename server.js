import express from "express";
import fetch from "node-fetch";
import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import { createEvents } from "ics";
import dotenv from "dotenv";

dotenv.config();

/* =========================
   CONFIG
   ========================= */

const BASE = "https://www.sarool.fr";
const EMAIL = process.env.SAROOL_EMAIL;
const PASSWORD = process.env.SAROOL_PASSWORD;
const API_TOKEN = process.env.API_TOKEN;
const CACHE_TTL = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 60) * 1000;

if (!EMAIL || !PASSWORD || !API_TOKEN) {
  throw new Error("Variables SAROOL_EMAIL / SAROOL_PASSWORD / API_TOKEN manquantes");
}

/* =========================
   LOCATIONS
   ========================= */

const LOCATIONS = {
  default: {
    name: process.env.DEFAULT_LOCATION_NAME || "Auto-école",
    address: process.env.DEFAULT_LOCATION_ADDRESS || ""
  },
  lecon: {
    name: process.env.LECON_LOCATION_NAME,
    address: process.env.LECON_LOCATION_ADDRESS
  },
  module: {
    name: process.env.MODULE_LOCATION_NAME,
    address: process.env.MODULE_LOCATION_ADDRESS
  },
  simulateur: {
    name: process.env.SIMULATEUR_LOCATION_NAME,
    address: process.env.SIMULATEUR_LOCATION_ADDRESS
  }
};

function resolveLocation(type) {
  const loc = LOCATIONS[type];
  if (loc?.name && loc?.address) {
    return `${loc.name} (${loc.address})`;
  }
  return `${LOCATIONS.default.name} (${LOCATIONS.default.address})`;
}

/* =========================
   HTTP CLIENT
   ========================= */

const jar = new CookieJar();
const client = fetchCookie(fetch, jar);

/* =========================
   CACHE
   ========================= */

let cache = {
  expiresAt: 0,
  ics: null
};

/* =========================
   AUTH
   ========================= */

async function isAuthenticated() {
  const cookies = await jar.getCookies(BASE);
  return cookies.some(c => c.key === ".AspNet.ApplicationCookie");
}

async function loginSarool() {
  if (await isAuthenticated()) {
    console.log("[AUTH] cookie déjà présent → skip login");
    return;
  }

  console.log("[AUTH] GET /compte/connexion");
  const t0 = Date.now();

  const loginPage = await client(`${BASE}/compte/connexion`);
  const html = await loginPage.text();
  const $ = cheerio.load(html);

  const viewState = $("#__VIEWSTATE").val();
  const viewStateGenerator = $("#__VIEWSTATEGENERATOR").val();
  const eventValidation = $("#__EVENTVALIDATION").val();

  if (!viewState || !eventValidation) {
    throw new Error("WebForms tokens introuvables");
  }

  const body = new URLSearchParams({
    rssManager_TSSM: "",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: viewStateGenerator,
    __EVENTVALIDATION: eventValidation,
    "ctl00$MainContent$Email": EMAIL,
    "ctl00$MainContent$Password": PASSWORD,
    "ctl00$MainContent$ctl05": "Connexion",
    wdwManager_ClientState: "",
    wdwManagerOuiNon_ClientState: ""
  });

  const res = await client(`${BASE}/compte/connexion`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: `${BASE}/compte/connexion`
    },
    body,
    redirect: "manual"
  });

  if (res.status !== 302 || !(await isAuthenticated())) {
    throw new Error("AUTH FAILED");
  }

  console.log(`[AUTH] OK (${Date.now() - t0} ms)`);
}

/* =========================
   PLANNING
   ========================= */

async function fetchPlanning() {
  console.log("[PLANNING] GET /informations/planning");
  const t0 = Date.now();

  const res = await client(`${BASE}/informations/planning`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const events = [];

  $("tbody tr").each((_, tr) => {
    const dateText = $(tr).find(".F2el_Prestas_ColDatI nobr").text().trim();
    const startText = $(tr).find(".F2el_Prestas_ColHeuI").text().trim();
    const durationMin = parseInt($(tr).find(".F2el_Prestas_ColDurI").text(), 10);
    const instructor = $(tr).find(".F2el_Prestas_ColMonI nobr").text().trim();
    const typeLabel = $(tr).find(".F2el_Prestas_ColTypI nobr").text().trim();

    if (!dateText || !startText || !durationMin) return;

    const [, dmy] = dateText.split(" ");
    const [d, m, y] = dmy.split("/").map(Number);
    const year = 2000 + y;
    const [h, min] = startText.split("h").map(Number);

    // 🕒 Date locale (Europe/Paris)
    const localStart = new Date(year, m - 1, d, h, min);
    const localEnd = new Date(localStart.getTime() + durationMin * 60000);

    // 🌍 Conversion UTC
    const startUTC = [
      localStart.getUTCFullYear(),
      localStart.getUTCMonth() + 1,
      localStart.getUTCDate(),
      localStart.getUTCHours(),
      localStart.getUTCMinutes()
    ];

    const endUTC = [
      localEnd.getUTCFullYear(),
      localEnd.getUTCMonth() + 1,
      localEnd.getUTCDate(),
      localEnd.getUTCHours(),
      localEnd.getUTCMinutes()
    ];

    let type = "lecon";
    if (/simulateur/i.test(typeLabel)) type = "simulateur";
    else if (/module/i.test(typeLabel)) type = "module";

    const location = resolveLocation(type);

    events.push({
      title: `${typeLabel} – ${instructor}`,
      start: startUTC,
      end: endUTC,
      location,
      description:
        `Moniteur : ${instructor}\n` +
        `Type : ${typeLabel}\n` +
        `⏱️ Times are provided in UTC`
    });
  });

  console.log(`[PLANNING] ${events.length} événements (${Date.now() - t0} ms)`);
  return events;
}

/* =========================
   ICS (UTC)
   ========================= */

function buildICS(events) {
  const t0 = Date.now();

  const { error, value } = createEvents(events, {
    calName: "Sarool Planning (UTC)",
    startOutputType: "utc"
  });

  if (error) throw error;

  console.log(`[ICS] généré en ${Date.now() - t0} ms`);
  return value;
}

/* =========================
   EXPRESS
   ========================= */

const app = express();
let inFlightPromise = null;

app.get("/planning", async (req, res) => {
  const t0 = Date.now();
  console.log("[REQUEST] /planning started");

  if (req.query.token !== API_TOKEN) {
    return res.status(401).send("Unauthorized");
  }

  try {
    if (cache.ics && Date.now() < cache.expiresAt) {
      console.log("[CACHE] HIT");
      res.send(cache.ics);
      console.log(`[TIMING] TOTAL (cache): ${Date.now() - t0} ms`);
      return;
    }

    if (inFlightPromise) {
      console.log("[CACHE] WAIT (in-flight)");
      await inFlightPromise;
      res.send(cache.ics);
      console.log(`[TIMING] TOTAL (wait): ${Date.now() - t0} ms`);
      return;
    }

    console.log("[CACHE] MISS → recompute");

    inFlightPromise = (async () => {
      await loginSarool();
      const events = await fetchPlanning();
      cache = {
        ics: buildICS(events),
        expiresAt: Date.now() + CACHE_TTL
      };
    })();

    await inFlightPromise;
    inFlightPromise = null;

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=sarool-planning.ics");
    res.send(cache.ics);

    console.log(`[TIMING] TOTAL /planning: ${Date.now() - t0} ms`);
  } catch (err) {
    inFlightPromise = null;
    console.error("[SERVER ERROR]", err.message);
    res.status(500).send(err.message);
  }
});

app.listen(3000, () => {
  console.log("Serveur prêt → http://localhost:3000/planning?token=XXXX");
});
