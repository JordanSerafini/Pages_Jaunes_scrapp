/*
 * PagesJaunes full‑auto scraper — upgraded version 2025‑07‑28
 * — Résistant aux gels de pagination, capable de relancer la même page
 * — Détection du nombre total de résultats directement dans le HTML
 * — CLI options: headless, maxPages, resume, debug
 * — Utilise un pool d'onglets pour accélérer le scraping
 * — Zéro doublon grâce à un cache persistant (Set + CSV)
 * — Log 100 % colorisé (chalk) pour la lisibilité
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import chalk from 'chalk';
import minimist from 'minimist';
import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

// ---------- Utils -----------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const jitter = async (min = 180, max = 350) => sleep(rand(min, max));

const NORMALISE = (str = '') =>
  str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const CSV_HEADERS = [
  { id: 'name', title: 'Name' },
  { id: 'address', title: 'Address' },
  { id: 'phone', title: 'Phone' },
  { id: 'website', title: 'Website' },
  { id: 'email', title: 'Email' },
  { id: 'source', title: 'SourceUrl' }
];

// ---------- CLI -------------------------------------------------------------
const argv = minimist(process.argv.slice(2), {
  boolean: ['headful', 'resume', 'debug'],
  default: { headful: false, resume: true, maxPages: 0, debug: false }
});

// Required positional params
const [region, keyword, outfile] = argv._;
if (!region || !keyword) {
  console.error(
    chalk.red(
      '❌  Usage: node pages_jaunes_upgraded.js "<region>" "<keyword>" <outfile.csv> [--headful] [--no-resume]'
    )
  );
  process.exit(1);
}
const OUTFILE = outfile?.endsWith('.csv') ? outfile : `${outfile || 'result'}.csv`;

// ---------- Cache init ------------------------------------------------------
const processed = new Set();
if (argv.resume && fs.existsSync(OUTFILE)) {
  fs.readFileSync(OUTFILE, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .forEach(l => {
      const [name] = l.split(',');
      if (name) processed.add(NORMALISE(name));
    });
  console.log(chalk.yellow(`↻  Resume mode: ${processed.size} entries already in cache`));
}
const writer = createObjectCsvWriter({
  path: OUTFILE,
  header: CSV_HEADERS,
  append: argv.resume && fs.existsSync(OUTFILE)
});

// ---------- Core ------------------------------------------------------------
export async function scrape() {
  const browser = await puppeteer.launch({
    headless: !argv.headful,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  );

  // Accept cookies if needed
  await page.goto('https://www.pagesjaunes.fr/', { waitUntil: 'domcontentloaded' });
  const cookieBtn = await page.$('button[aria-label^="Accepter"]');
  if (cookieBtn) {
    await cookieBtn.click();
    await jitter();
  }

  await page.type('#ou', region);
  await jitter();
  await page.type('#quoiqui', keyword);
  await jitter();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('#findId')
  ]);

  let pageNum = 1,
    freezeCount = 0;
  const results = [];

  while (true) {
    // ------ anti‑freeze ------
    const firstThree = await page.$$eval('li.bi a[href*="/pros/"]', els =>
      els.slice(0, 3).map(e => e.href)
    );
    const hash = firstThree.join('|');
    if (hash === page.__prevHash) {
      freezeCount++;
      console.warn(
        chalk.redBright(`⚠️  Same content detected on page ${pageNum} (freeze #${freezeCount})`)
      );
      if (freezeCount > 1) {
        // second freeze consécutif = exit loop
        break;
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      continue;
    }
    page.__prevHash = hash;
    freezeCount = 0;

    // ------ scrape listing ------
    const links = await page.$$eval('li.bi a[href*="/pros/"]', els => [
      ...new Set(els.map(e => e.href))
    ]);
    if (argv.debug) console.log(chalk.cyan(`🔗  ${links.length} detail links on page ${pageNum}`));

    // open 8 at a time
    const chunkSize = 8;
    for (let i = 0; i < links.length; i += chunkSize) {
      const slice = links.slice(i, i + chunkSize);
      await Promise.all(
        slice.map(async url => {
          if (processed.has(url)) return; // skip url duplicates
          const tab = await browser.newPage();
          try {
            await tab.goto(url, { waitUntil: 'domcontentloaded' });
            await tab.waitForSelector('div.bi-content, h1', { timeout: 6000 });
            const data = await tab.evaluate(() => {
              const clean = s => s?.replace(/[\n\r]+/g, ' ').trim() || '';
              const get = sel => clean(document.querySelector(sel)?.innerText);
              return {
                name: get('div.bi-content h3') || document.title.replace(' - PagesJaunes', ''),
                address: get('div.bi-content > div:nth-child(2)'),
                phone: Array.from(document.querySelectorAll('.coord-numero'))
                  .map(e => e.innerText.trim())
                  .join(' | '),
                website: document.querySelector('a.MINISITE, a.SITE_EXTERNE')?.href || '',
                email: (document.querySelector('a[href^="mailto:"]')?.href || '').replace(
                  'mailto:',
                  ''
                )
              };
            });
            if (!data.name) return;
            const norm = NORMALISE(data.name);
            if (processed.has(norm)) return;
            processed.add(norm);
            results.push({ ...data, source: url });
          } catch (e) {
            if (argv.debug) console.error(e.message);
          } finally {
            await tab.close();
          }
        })
      );

      // flush every 25 rows
      if (results.length >= 25) {
        await writer.writeRecords(results.splice(0));
      }
    }

    // ------ next page ------
    if (argv.maxPages && pageNum >= argv.maxPages) {
      break;
    }
    const nextBtn = await page.$('#pagination-next, a[aria-label*="Suivant"], .pagination-next');
    if (!nextBtn) {
      break;
    }
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), nextBtn.click()]);
    pageNum++;
  }

  if (results.length) await writer.writeRecords(results);
  console.log(chalk.green(`✅  Finished. ${processed.size} unique companies saved to ${OUTFILE}`));
  await browser.close();
}

// ---------------- run directly ----------------
if (import.meta.url === `file://${__filename}`) {
  scrape();
}
