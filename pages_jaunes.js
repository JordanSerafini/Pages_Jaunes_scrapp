import puppeteerVanilla from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const puppeteer = addExtra(puppeteerVanilla);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
puppeteer.use(StealthPlugin());

const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
const delayShort = () => delay(200, 400);
const delayPageChange = () => delay(600, 800);

// Centralisation des sélecteurs
const SELECTORS = {
    listing: 'li.bi',
    detailLinkCandidates: [
        'a.bi-denomination.pj-link',
        '.bi-header-title a',
        '.bi-content a[href*="/pros/"]',
        'a[href*="/pros/"]',
        'a[href*="detail"]'
    ],
    companyRoot: 'div.bi-content, h1, .bi-denomination',
    showNumberBtn: 'button[aria-label*="Afficher le N°"]',
    phoneSelectors: [
        '.coord-numero',
        '.number-contact span',
        '.bi-ctas .btn_tel + span',
        'span[aria-label*="numéro"]',
        '.contact-info span',
        '.phone-number',
        '.coord-liste-numero span'
    ],
    websiteSelectors: [
        'a.MINISITE.pj-link',
        'a[class*="MINISITE"]',
        'a[href*="http"]:not([href*="pagesjaunes"]):not([href*="solocal"]):not([href*="audit-digital"])',
        'a.SITE_EXTERNE',
        'a[href^="http"]:not([href*="pagesjaunes"]):not([href*="solocal"])'
    ],
    cookieLabels: [
        'Accepter la collecte de vos données',
        'Tout accepter', 'Accepter', 'J\'accepte', 'Accept all', 'Agree'
    ]
};

// Fonctions utilitaires
function sanitizeUrl(u) {
    try {
        const url = new URL(u.startsWith('http') ? u : `https://${u}`);
        ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(k=>url.searchParams.delete(k));
        return url.toString();
    } catch { return ''; }
}

const normalizePhone = s => s.replace(/[^\d+]/g,'')
    .replace(/^(\+33|0033)/,'0')
    .replace(/^0(\d{9})$/, '$1'); // 10 digits sans espace

async function gotoWithRetry(page, url, attempts = 3) {
    let lastErr;
    for (let i=0;i<attempts;i++) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
            return;
        } catch (e) {
            lastErr = e;
            await new Promise(r => setTimeout(r, 800 * (i+1)));
        }
    }
    throw lastErr;
}

async function acceptCookies(page) {
    // check main frame
    for (const label of SELECTORS.cookieLabels) {
        const btn = await page.$(`button[aria-label="${label}"], button:has-text("${label}")`).catch(()=>null);
        if (btn) { await btn.click(); return true; }
    }
    // check iframes
    for (const frame of page.frames()) {
        for (const label of SELECTORS.cookieLabels) {
            const btn = await frame.$(`button[aria-label="${label}"], button:has-text("${label}")`).catch(()=>null);
            if (btn) { await btn.click(); return true; }
        }
    }
    return false;
}

