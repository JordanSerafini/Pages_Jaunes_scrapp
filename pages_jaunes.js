import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
puppeteer.use(StealthPlugin());

const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
const delayShort = () => delay(200, 400); // Augmenté de 150-300 à 200-400ms pour plus de stabilité
const delayPageChange = () => delay(600, 800); // Augmenté de 400-600 à 600-800ms pour plus de stabilité

// Nouvelle fonction pour extraire les informations d'une page
async function extractInfoFromPage(page) {
            // D'abord, essayer de cliquer sur le bouton "Afficher le N°" si nécessaire
        try {
            const showNumberBtn = await page.$('button[aria-label*="Afficher le N°"]');
            if (showNumberBtn) {
                await showNumberBtn.click();
                console.log('Bouton "Afficher le N°" cliqué');
                // Attendre que les numéros apparaissent (timeout réduit)
                await page.waitForSelector('.coord-numero', { timeout: 1500 }).catch(() => {});
            }
        } catch (error) {
            console.log('Pas de bouton "Afficher le N°" trouvé ou erreur lors du clic');
        }

    const companyInfo = await page.evaluate(() => {
        const info = {
            name: '',
            address: '',
            phone: '',
            website: '',
            email: '',
            additionalInfo: ''
        };

        // Nom de l'entreprise - utiliser le sélecteur précis
        const nameElement = document.querySelector('div.bi-content h3');
        if (nameElement) {
            const name = nameElement.innerText.trim();
            if (name &&
                !name.includes('à') &&
                !name.includes('Bâtiment') &&
                !name.includes('PagesJaunes') &&
                name.length > 3 &&
                name.length < 100 &&
                !/^\\d+$/.test(name)) { // Vérifier que ce n'est pas juste des chiffres
                info.name = name;
                console.log(`Nom trouvé: ${name}`);
            }
        }

        // 2. Si pas de nom fiable de h3, essayer de le récupérer depuis l'URL
        if (!info.name) {
            const url = window.location.href;
            // Prefer extracting segment after /pros/ if it looks like a name
            const urlNameMatch = url.match(/\/pros\/([^/?#]+)/);
            if (urlNameMatch && urlNameMatch[1]) {
                const potentialName = decodeURIComponent(urlNameMatch[1]).replace(/\+/g, ' ').trim();
                // Ensure it's not a numeric ID or common path segment
                if (potentialName &&
                    !/^\\d+$/.test(potentialName) && // Not just numbers
                    !potentialName.includes('code_etablissement=') &&
                    !potentialName.includes('detail') &&
                    !potentialName.includes('pros') &&
                    !potentialName.includes('recherche') &&
                    potentialName.length > 3) { // Ensure it's not too short
                    info.name = potentialName;
                    console.log(`Nom trouvé via URL path: ${info.name}`);
                }
            }

            // Fallback to detail?code_etablissement= part if no better name from URL path
            if (!info.name) {
                const detailMatch = url.match(/detail\\?.*?=([^&]+)/);
                if (detailMatch && detailMatch[1]) {
                    const potentialParamValue = decodeURIComponent(detailMatch[1]).replace(/\+/g, ' ').trim();

                    // Check if the potential name from URL parameter is mostly numeric or very short/generic.
                    const digitCount = (potentialParamValue.match(/\\d/g) || []).length;
                    // If it contains more than 50% digits and is longer than 5 chars, or is purely numeric and long enough, it's likely an ID.
                    if (potentialParamValue.length > 5 && (digitCount / potentialParamValue.length > 0.5 || /^\\d{6,}$/.test(potentialParamValue))) {
                         console.log(`Potential name "${potentialParamValue}" from URL param looks like an ID, skipping.`);
                         // Do not set info.name in this case
                    } else if (potentialParamValue && !/^\\d+$/.test(potentialParamValue) && potentialParamValue.length > 3) { // Still keep the original check for purely numeric and ensure length
                        info.name = potentialParamValue;
                        console.log(`Nom trouvé via URL param: ${info.name}`);
                    }
                }
            }
        }

        // 3. Dernière tentative : chercher dans le titre de la page
        if (!info.name) { // Only if still no name
            const title = document.title;
            if (title && !title.includes('PagesJaunes')) {
                const potentialName = title.replace(' - PagesJaunes', '').replace(' | PagesJaunes', '').trim();
                if (potentialName && !potentialName.includes('à') && potentialName.length > 3) { // Exclude generic title and ensure length
                     info.name = potentialName;
                     console.log(`Nom trouvé via titre: ${info.name}`);
                }
            }
        }

        // Final sanity check for name: if it's still a number or too generic after all attempts, reset it
        if (info.name) {
            const normalizedFinalName = info.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
            if (normalizedFinalName.length < 4 || /^\\d+$/.test(normalizedFinalName) || normalizedFinalName.includes('pagesjaunes')) {
                console.log(`Nom final "${info.name}" seems generic/numeric after normalization, resetting.`);
                info.name = ''; // Reset to empty string so 'Nom non trouvé' can be applied by cleanData
            }
        }

        // Adresse - utiliser le sélecteur précis
        const addressElement = document.querySelector('div.bi-content > div:nth-child(2)');
        if (addressElement) {
            let addressText = addressElement.innerText.trim();
            addressText = addressText.replace('Voir le plan', '').trim();
            if (addressText && addressText.length > 5) {
                info.address = addressText;
                console.log(`Adresse trouvée: ${addressText}`);
            }
        }

        // Si pas d'adresse trouvée, essayer le lien "Voir le plan"
        if (!info.address) {
            const planLink = document.querySelector('a[href*="voir-le-plan"]');
            if (planLink) {
                const addressText = planLink.innerText.trim();
                if (addressText && addressText.length > 5) {
                    info.address = addressText;
                    console.log(`Adresse trouvée via lien plan: ${addressText}`);
                }
            }
        }

        // Numéros de téléphone - utiliser le sélecteur précis pour le bouton
        const phoneNumbers = [];

        // Chercher les numéros déjà affichés
        const phoneSelectors = [
            '.coord-numero',
            '.number-contact span',
            '.bi-ctas .btn_tel + span',
            'span[aria-label*="numéro"]',
            '.contact-info span',
            '.phone-number',
            '.coord-liste-numero span'
        ];

        for (const selector of phoneSelectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                const text = el.innerText.trim();
                if (/^(0[1-9])(\\d{8})$/.test(text.replace(/\\s/g, ''))) {
                    phoneNumbers.push(text);
                }
            });
        }

        info.phone = phoneNumbers.join('; ');

        // Site web - utiliser les sélecteurs précis basés sur la structure HTML
        const websiteSelectors = [
            'a.MINISITE.pj-link',
            'a[class*="MINISITE"]',
            'a[href*="http"]:not([href*="pagesjaunes"]):not([href*="solocal"]):not([href*="audit-digital"])',
            'a.SITE_EXTERNE',
            'a[href^="http"]:not([href*="pagesjaunes"]):not([href*="solocal"])'
        ];

        let websiteFound = false;
        for (const selector of websiteSelectors) {
            const websiteElements = document.querySelectorAll(selector);
            for (const element of websiteElements) {
                const href = element.href;
                const text = element.innerText.trim();

                // Vérifier que ce n'est pas un lien PagesJaunes ou Solocal
                if (href &&
                    !href.includes('pagesjaunes') &&
                    !href.includes('solocal.com') &&
                    !href.includes('audit-digital') &&
                    !href.includes('pjstats') &&
                    (href.includes('www') || href.includes('http'))) {

                    info.website = href;
                    console.log(`Site web trouvé avec sélecteur "${selector}": ${href}`);
                    websiteFound = true;
                    break;
                }

                // Si le href n'est pas bon, essayer le texte
                if (text &&
                    !text.includes('pagesjaunes') &&
                    !text.includes('solocal.com') &&
                    !text.includes('audit-digital') &&
                    (text.includes('www') || text.includes('http'))) {

                    info.website = text;
                    console.log(`Site web trouvé via texte avec sélecteur "${selector}": ${text}`);
                    websiteFound = true;
                    break;
                }
            }
            if (websiteFound) break;
        }

        // Fallback: chercher dans les spans avec la classe "value"
        if (!info.website) {
            const valueSpans = document.querySelectorAll('span.value');
            for (const span of valueSpans) {
                const text = span.innerText.trim();
                if (text &&
                    !text.includes('pagesjaunes') &&
                    !text.includes('solocal.com') &&
                    !text.includes('audit-digital') &&
                    (text.includes('www') || text.includes('http'))) {

                    info.website = text;
                    console.log(`Site web trouvé via span.value: ${text}`);
                    break;
                }
            }
        }

        // Email
        const emailElement = document.querySelector('a[href^="mailto:"], .email');
        if (emailElement) {
            const email = emailElement.href.replace('mailto:', '') || emailElement.innerText.trim();
            if (email.includes('@')) {
                info.email = email;
            }
        }

        // Informations supplémentaires - utiliser le sélecteur précis
        const additionalInfo = [];

        // Description de l'entreprise
        const descElement = document.querySelector('.bi-desc');
        if (descElement) {
            const text = descElement.innerText.trim();
            if (text) {
                additionalInfo.push(`Description: ${text}`);
            }
        }

        // Type d'activité
        const activityElement = document.querySelector('.bi-activity-unit-small');
        if (activityElement) {
            const text = activityElement.innerText.trim();
            if (text) {
                additionalInfo.push(`Activité: ${text}`);
            }
        }

        // Avis et étoiles
        const starsElement = document.querySelector('.bi-stars .rating');
        const avisElement = document.querySelector('.bi-stars .nbAvis');
        if (starsElement || avisElement) {
            const stars = starsElement ? starsElement.innerText.trim() : '';
            const avis = avisElement ? avisElement.innerText.trim() : '';
            if (stars || avis) {
                additionalInfo.push(`Avis: ${stars} ${avis}`);
            }
        }

        info.additionalInfo = additionalInfo.join(' | ');

        return info;
    });

    // Nettoyer les données pour éviter les problèmes de format CSV
    const cleanData = (text) => {
        if (!text) return '';
        return text
            .replace(/\\n/g, ' ') // Remplacer les retours à la ligne par des espaces
            .replace(/\\r/g, ' ') // Remplacer les retours chariot par des espaces
            .replace(/\\t/g, ' ') // Remplacer les tabulations par des espaces
            .replace(/\\s+/g, ' ') // Remplacer les espaces multiples par un seul espace
            .trim(); // Supprimer les espaces en début et fin
    };

    return {
        name: cleanData(companyInfo.name) || 'Nom non trouvé',
        address: cleanData(companyInfo.address) || 'Adresse non trouvée',
        phone: cleanData(companyInfo.phone) || 'Numéro non trouvé',
        website: cleanData(companyInfo.website) || 'Site web non trouvé',
        email: cleanData(companyInfo.email) || 'Email non trouvé',
        additionalInfo: cleanData(companyInfo.additionalInfo) || ''
    };
}

export default async function Pages_jaunes(object, city, fileName) {
    // Validation du nom de fichier pour éviter l'erreur EISDIR
    if (!fileName || fileName.trim() === '') {
        throw new Error('Le nom de fichier ne peut pas être vide');
    }

    let pageNbr = 1;
    let totalProcessed = 0; // Compteur global d'entreprises traitées

    // Set pour garder en mémoire les entreprises déjà traitées
    const processedCompanies = new Set();
    const processedUrls = new Set();

    // Fonction pour normaliser le nom d'entreprise (supprimer accents, espaces, etc.)
    function normalizeCompanyName(name, address = '') {
        let normalized = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
            .replace(/[^a-z0-9\\s]/g, '') // Garder lettres, chiffres et espaces
            .replace(/\\s+/g, ' ') // Remplacer les espaces multiples par un seul
            .trim();

        // Si le nom est très court ou générique, inclure une partie de l'adresse
        if (normalized.length <= 4 || /^(sarl|eurl|sas|sa|btp)$/.test(normalized)) {
            const normalizedAddress = address
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\\s]/g, '')
                .replace(/\\s+/g, ' ')
                .trim();

            // Extraire le code postal ou la ville de l'adresse si disponible
            const postcodeMatch = normalizedAddress.match(/\\b\\d{5}\\b/); // Code postal
            const cityMatch = normalizedAddress.match(/\\b([a-z-]+)\\s+\\d{5}\\b/); // Ville avant code postal

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

    // Charger les entreprises déjà traitées depuis le fichier CSV existant
    try {
        const csvPath = path.join(__dirname, fileName);
        if (fs.existsSync(csvPath)) {
            const csvContent = fs.readFileSync(csvPath, 'utf8');
            const lines = csvContent.split('\\n').filter(line => line.trim());

            // Ignorer l'en-tête et charger les noms d'entreprises normalisés
            for (let i = 1; i < lines.length; i++) {
                const columns = lines[i].split(',');
                if (columns[0] && columns[0].trim()) {
                    const normalizedName = normalizeCompanyName(columns[0].trim());
                    processedCompanies.add(normalizedName);
                }
            }

            console.log(`Chargement de ${processedCompanies.size} entreprises déjà traitées depuis le fichier existant.`);
        }
    } catch (error) {
        console.log('Erreur lors du chargement des entreprises existantes:', error.message);
    }

    if (!fileName.endsWith('.csv')) {
        fileName += '.csv';
    }

    const csvWriter = createObjectCsvWriter({
        path: path.join(__dirname, fileName),
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

    try {
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0');
        console.log('Accès à la page de PagesJaunes...');
        await page.goto('https://www.pagesjaunes.fr/', { waitUntil: 'domcontentloaded' });

        // Attendre un peu que la page se charge complètement
        await delayShort();
        console.log('Page chargée, attente de la popup de cookies...');

        // Gestion des cookies
        console.log('Tentative de gestion des cookies...');
        try {
            console.log('Attente de la popup de cookies...');

            // Attendre que la page soit complètement chargée
            await page.waitForFunction(() => document.readyState === 'complete', { timeout: 25000 }); // Timeout augmenté

            // Attendre un peu moins pour que les scripts se chargent
            await delay(100, 200); // Réduit de delayShort() à 100-200ms

            // Essayer plusieurs approches pour trouver le bouton cookie
            let cookieButton = null;

            // 1. Chercher directement dans la page principale
            cookieButton = await page.$('button[aria-label="Accepter la collecte de vos données"]');
            if (cookieButton) {
                console.log('Bouton cookie trouvé dans la page principale');
            }

            // 2. Si pas trouvé, chercher dans les iframes
            if (!cookieButton) {
                console.log('Recherche dans les iframes...');
                const frames = page.frames();
                for (const frame of frames) {
                    try {
                        const frameButton = await frame.$('button[aria-label="Accepter la collecte de vos données"]');
                        if (frameButton) {
                            console.log('Bouton cookie trouvé dans un iframe');
                            cookieButton = frameButton;
                            break;
                        }
                    } catch (e) {
                        console.log('Erreur lors de la recherche dans un iframe:', e.message);
                    }
                }
            }

            // 3. Si toujours pas trouvé, essayer avec un délai
            if (!cookieButton) {
                console.log('Attente supplémentaire pour la popup...');
                await delayShort();
                cookieButton = await page.$('button[aria-label="Accepter la collecte de vos données"]');
            }

            if (cookieButton) {
                console.log('Bouton cookie trouvé, tentative de clic...');
                // Cliquer directement sur le bouton trouvé
                await cookieButton.click();
                console.log('Clic sur le bouton cookie réussi');
                await delayShort();
            } else {
                console.log('On continue sans accepter les cookies.');
            }

            // Le clic a déjà été effectué directement sur le bouton trouvé
            console.log('Gestion des cookies terminée.');
            await delayShort();
            // Mini-test pour iframe lazy-load après le clic initial
            await page.$('button[aria-label*="données"]')?.click().catch(() => console.log('Pas de bouton de cookies lazy-load trouvé ou cliqué.'));


        } catch (error) {
            console.log('Aucune popup de cookies détectée ou déjà gérée.');
            console.log('Erreur détaillée:', error.message);
        }

        await page.type('#ou', city);
        await delayShort();
        await page.type('#quoiqui', object);
        await delayShort();

        await page.click('#findId');
        console.log('Recherche soumise...');
        await delayPageChange();

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

        // Taille du batch pour traiter les entreprises
        const poolSize = 5; // Réduit de 15 à 5 pour limiter la consommation de mémoire

        while (hasNextPage) {
            // Attendre que les résultats se chargent avec les nouveaux sélecteurs
            try {
                await page.waitForSelector('li.bi', { visible: true, timeout: 25000 });
            } catch (error) {
                try {
                    await page.waitForSelector('.bi-denomination', { visible: true, timeout: 25000 });
                } catch (error2) {
                    await page.waitForSelector('a[href*="/pros/"]', { visible: true, timeout: 25000 });
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
                    const match = totalResultsText.match(/\\d[\\d\\s]*/g);
                    if (match && match.length > 0) {
                        totalResults = parseInt(match[0].replace(/\\s/g, ''), 10);
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

            // Récupérer les liens vers les pages de détail en utilisant les nouveaux sélecteurs
            let detailLinks = [];
            try {
                detailLinks = await page.evaluate(() => {
                // Utiliser les nouveaux sélecteurs basés sur la structure HTML actuelle
                const businessListings = document.querySelectorAll('li.bi');
                console.log(`Nombre de listings d'entreprises trouvés: ${businessListings.length}`);

                const links = [];

                businessListings.forEach((listing, index) => {
                    // Chercher le lien principal dans chaque listing
                    let mainLink = null;

                    // Nouveaux sélecteurs basés sur la structure HTML actuelle
                    const linkSelectors = [
                        'a.bi-denomination.pj-link',
                        '.bi-header-title a',
                        '.bi-content a[href*="/pros/"]',
                        'a[href*="/pros/"]',
                        '.bi-clic-mobile a',
                        'a[href*="detail"]'
                    ];

                    for (const selector of linkSelectors) {
                        const linkElement = listing.querySelector(selector);
                        if (linkElement && linkElement.href && linkElement.href.includes('/pros/')) {
                            mainLink = linkElement.href;
                            console.log(`Lien trouvé pour listing ${index + 1} avec sélecteur ${selector}: ${mainLink}`);
                            break;
                        }
                    }

                    // Si aucun lien trouvé, essayer de cliquer sur le div cliquable
                    if (!mainLink) {
                        const clickableDiv = listing.querySelector('.bi-clic-mobile');
                        if (clickableDiv) {
                            // Simuler un clic pour voir si cela génère un lien
                            clickableDiv.click();
                            // Attendre un peu et vérifier si l'URL a changé
                            setTimeout(() => {
                                if (window.location.href.includes('/pros/')) {
                                    mainLink = window.location.href;
                                }
                            }, 100);
                        }
                    }

                    // Dernière tentative : chercher par l'ID de l'élément
                    if (!mainLink) {
                        const listingId = listing.id;
                        if (listingId && listingId.startsWith('bi-')) {
                            const idNumber = listingId.replace('bi-', '');
                            mainLink = `https://www.pagesjaunes.fr/pros/detail?code_etablissement=${idNumber}`;
                            console.log(`Lien généré par ID pour listing ${index + 1}: ${mainLink}`);
                        }
                    }

                    if (mainLink) {
                        links.push(mainLink);
                    } else {
                        console.log(`Aucun lien trouvé pour le listing ${index + 1}`);
                    }
                });

                // Supprimer les doublons
                const uniqueLinks = [];
                const seen = new Set();

                for (const link of links) {
                    if (!seen.has(link)) {
                        seen.add(link);
                        uniqueLinks.push(link);
                    }
                }

                console.log(`Liens uniques trouvés: ${uniqueLinks.length}`);
                return uniqueLinks;
            });
        } catch (error) {
            console.log('Erreur lors de la récupération des liens, utilisation d\'un tableau vide');
            detailLinks = [];
        }

            console.log(`Trouvé ${detailLinks.length} entreprises uniques à traiter sur cette page.`);

            // Afficher les premiers liens pour debug
            if (detailLinks.length > 0) {
                console.log('Premiers liens trouvés (dans l\'ordre d\'affichage):');
                detailLinks.slice(0, 3).forEach((link, index) => {
                    console.log(`  ${index + 1}: ${link}`);
                });
            }

            // Filtrer les liens qui ne sont pas des pages de détail d'entreprise
            const validDetailLinks = detailLinks.filter(link => {
                // Vérifier que c'est un lien vers une page de détail d'entreprise
                const isValidProsLink = (link.includes('/pros/') &&
                                       !link.includes('chercherlespros') &&
                                       !link.includes('recherche') &&
                                       (link.match(/\/pros\/\\d+/) || link.includes('code_etablissement='))); // Accepte les liens avec code_etablissement

                if (!isValidProsLink) {
                    console.log(`Lien filtré: ${link}`);
                }

                return isValidProsLink;
            });

            console.log(`Liens valides trouvés: ${validDetailLinks.length}/${detailLinks.length}`);

            // Traiter les entreprises en ouvrant des onglets depuis la page de liste
            for (let i = 0; i < validDetailLinks.length; i += poolSize) {
                const batch = validDetailLinks.slice(i, i + poolSize);

                const batchResultsPromises = batch.map(async (link) => {
                    // Vérifier si cette URL a déjà été traitée
                    if (processedUrls.has(link)) {

                        console.log(`URL déjà traitée, passage à la suivante: ${link}`);
                        return null;
                    }

                    let newPage = null; // Déclarer et initialiser ici
                    try {

                        newPage = await browser.newPage(); // Assigner ici

                        // Naviguer vers la page de détail
                        await newPage.goto(link, { waitUntil: 'domcontentloaded' });
                        await delayShort();

                        // Attendre un peu plus pour que la page se charge complètement
                        await delay(300, 500);

                        // Vérifier que la page est bien chargée avant d'extraire
                        try {
                            await newPage.waitForSelector('div.bi-content, h1, .bi-denomination', { timeout: 25000 });
                        } catch (error) {
                            console.log('Page de détail pas complètement chargée, tentative d\'extraction...');
                        }

                        // Extraire les informations
                        const info = await extractInfoFromPage(newPage);

                        // Vérifier si cette entreprise a déjà été traitée (par nom normalisé)
                        const normalizedName = normalizeCompanyName(info.name, info.address);
                        if (processedCompanies.has(normalizedName)) {
                            console.log(`Entreprise déjà traitée, passage à la suivante: ${info.name}`);
                            processedUrls.add(link);
                            return null; // Retourner null et laisser le finally gérer la fermeture
                        }

                        // Ajouter l'entreprise normalisée et l'URL aux ensembles de suivi
                        processedCompanies.add(normalizedName);
                        processedUrls.add(link);

                        console.log(`Entreprise traitée via onglet : ${info.name}`);
                        return info;

                    } catch (e) {
                        console.error(`Erreur lors du traitement du lien ${link}:`, e);
                        return null;
                    } finally {
                        // Fermer l'onglet même en cas d'erreur
                        // La page peut être fermée si elle existe
                        // Vérifier si newPage est défini et s'il n'est pas déjà fermé
                        if (newPage && !newPage.isClosed()) {
                            await newPage.close();
                        }
                    }
                });

                const batchResults = await Promise.all(batchResultsPromises);
                const validResults = batchResults.filter(Boolean);
                allData.push(...validResults);
                totalProcessed += validResults.length; // Incrémenter totalProcessed ici

                // Écrire les données par petits lots pour éviter la perte de données
                if (allData.length >= 10) {
                    const batchToWrite = allData.splice(0, allData.length);
                    await csvWriter.writeRecords(batchToWrite);
                    console.log(`Écriture de ${batchToWrite.length} enregistrements dans le CSV (batch).`);
                }

                // Afficher le progrès avec le total si disponible
                if (typeof totalResults === 'number' && totalResults > 0) {
                    console.log(`Progrès: ${totalProcessed}/${totalResults} entreprises (${Math.round((totalProcessed/totalResults)*100)}%)`);
                } else {
                    console.log(`Total traité jusqu'ici: ${totalProcessed} entreprises`);
                }
            }

            // === ⏭️ Tentative de passer à la page suivante ===
            console.log('🔄 Tentative de pagination…');
            const before = await page.$$eval('li.bi', els =>
              els.slice(0,3).map(e => e.textContent.trim())
            );

            const nextBtn =
              await page.$('#pagination-next')              ||
              await page.$('a[rel="next"]');

            if (!nextBtn) {
              console.log('⛔ Pas de bouton suivant → fin.');
              hasNextPage = false;
            } else {
              // 3. Clic réel sur le bouton + surveillance du changement de contenu
              try {
                await Promise.all([
                  nextBtn.click(),
                  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }), // Attendre la navigation
                  page.waitForTimeout(500 + Math.random() * 800) // Petit delay random anti-bot
                ]);

                // 4. Récupérer et afficher le numéro de page courant (si disponible)
                const currentPage = await page.$eval('.pagination .pagination_compteur', el =>
                  el.textContent.trim()
                );
                console.log(`✅ Passage à la ${currentPage}`);
                pageNbr++; // Incrémenter pageNbr après une navigation réussie
              } catch (err) {
                console.warn('⚠️ Pagination échouée ou identique. Tentative de rechargement...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(2000);
                continue; // relance la boucle de scraping
              }
            }
        }

        if (allData.length > 0) {
            await csvWriter.writeRecords(allData);
            console.log('Écriture des derniers enregistrements dans le CSV.');
            allData.length = 0; // Vider le tableau après écriture
        }


        console.log(`Données collectées et écrites dans le fichier ${fileName} avec succès.`);
        if (typeof totalResults === 'number' && totalResults > 0) {
            console.log(`Progrès final: ${totalProcessed}/${totalResults} entreprises (${Math.round((totalProcessed/totalResults)*100)}%)`);
        } else {
            console.log(`Total final d'entreprises traitées: ${totalProcessed}`);
            if (!totalResults) {
                console.warn('⚠️ Impossible de déterminer le nombre total d\'entreprises. Le sélecteur a peut-être changé.');
            }
        }

    } catch (error) {
        console.error('Erreur dans le processus :', error);
    } finally {
        await browser.close();
        console.log('Navigateur fermé.');
    }
}