async function getDetailLinksOnPage(page) {
    const links = await page.$$eval('li.bi', (items) => {
        const selectors = [
            'a.bi-denomination.pj-link',
            '.bi-header-title a',
            '.bi-content a[href*="/pros/"]',
            'a[href*="/pros/"]',
            'a[href*="detail"]',
        ];
        const out = [];
        for (const li of items) {
            let href = '';
            for (const sel of selectors) {
                const a = li.querySelector(sel);
                if (a && a.href) { href = a.href; break; }
            }
            if (href) out.push(href);
        }
        // uniques + seulement /pros/
        return [...new Set(out)].filter(u => /\/pros\//.test(u) && !/chercherlespros|recherche/.test(u));
    });
    return links;
}

// Nouvelle fonction pour extraire les informations d'une page
async function extractInfoFromPage(page) {
    // D'abord, essayer de cliquer sur le bouton "Afficher le N°" si nécessaire
    try {
        const showNumberBtn = await page.$(SELECTORS.showNumberBtn);
        if (showNumberBtn) {
            await showNumberBtn.click();
            console.log('Bouton "Afficher le N°" cliqué');
            // Attendre que les numéros apparaissent (timeout réduit)
            await page.waitForSelector('.coord-numero', { timeout: 1500 }).catch(() => {});
        }
    } catch (error) {
        console.log('Pas de bouton "Afficher le N°" trouvé ou erreur lors du clic');
    }

    const info = await page.evaluate(() => {
        const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
        const getManyText = (sels) => {
            for (const s of sels) {
                const el = document.querySelector(s);
                if (el) return (el.textContent || '').trim();
            }
            return '';
        };

        const raw = {
            name: text('div.bi-content h3') || '',
            address: text('div.bi-content > div:nth-child(2)'),
            // phones
            phones: Array.from(document.querySelectorAll(
                '.coord-numero, .number-contact span, .bi-ctas .btn_tel + span, span[aria-label*="numéro"], .contact-info span, .phone-number, .coord-liste-numero span'
            )).map(el => el.textContent?.trim() || ''),
            // website
            website: (() => {
                const sels = [
                    'a.MINISITE.pj-link',
                    'a[class*="MINISITE"]',
                    'a.SITE_EXTERNE',
                    'a[href^="http"]'
                ];
                for (const s of sels) {
                    const a = document.querySelector(s);
                    const href = a?.getAttribute('href') || '';
                    const txt = a?.textContent?.trim() || '';
                    const cand = href || txt;
                    if (cand && !/pagesjaunes|solocal|audit-digital|pjstats/.test(cand)) return cand;
                }
                for (const span of document.querySelectorAll('span.value')) {
                    const v = span.textContent?.trim() || '';
                    if (v && /https?:\/\/|www\./i.test(v) && !/pagesjaunes|solocal|audit-digital/.test(v)) return v;
                }
                return '';
            })(),
            email: (() => {
                const el = document.querySelector('a[href^="mailto:"], .email');
                const href = el?.getAttribute('href') || '';
                const t = el?.textContent?.trim() || '';
                return (href.startsWith('mailto:') ? href.slice(7) : t) || '';
            })(),
            additional: (() => {
                const out = [];
                const d = text('.bi-desc'); if (d) out.push(`Description: ${d}`);
                const a = text('.bi-activity-unit-small'); if (a) out.push(`Activité: ${a}`);
                const stars = text('.bi-stars .rating'); const avis = text('.bi-stars .nbAvis');
                if (stars || avis) out.push(`Avis: ${stars} ${avis}`.trim());
                return out.join(' | ');
            })(),
        };

        // fallback: name via URL ou title
        if (!raw.name) {
            const url = location.href;
            const m = url.match(/\/pros\/([^/?#]+)/);
            if (m?.[1]) raw.name = decodeURIComponent(m[1]).replace(/\+/g,' ').trim();
            if (!raw.name) {
                const t = document.title.replace(/ - PagesJaunes| \| PagesJaunes/i,'').trim();
                if (t && !/PagesJaunes/i.test(t)) raw.name = t;
            }
        }

        return raw;
    });

    const cleanSpaces = s => (s || '').replace(/\s+/g,' ').trim();

    return {
        name: cleanSpaces(info.name) || 'Nom non trouvé',
        address: cleanSpaces(info.address) || 'Adresse non trouvée',
        phone: [...new Set(info.phones.map(normalizePhone).filter(p => /^0[1-9]\d{8}$/.test(p)) )].join('; ') || 'Numéro non trouvé',
        website: sanitizeUrl(cleanSpaces(info.website)) || 'Site web non trouvé',
        email: cleanSpaces(info.email) || 'Email non trouvé',
        additionalInfo: cleanSpaces(info.additional),
    };
}

export default async function Pages_jaunes(object, city, fileName) {
    // Validation du nom de fichier pour éviter l'erreur EISDIR
    if (!fileName || fileName.trim() === '') {
        throw new Error('Le nom de fichier ne peut pas être vide');
    }

    // Ajouter le suffixe .csv immédiatement
    if (!fileName.endsWith('.csv')) {
        fileName += '.csv';
    }
    const csvPath = path.join(__dirname, fileName);
    const dedupPath = path.join(__dirname, fileName.replace(/\.csv$/, '.seen.json'));

    // Afficher les paramètres de recherche
    console.log('\n🚀 DÉMARRAGE DU SCRAPING:');
    console.table({
        'Objet recherché': object,
        'Ville/Région': city,
        'Fichier de sortie': fileName,
        'Fichier de déduplication': dedupPath
    });

    let pageNbr = 1;
    let totalProcessed = 0; // Compteur global d'entreprises traitées

    // Set pour garder en mémoire les entreprises déjà traitées
    const processedCompanies = new Set();
    const processedUrls = new Set();

    // Charger les entreprises déjà traitées depuis le fichier JSON
    try {
        if (fs.existsSync(dedupPath)) {
            const seenData = JSON.parse(fs.readFileSync(dedupPath, 'utf8'));
            processedCompanies.add(...seenData);
            console.log(`📂 Chargement de ${processedCompanies.size} entreprises déjà traitées depuis le fichier existant.`);
        }
    } catch (error) {
        console.log('Erreur lors du chargement des entreprises existantes:', error.message);
    }

    // Taille du batch pour traiter les entreprises
    const poolSize = 2; // Réduit de 5 à 2 pour éviter la surcharge

    // Fonction pour normaliser le nom d'entreprise (supprimer accents, espaces, etc.)
    function normalizeCompanyName(name, address = '') {
        let normalized = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
            .replace(/[^a-z0-9\s]/g, '') // Garder lettres, chiffres et espaces
            .replace(/\s+/g, ' ') // Remplacer les espaces multiples par un seul
            .trim();

        // Supprimer les suffixes juridiques fréquents
        normalized = normalized.replace(/\b(sarl|eurl|sas|sa|sasu|sci|scp|scop|autoentrepreneur|ae)\b/g, '').trim();

        // Si le nom est très court ou générique, inclure une partie de l'adresse
        if (normalized.length <= 4 || /^(sarl|eurl|sas|sa|btp|entreprise|artisan|societe)$/.test(normalized)) {
            const normalizedAddress = address
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            // Extraire le code postal ou la ville de l'adresse si disponible
            const postcodeMatch = normalizedAddress.match(/\b\d{5}\b/); // Code postal
            const cityMatch = normalizedAddress.match(/\b([a-z-]+)\s+\d{5}\b/); // Ville avant code postal

            let addressPart = '';
            if (postcodeMatch) {
                addressPart = postcodeMatch[0];
            } else if (cityMatch) {
                addressPart = cityMatch[1];
            }

            if (addressPart) {
                normalized = `${normalized}_${addressPart}`; // Concaténer avec une partie de l'adresse
            }
        }
        return normalized;
    }

    let totalResults = 0; // Déclarer totalResults ici, si ce n'est pas déjà fait

    const csvWriter = createObjectCsvWriter({
        path: csvPath,
        header: [
            { id: 'name', title: 'Name' },
            { id: 'address', title: 'Address' },
            { id: 'phone', title: 'Phone' },
            { id: 'website', title: 'Website' },
            { id: 'email', title: 'Email' },
            { id: 'additionalInfo', title: 'Additional Info' }
        ],
        append: true
    });

    const browser = await puppeteer.launch({
        headless: false,
        protocolTimeout: 120000, // Augmenter le timeout
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    });

    // Créer un pool de pages directement depuis le navigateur
    const pagesPool = [];
    for (let i = 0; i < poolSize; i++) {
        const page = await browser.newPage();
        // Définir les timeouts par défaut
        page.setDefaultTimeout(25000);
        page.setDefaultNavigationTimeout(40000);
        
        // Bloquer les ressources lourdes
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image','font','media','stylesheet'].includes(type)) req.abort();
            else req.continue();
        });
        
        // Affichage des logs du navigateur
        page.on('console', msg => console.log('[browser]', msg.text()));
        
        pagesPool.push(page);
    }
    let currentPageIndex = 0;

    try {
        const page = await browser.newPage(); // Utiliser le navigateur principal
        page.setDefaultTimeout(25000);
        page.setDefaultNavigationTimeout(40000);
        
        // Bloquer les ressources lourdes
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image','font','media','stylesheet'].includes(type)) req.abort();
            else req.continue();
        });
        
        // Affichage des logs du navigateur
        page.on('console', msg => console.log('[browser]', msg.text()));

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0');

        console.log('Accès à la page de PagesJaunes...');
        await gotoWithRetry(page, 'https://www.pagesjaunes.fr/');

        // Attendre un peu que la page se charge complètement
        await delayShort();
        console.log('Page chargée, attente de la popup de cookies...');

        // Gestion des cookies avec la nouvelle fonction
        console.log('Tentative de gestion des cookies...');
        try {
            await acceptCookies(page);
            console.log('Gestion des cookies terminée.');
        } catch (error) {
            console.log('Aucune popup de cookies détectée ou déjà gérée.');
            console.log('Erreur détaillée:', error.message);
        }

        await page.type('#ou', city);
        await delayShort();
        await page.type('#quoiqui', object);
        await delayShort();

        // Ajouter des logs pour diagnostiquer la soumission de recherche
        console.log('🔍 Vérification avant soumission de recherche...');
        console.log('Ville saisie:', city);
        console.log('Objet saisi:', object);
        
        // Vérifier si les champs sont bien remplis
        const villeValue = await page.$eval('#ou', el => el.value);
        const objetValue = await page.$eval('#quoiqui', el => el.value);
        console.log('Valeur du champ ville:', villeValue);
        console.log('Valeur du champ objet:', objetValue);
        
        // Vérifier si le bouton de recherche existe
        const searchButton = await page.$('#findId');
        if (searchButton) {
            console.log('✅ Bouton de recherche trouvé');
            const buttonText = await page.$eval('#findId', el => el.textContent || el.innerText || '');
            console.log('Texte du bouton:', buttonText);
        } else {
            console.log('❌ Bouton de recherche non trouvé avec #findId');
            // Essayer d'autres sélecteurs
            const alternativeButtons = await page.$$('button[type="submit"], input[type="submit"], .search-button, .btn-search');
            console.log('Boutons alternatifs trouvés:', alternativeButtons.length);
        }

        console.log('🖱️ Tentative de clic sur le bouton de recherche...');
        await page.click('#findId');
        console.log('Recherche soumise...');
        
        // Attendre un peu plus longtemps pour la navigation
        console.log('⏳ Attente de la navigation...');
        await delay(3000, 5000);
        
        console.log('URL après clic:', await page.url());
        
        // Si l'URL n'a pas changé, essayer de soumettre le formulaire directement
        const currentUrl = await page.url();
        if (currentUrl === 'https://www.pagesjaunes.fr/' || currentUrl.includes('pagesjaunes.fr/')) {
            console.log('⚠️ URL inchangée, tentative de soumission de formulaire alternative...');
            try {
                await page.evaluate(() => {
                    const form = document.querySelector('form');
                    if (form) {
                        console.log('Soumission du formulaire...');
                        form.submit();
                    }
                });
                await delay(3000, 5000);
                console.log('URL après soumission alternative:', await page.url());
            } catch (error) {
                console.log('❌ Erreur lors de la soumission alternative:', error.message);
            }
        }
        
        await delayPageChange();

        // Ajouter des logs détaillés pour diagnostiquer
        console.log('🔍 Vérification de la page après soumission...');
        console.log('URL actuelle:', await page.url());
        
        // Attendre et vérifier le contenu de la page
        await delay(2000, 3000);
        
        try {
            const pageTitle = await page.title();
            console.log('📄 Titre de la page:', pageTitle);
            
            // Vérifier si on est sur une page de résultats
            const hasResults = await page.evaluate(() => {
                return document.querySelector('li.bi') !== null || 
                       document.querySelector('.bi-list') !== null ||
                       document.querySelector('.search-results') !== null;
            });
            console.log('📋 Page contient des résultats:', hasResults);
            
            // Vérifier si on est sur une page de désambiguïsation
            const isDisambiguation = await page.evaluate(() => {
                return document.querySelector('h1.title-1') !== null && 
                       document.querySelector('h1.title-1').innerText.includes('PagesJaunes vous propose');
            });
            console.log('🤔 Page de désambiguïsation:', isDisambiguation);
            
            // Vérifier s'il y a des messages d'erreur
            const errorMessages = await page.evaluate(() => {
                const errorElements = document.querySelectorAll('.error, .alert, .message-error');
                return Array.from(errorElements).map(el => el.textContent.trim());
            });
            if (errorMessages.length > 0) {
                console.log('❌ Messages d\'erreur trouvés:', errorMessages);
            }
            
        } catch (error) {
            console.log('❌ Erreur lors de la vérification de la page:', error.message);
        }

        // Nouvelle logique pour gérer la page de désambiguïsation
        let isDisambiguationPage = false;
        try {
            isDisambiguationPage = await page.evaluate(() => {
                return document.querySelector('h1.title-1') && document.querySelector('h1.title-1').innerText.includes('PagesJaunes vous propose');
            });
        } catch (error) {
            console.log('Erreur lors de la vérification de la page de désambiguïsation, continuation...');
            isDisambiguationPage = false;
        }

        if (isDisambiguationPage) {
            console.log('Page de désambiguïsation détectée, tentative de sélection de la ville...');
            try {
                // Essayer de cliquer sur le lien correspondant à la ville recherchée
                const clicked = await page.evaluate((expectedCity) => {
                    const links = Array.from(document.querySelectorAll('.results-text-loc a'));
                    const targetLink = links.find(link => link.innerText.includes(expectedCity));
                    if (targetLink) {
                        targetLink.click();
                        return true;
                    }
                    return false;
                }, city); // 'city' est la variable passée à la fonction evaluate

                if (clicked) {
                    await delayPageChange(); // Attendre la navigation après le clic
                    console.log('Clic sur la ville de désambiguïsation réussi.');
                } else {
                    console.log('Lien de ville spécifique non trouvé, tentative de clic sur le premier lien de localité...');
                    await page.click('.results-text-loc a'); // Clique sur le premier lien de localité
                    await delayPageChange();
                    console.log('Clic sur le premier lien de localité réussi.');
                }
            } catch (error) {
                console.error('Erreur lors de la sélection de la ville sur la page de désambiguïsation :', error);
                console.log('Impossible de cliquer sur un lien de localité, poursuite sans action spécifique.');
            }
        }

        const allData = [];
        let hasNextPage = true;
        const maxPages = 50; // Garde-fou pour éviter les boucles infinies

        while (hasNextPage && pageNbr <= maxPages) {
            console.log(`\n🔄 DÉBUT DU TRAITEMENT DE LA PAGE ${pageNbr}`);
            console.log('URL actuelle:', await page.url());
            
            // Attendre que les résultats se chargent avec les nouveaux sélecteurs
            try {
                console.log('⏳ Attente des résultats de recherche...');
                await page.waitForSelector('li.bi', { visible: true, timeout: 25000 });
                console.log('✅ Résultats trouvés avec sélecteur li.bi');
            } catch (error) {
                console.log('❌ Sélecteur li.bi non trouvé, tentative avec .bi-denomination...');
                try {
                    await page.waitForSelector('.bi-denomination', { visible: true, timeout: 25000 });
                    console.log('✅ Résultats trouvés avec sélecteur .bi-denomination');
                } catch (error2) {
                    console.log('❌ Sélecteur .bi-denomination non trouvé, tentative avec a[href*="/pros/"]...');
                    try {
                        await page.waitForSelector('a[href*="/pros/"]', { visible: true, timeout: 25000 });
                        console.log('✅ Résultats trouvés avec sélecteur a[href*="/pros/"]');
                    } catch (error3) {
                        console.log('❌ Aucun sélecteur de résultats trouvé, arrêt du traitement');
                        console.log('URL finale:', await page.url());
                        console.log('Titre de la page:', await page.title());
                        break;
                    }
                }
            }

            await delayShort();
            console.log('Résultats de recherche chargés.');

            // Extraire le nombre total de résultats
            try {
                const totalResultsText = await page.evaluate(() => {
                    // Chercher le nombre de résultats dans différents sélecteurs
                    const selectors = [
                        '#SEL-nbresultat',
                        '.pjts_nbresultat span',
                        '.denombrement span',
                        '[class*="nbresultat"]',
                        '[id*="nbresultat"]',
                        '.search-results-label strong',
                        '.number-of-results' // Le sélecteur que tu as suggéré
                    ];

                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            return element.textContent; // Retourner le texte directement pour traitement externe
                        }
                    }
                    return null; // Aucun élément trouvé
                });

                if (totalResultsText) {
                    const match = totalResultsText.match(/\d[\d\s]*/g);
                    if (match && match.length > 0) {
                        totalResults = parseInt(match[0].replace(/\s/g, ''), 10);
                        console.log(`Nombre total de résultats trouvés: ${totalResults}`);
                    } else {
                        console.log('Le texte du nombre de résultats ne contient pas de chiffres.');
                    }
                } else {
                    console.log('Aucun élément de nombre de résultats trouvé.');
                }
            } catch (error) {
                console.error('Erreur lors de l\'extraction du nombre de résultats :', error.message);
            }

            // Vérifier que nous sommes bien sur une page de résultats
            let isResultsPage = false;
            try {
                isResultsPage = await page.evaluate(() => {
                    return document.querySelector('.bi-list') !== null ||
                           document.querySelector('li.bi') !== null ||
                           document.querySelector('.search-results') !== null ||
                           window.location.href.includes('/recherche') ||
                           window.location.href.includes('/chercherlespros');
                });
            } catch (error) {
                console.log('Erreur lors de la vérification de la page de résultats, continuation...');
                isResultsPage = true; // On continue par défaut
            }

            if (!isResultsPage) {
                console.log('Pas sur une page de résultats, arrêt du traitement.');
                break;
            }

            // Traiter les entreprises directement depuis la page de liste pour plus de stabilité
            console.log('🔍 Extraction des informations depuis la page de liste...');
            
            try {
                // Extraire les informations directement depuis la page de liste
                const companiesInfo = await page.evaluate(() => {
                    const companies = [];
                    const listings = document.querySelectorAll('li.bi');
                    
                    console.log(`Nombre de listings trouvés: ${listings.length}`);
                    
                    listings.forEach((listing, index) => {
                        try {
                            const info = {
                                name: '',
                                address: '',
                                phone: '',
                                website: '',
                                email: '',
                                additionalInfo: '',
                                detailUrl: ''
                            };
                            
                            // Debug: afficher la structure HTML du premier listing
                            if (index === 0) {
                                console.log('Structure HTML du premier listing:', listing.innerHTML);
                            }
                            
                            // Nom de l'entreprise - essayer plusieurs sélecteurs
                            let nameElement = listing.querySelector('.bi-denomination, .bi-header-title, h3 a, .bi-content h3');
                            if (!nameElement) {
                                // Essayer d'autres sélecteurs
                                nameElement = listing.querySelector('h3, .bi-header, .bi-title, a[href*="/pros/"]');
                            }
                            
                            if (nameElement) {
                                // Nettoyer le nom en supprimant les éléments parasites
                                let name = nameElement.textContent.trim();
                                // Supprimer les éléments "En savoir plus", "Ouvrir la tooltip", etc.
                                name = name.replace(/En savoir plus.*$/g, '')
                                         .replace(/Ouvrir la tooltip.*$/g, '')
                                         .replace(/Contenu édité par le professionnel.*$/g, '')
                                         .replace(/\s+/g, ' ')
                                         .trim();
                                info.name = name;
                                
                                if (index === 0) {
                                    console.log('Nom trouvé:', name);
                                }
                            } else {
                                if (index === 0) {
                                    console.log('Aucun nom trouvé pour le premier listing');
                                }
                            }
                            
                            // Adresse - sélecteurs plus précis
                            const addressElement = listing.querySelector('.bi-adresse, .address, .bi-content .bi-adresse, .bi-content > div:nth-child(2)');
                            if (addressElement) {
                                let address = addressElement.textContent.trim();
                                // Supprimer les éléments parasites
                                address = address.replace(/Ecrire un avis.*$/g, '')
                                               .replace(/avis.*$/g, '')
                                               .replace(/\s+/g, ' ')
                                               .trim();
                                info.address = address;
                            }
                            
                            // Téléphone - sélecteurs plus précis
                            const phoneElements = listing.querySelectorAll('.coord-numero, .number-contact span, .phone-number, .bi-coord .coord-numero');
                            const phones = [];
                            phoneElements.forEach(el => {
                                const phone = el.textContent.trim();
                                // Validation plus stricte des numéros de téléphone
                                if (/^0[1-9]\d{8}$/.test(phone.replace(/\s/g, ''))) {
                                    phones.push(phone);
                                }
                            });
                            info.phone = phones.join('; ');
                            
                            // Site web - sélecteurs plus précis
                            const websiteElement = listing.querySelector('a[href*="http"]:not([href*="pagesjaunes"]):not([href*="solocal"]):not([href*="mailto"])');
                            if (websiteElement) {
                                info.website = websiteElement.href;
                            }
                            
                            // Email - sélecteurs plus précis
                            const emailElement = listing.querySelector('a[href^="mailto:"], .email, .bi-coord a[href^="mailto:"]');
                            if (emailElement) {
                                info.email = emailElement.href.replace('mailto:', '') || emailElement.textContent.trim();
                            }
                            
                            // Informations supplémentaires - sélecteurs plus précis
                            const additionalElements = listing.querySelectorAll('.bi-desc, .bi-activity-unit-small, .bi-stars, .bi-content .bi-desc');
                            const additional = [];
                            additionalElements.forEach(el => {
                                const text = el.textContent.trim();
                                if (text && !text.includes('En savoir plus') && !text.includes('Ouvrir la tooltip')) {
                                    additional.push(text);
                                }
                            });
                            info.additionalInfo = additional.join(' | ');
                            
                            // Lien vers la page de détail
                            const detailLink = listing.querySelector('a[href*="/pros/"]');
                            if (detailLink) {
                                info.detailUrl = detailLink.href;
                            }
                            
                            companies.push(info);
                        } catch (error) {
                            console.log(`Erreur lors de l'extraction de l'entreprise ${index}:`, error.message);
                        }
                    });
                    
                    return companies;
                });
                
                // Traiter les entreprises extraites
                for (const companyInfo of companiesInfo) {
                    // Debug: afficher les données extraites pour les premières entreprises
                    if (allData.length < 3) {
                        console.log('Données extraites:', companyInfo);
                    }
                    
                    // Vérifier que l'entreprise a un nom valide
                    if (!companyInfo.name || 
                        companyInfo.name === 'Nom non trouvé' || 
                        companyInfo.name.length < 2) {
                        console.log('❌ Entreprise sans nom valide, passage à la suivante');
                        continue;
                    }
                    
                    // Vérifier si cette entreprise a déjà été traitée
                    const normalizedName = normalizeCompanyName(companyInfo.name, companyInfo.address);
                    if (processedCompanies.has(normalizedName)) {
                        console.log(`Entreprise déjà traitée, passage à la suivante: ${companyInfo.name}`);
                        continue;
                    }
                    
                    // Ajouter l'entreprise aux ensembles de suivi
                    processedCompanies.add(normalizedName);
                    if (companyInfo.detailUrl) {
                        processedUrls.add(companyInfo.detailUrl);
                    }
                    
                    // Nettoyer les données
                    const cleanSpaces = s => (s || '').replace(/\s+/g,' ').trim();
                    
                    // Fonction de nettoyage plus intelligente
                    const cleanData = (value, defaultValue) => {
                        if (!value || value === defaultValue) return defaultValue;
                        
                        // Nettoyer les éléments parasites
                        let cleaned = value.replace(/En savoir plus.*$/g, '')
                                         .replace(/Ouvrir la tooltip.*$/g, '')
                                         .replace(/Contenu édité par le professionnel.*$/g, '')
                                         .replace(/Ecrire un avis.*$/g, '')
                                         .replace(/\s+/g, ' ')
                                         .trim();
                        
                        // Si après nettoyage c'est vide, retourner la valeur par défaut
                        return cleaned || defaultValue;
                    };
                    
                    const info = {
                        name: cleanData(companyInfo.name, 'Nom non trouvé'),
                        address: cleanData(companyInfo.address, 'Adresse non trouvée'),
                        phone: cleanData(companyInfo.phone, 'Numéro non trouvé'),
                        website: cleanData(sanitizeUrl(companyInfo.website), 'Site web non trouvé'),
                        email: cleanData(companyInfo.email, 'Email non trouvé'),
                        additionalInfo: cleanData(companyInfo.additionalInfo, '')
                    };
                    
                    console.log(`✅ Entreprise traitée: ${info.name}`);
                    allData.push(info);
                    totalProcessed++;
                    
                    // Afficher les 3 premiers résultats avec console.table
                    if (allData.length > 0 && allData.length <= 3) {
                        console.log('\n📋 PREMIERS RÉSULTATS:');
                        console.table(allData.slice(0, 3));
                    }
                    
                    // Écrire les données par petits lots
                    if (allData.length >= 10) {
                        const batchToWrite = allData.splice(0, allData.length);
                        await csvWriter.writeRecords(batchToWrite);
                        console.log(`💾 Écriture de ${batchToWrite.length} enregistrements dans le CSV (batch).`);
                    }
                    
                    // Afficher le progrès
                    if (typeof totalResults === 'number' && totalResults > 0) {
                        const percentage = Math.round((totalProcessed/totalResults)*100);
                        console.log(`📈 Progrès: ${totalProcessed}/${totalResults} entreprises (${percentage}%)`);
                    } else {
                        console.log(`📈 Total traité jusqu'ici: ${totalProcessed} entreprises`);
                    }
                }
                
            } catch (extractionError) {
                console.error('❌ Erreur lors de l\'extraction depuis la page de liste:', extractionError.message);
            }

            // Sauvegarder les entreprises traitées dans le fichier JSON
            try {
                fs.writeFileSync(dedupPath, JSON.stringify([...processedCompanies]), 'utf8');
                console.log(`💾 Sauvegarde de ${processedCompanies.size} entreprises traitées dans ${dedupPath}`);
            } catch (error) {
                console.log('Erreur lors de la sauvegarde des entreprises traitées:', error.message);
            }

            // === ⏭️ Tentative de passer à la page suivante avec vérification ===
            console.log('🔄 Tentative de pagination…');
            
            try {
                const nextBtn =
                  await page.$('#pagination-next') ??
                  await page.$('a[rel="next"]')   ??
                  await page.$('button[data-pagination="next"]');

                if (!nextBtn) {
                  console.log('⛔ Pas de bouton suivant → fin.');
                  hasNextPage = false;
                } else {
                  // Vérifier le changement d'URL pour s'assurer que la navigation a fonctionné
                  const prevUrl = page.url();
                  
                  // 1) Armer l'attente de navigation
                  const navPromise = page.waitForNavigation({waitUntil:'domcontentloaded', timeout: 40000});

                  // 2) Cliquer
                  await nextBtn.click();

                  // 3) Attendre la navigation
                  await navPromise;

                  // 4) Vérifier qu'on a bien de nouveaux résultats
                  if (page.url() === prevUrl) {
                      console.log('⚠️ Navigation échouée, URL identique après clic');
                      hasNextPage = false;
                  } else {
                      await page.waitForSelector('li.bi', {visible: true, timeout: 25000});
                      pageNbr++;
                      console.log(`✅ Page ${pageNbr} chargée`);
                  }
                }
            } catch (paginationError) {
                console.error('❌ Erreur lors de la pagination:', paginationError.message);
                
                // Si c'est une erreur de page détachée, arrêter la pagination
                if (paginationError.message.includes('detached Frame') || 
                    paginationError.message.includes('Protocol error')) {
                    console.log('⚠️ Page principale détachée, arrêt de la pagination');
                    hasNextPage = false;
                }
            }
        }

        if (allData.length > 0) {
            await csvWriter.writeRecords(allData);
            console.log('💾 Écriture des derniers enregistrements dans le CSV.');
            allData.length = 0; // Vider le tableau après écriture
        }

        // Afficher un résumé final structuré
        console.log('\n🎉 SCRAPING TERMINÉ:');
        console.table({
            'Pages traitées': pageNbr,
            'Entreprises trouvées': totalProcessed,
            'Total estimé': totalResults || 'Non déterminé',
            'Pourcentage traité': totalResults ? `${Math.round((totalProcessed/totalResults)*100)}%` : 'N/A',
            'Fichier CSV': fileName,
            'Fichier de déduplication': dedupPath
        });

        console.log(`✅ Données collectées et écrites dans le fichier ${fileName} avec succès.`);
        if (typeof totalResults === 'number' && totalResults > 0) {
            console.log(`📊 Progrès final: ${totalProcessed}/${totalResults} entreprises (${Math.round((totalProcessed/totalResults)*100)}%)`);
        } else {
            console.log(`📊 Total final d'entreprises traitées: ${totalProcessed}`);
            if (!totalResults) {
                console.warn('⚠️ Impossible de déterminer le nombre total d\'entreprises. Le sélecteur a peut-être changé.');
            }
        }

    } catch (error) {
        console.error('Erreur dans le processus :', error);
        
        // Si c'est une erreur de connexion, essayer de redémarrer le navigateur
        if (error.message.includes('Connection closed') || error.message.includes('Protocol error')) {
            console.log('🔄 Tentative de redémarrage du navigateur...');
            try {
                if (browser && !browser.isConnected()) {
                    await browser.close();
                }
                
                const newBrowser = await puppeteer.launch({
                    headless: false,
                    protocolTimeout: 120000,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ]
                });
                
                console.log('✅ Navigateur redémarré avec succès');
                return await Pages_jaunes(object, city, fileName); // Relancer le scraping
            } catch (restartError) {
                console.error('❌ Impossible de redémarrer le navigateur:', restartError.message);
            }
        }
    } finally {
        // Fermer toutes les pages du pool
        for (const p of pagesPool) {
            if (!p.isClosed()) {
                try {
                    await p.close();
                } catch (closeError) {
                    console.log('⚠️ Erreur lors de la fermeture d\'une page du pool:', closeError.message);
                }
            }
        }
        
        // Fermer le navigateur principal
        if (browser && !browser.isConnected()) {
            try {
                await browser.close();
                console.log('Navigateur fermé.');
            } catch (closeError) {
                console.log('⚠️ Erreur lors de la fermeture du navigateur:', closeError.message);
            }
        }
    }
}
