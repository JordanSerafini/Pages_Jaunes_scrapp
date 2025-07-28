import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
puppeteer.use(StealthPlugin());

const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
const delayShort = () => delay(300, 600);
const delayPageChange = () => delay(800, 1200);

// Nouvelle fonction pour extraire les informations d'une page
async function extractInfoFromPage(page) {
    // D'abord, essayer de cliquer sur le bouton "Afficher le N°" si nécessaire
    try {
        const showNumberBtn = await page.$('button[aria-label*="Afficher le N°"]');
        if (showNumberBtn) {
            await showNumberBtn.click();
            console.log('Bouton "Afficher le N°" cliqué');
            // Attendre que les numéros apparaissent
            await page.waitForSelector('.coord-numero', { timeout: 3000 }).catch(() => {});
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
                name.length < 100) {
                info.name = name;
                console.log(`Nom trouvé: ${name}`);
            }
        }

        // Si toujours pas de nom trouvé, essayer de le récupérer depuis l'URL
        if (!info.name) {
            const url = window.location.href;
            const match = url.match(/detail\?.*?=([^&]+)/);
            if (match) {
                info.name = decodeURIComponent(match[1]).replace(/\+/g, ' ');
            }
        }

        // Dernière tentative : chercher dans le titre de la page
        if (!info.name || info.name.includes('à')) {
            const title = document.title;
            if (title && !title.includes('PagesJaunes')) {
                info.name = title.replace(' - PagesJaunes', '').replace(' | PagesJaunes', '');
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
                if (/^(0[1-9])(\d{8})$/.test(text.replace(/\s/g, ''))) {
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
            .replace(/\n/g, ' ') // Remplacer les retours à la ligne par des espaces
            .replace(/\r/g, ' ') // Remplacer les retours chariot par des espaces
            .replace(/\t/g, ' ') // Remplacer les tabulations par des espaces
            .replace(/\s+/g, ' ') // Remplacer les espaces multiples par un seul espace
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
    let pageNbr = 1;
    let totalProcessed = 0; // Compteur global d'entreprises traitées

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
        headless: true, 
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

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36');
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
            await page.waitForFunction(() => document.readyState === 'complete');
            
            // Attendre un peu plus pour que les scripts se chargent
            await delayShort();
            
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
                console.log('Aucun bouton cookie trouvé, continuation...');
                return; // Sortir de la fonction si aucun bouton trouvé
            }
            
            // Le clic a déjà été effectué directement sur le bouton trouvé
            console.log('Gestion des cookies terminée.');
            await delayShort();
            
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
        const poolSize = 5;

        while (hasNextPage) {
            // Attendre que les résultats se chargent avec les nouveaux sélecteurs
            try {
                await page.waitForSelector('li.bi', { visible: true, timeout: 30000 });
            } catch (error) {
                try {
                    await page.waitForSelector('.bi-denomination', { visible: true, timeout: 30000 });
                } catch (error2) {
                    await page.waitForSelector('a[href*="/pros/"]', { visible: true, timeout: 30000 });
                }
            }
            
            await delayShort();
            console.log('Résultats de recherche chargés.');

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

            // Traiter chaque entreprise individuellement dans l'ordre d'affichage
            const processedUrls = new Set();
            
            // Filtrer les liens qui ne sont pas des pages de détail d'entreprise
            const validDetailLinks = detailLinks.filter(link => {
                // Vérifier que c'est un lien vers une page de détail d'entreprise
                const isValidProsLink = (link.includes('/pros/') && 
                                       !link.includes('chercherlespros') &&
                                       !link.includes('recherche') &&
                                       (link.match(/\/pros\/\d+/) || link.includes('code_etablissement='))); // Accepte les liens avec code_etablissement
                
                if (!isValidProsLink) {
                    console.log(`Lien filtré: ${link}`);
                }
                
                return isValidProsLink;
            });
            
            console.log(`Liens valides trouvés: ${validDetailLinks.length}/${detailLinks.length}`);

            // Traiter les entreprises en ouvrant des onglets depuis la page de liste
            for (let i = 0; i < validDetailLinks.length; i += poolSize) {
                const batch = validDetailLinks.slice(i, i + poolSize);
                const batchResults = [];

                // Traiter chaque entreprise du batch
                for (let j = 0; j < batch.length; j++) {
                    const link = batch[j];
                    try {
                        console.log(`Traitement de l'entreprise via onglet: ${link}`);
                        
                        // Ouvrir un nouvel onglet depuis la page de liste
                        const newPage = await browser.newPage();
                        
                        // Naviguer vers la page de détail
                        await newPage.goto(link, { waitUntil: 'domcontentloaded' });
                        await delayShort();
                        
                        // Extraire les informations
                        const info = await extractInfoFromPage(newPage);
                        console.log(`Entreprise traitée via onglet : ${info.name}`);
                        batchResults.push(info);
                        
                        // Fermer l'onglet
                        await newPage.close();
                        
                    } catch (e) {
                        console.error(`Erreur lors du traitement du lien ${link}:`, e);
                        batchResults.push(null);
                    }
                }

                const validResults = batchResults.filter(Boolean);
                allData.push(...validResults);
                totalProcessed += validResults.length;
                console.log(`Total traité jusqu'ici: ${totalProcessed} entreprises`);

                // Écrire les données par petits lots pour éviter la perte de données
                if (allData.length >= 10) {
                    const batchToWrite = allData.splice(0, allData.length);
                    await csvWriter.writeRecords(batchToWrite);
                    console.log(`Écriture de ${batchToWrite.length} enregistrements dans le CSV (batch).`);
                }
            }

            // Nous sommes toujours sur la page de liste, pas besoin de retour
            console.log('Page de liste des résultats préservée.');

            // Ancien bloc de traitement des détails - SUPPRIMÉ
            /*
            if (validDetailLinks.length > 0) {
                for (let i = 0; i < validDetailLinks.length; i++) {
                    const currentUrl = validDetailLinks[i];

                    // Vérifier si cette URL a déjà été traitée
                    if (processedUrls.has(currentUrl)) {
                        console.log(`URL déjà traitée, passage à la suivante: ${currentUrl}`);
                        continue;
                    }

                    processedUrls.add(currentUrl);

                    try {
                        console.log(`Traitement de l'entreprise ${i + 1}/${detailLinks.length}...`);
                        console.log(`URL: ${currentUrl}`);

                        // Aller sur la page de détail
                        await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
                        await delayPageChange();

                        // Vérifier que nous sommes bien sur une page de détail d'entreprise
                        const isDetailPage = await page.evaluate(() => {
                            return window.location.href.includes('/pros/detail') ||
                                   document.querySelector('.bi-denomination, .denomination, h1');
                        });

                        if (!isDetailPage) {
                            console.log(`Page ${i + 1} n'est pas une page de détail d'entreprise, passage à la suivante...`);
                            continue;
                        }

                        // Récupérer les informations de l'entreprise avec les sélecteurs précis
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
                                    name.length < 100) {
                                    info.name = name;
                                    console.log(`Nom trouvé: ${name}`);
                                }
                            }

                            // Si toujours pas de nom trouvé, essayer de le récupérer depuis l'URL
                            if (!info.name) {
                                const url = window.location.href;
                                const match = url.match(/detail\?.*?=([^&]+)/);
                                if (match) {
                                    info.name = decodeURIComponent(match[1]).replace(/\+/g, ' ');
                                }
                            }

                            // Dernière tentative : chercher dans le titre de la page
                            if (!info.name || info.name.includes('à')) {
                                const title = document.title;
                                if (title && !title.includes('PagesJaunes')) {
                                    info.name = title.replace(' - PagesJaunes', '').replace(' | PagesJaunes', '');
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
                                    }f
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
                                    if (/^(0[1-9])(\d{8})$/.test(text.replace(/\s/g, ''))) {
                                        phoneNumbers.push(text);
                                    }
                                });
                            }

                            // Si pas de numéros trouvés, cliquer sur le bouton "Afficher le N°" avec le sélecteur précis
                            if (phoneNumbers.length === 0) {
                                const showNumberBtn = document.querySelector('button[aria-label*="Afficher le N°"]');
                                if (showNumberBtn) {
                                    showNumberBtn.click();
                                    console.log('Bouton "Afficher le N°" cliqué');

                                    // Attendre un peu et chercher à nouveau
                                    setTimeout(() => {
                                        const newPhoneElements = document.querySelectorAll('.coord-numero');
                                        newPhoneElements.forEach(el => {
                                            const text = el.innerText.trim();
                                            if (/^(0[1-9])(\d{8})$/.test(text.replace(/\s/g, ''))) {
                                                phoneNumbers.push(text);
                                            }
                                        });
                                    }, 2000);
                                }
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
                                        (href.includes('www') || href.includes('http')))
                                    {

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
                                        (text.includes('www') || text.includes('http')))
                                    {

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
                                        (text.includes('www') || text.includes('http')))
                                    {

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
                                .replace(/\n/g, ' ') // Remplacer les retours à la ligne par des espaces
                                .replace(/\r/g, ' ') // Remplacer les retours chariot par des espaces
                                .replace(/\t/g, ' ') // Remplacer les tabulations par des espaces
                                .replace(/\s+/g, ' ') // Remplacer les espaces multiples par un seul espace
                                .trim(); // Supprimer les espaces en début et fin
                        };

                        // Ajouter les données à la liste
                        allData.push({
                            name: cleanData(companyInfo.name) || 'Nom non trouvé',
                            address: cleanData(companyInfo.address) || 'Adresse non trouvée',
                            phone: cleanData(companyInfo.phone) || 'Numéro non trouvé',
                            website: cleanData(companyInfo.website) || 'Site web non trouvé',
                            email: cleanData(companyInfo.email) || 'Email non trouvé',
                            additionalInfo: cleanData(companyInfo.additionalInfo) || ''
                        });

                        console.log(`Entreprise traitée : ${companyInfo.name}`);
                        console.log(`  - Adresse: ${companyInfo.address}`);
                        console.log(`  - Téléphone: ${companyInfo.phone}`);
                        console.log(`  - Site web: ${companyInfo.website}`);
                        console.log(`  - Email: ${companyInfo.email}`);

                    } catch (error) {
                        console.error(`Erreur lors du traitement de l'entreprise ${i + 1}:`, error);
                    } finally {
                        // Retourner à la page de résultats après chaque entreprise traitée
                        console.log('Retour à la page de résultats...');
                        await page.goBack();
                        await delayPageChange();

                        // Vérifier que nous sommes bien sur la page de résultats avant de continuer
                        try {
                            await page.waitForSelector('li.bi, .bi-denomination', { visible: true, timeout: 15000 });
                            console.log('Retour réussi à la page de résultats.');
                        } catch (e) {
                            console.log('Échec de la détection du retour à la page de résultats, tentative de navigation directe...');
                            const resultsPageUrl = `https://www.pagesjaunes.fr/recherche?quoiqui=${encodeURIComponent(object)}&ou=${encodeURIComponent(city)}`;
                            await page.goto(resultsPageUrl, { waitUntil: 'domcontentloaded' });
                            await delayPageChange();
                            try {
                                await page.waitForSelector('li.bi, .bi-denomination', { visible: true, timeout: 15000 });
                                console.log('Retour réussi à la page de résultats via navigation directe.');
                            } catch (err) {
                                console.error('Erreur irrécupérable : impossible de revenir à la page de résultats.', err);
                                hasNextPage = false;
                                break;
                            }
                        }
                    }
                }
            }
            */

            // Écrire les données par petits lots pour éviter la perte de données
            if (allData.length > 0) { // Condition modifiée pour écrire toutes les données restantes après les lots
                await csvWriter.writeRecords(allData); // Écrire toutes les données restantes
                console.log('Écriture des derniers enregistrements dans le CSV.');
                allData.length = 0; // Vider le tableau après écriture
            }

            // Vérifier s'il y a une page suivante avec plusieurs sélecteurs
            console.log('Recherche du bouton "Suivant"...');
            
            // Essayer plusieurs sélecteurs pour le bouton "Suivant"
            const nextPageSelectors = [
                '#pagination-next',
                'a[aria-label*="Suivant"]',
                'a[aria-label*="Next"]',
                'a[title*="Suivant"]',
                'a[title*="Next"]',
                'button[aria-label*="Suivant"]',
                'button[aria-label*="Next"]',
                '.pagination a:last-child',
                '.pagination-next',
                'a[href*="page="]',
                'a[href*="p="]',
                'a[href*="suivant"]',
                'a[href*="next"]',
                '.pagination a[href*="2"]',
                '.pagination a[href*="3"]',
                'a[data-page]',
                'a[data-pagination]',
                '.pagination .next',
                '.pagination .suivant'
            ];
            
            let nextPageButton = null;
            let nextButtonText = '';
            
            for (const selector of nextPageSelectors) {
                try {
                    const button = await page.$(selector);
                    if (button) {
                        const isVisible = await button.isVisible();
                        if (isVisible) {
                            nextButtonText = await page.evaluate(el => el.innerText || el.textContent || '', button);
                            console.log(`Bouton trouvé avec le sélecteur "${selector}", texte: "${nextButtonText}"`);
                            
                            // Vérifier si le bouton contient "Suivant" ou "Next" ou si c'est le dernier lien de pagination
                            if (nextButtonText.includes('Suivant') || 
                                nextButtonText.includes('Next') || 
                                nextButtonText.includes('>') ||
                                selector.includes('last-child') ||
                                selector.includes('pagination-next')) {
                                nextPageButton = button;
                                break;
                            }
                        }
                    }
                } catch (error) {
                    console.log(`Sélecteur "${selector}" non trouvé ou erreur`);
                }
            }
            
            if (nextPageButton) {
                console.log(`Bouton "Suivant" trouvé, texte: ${nextButtonText}`);

                try {
                    console.log('Clic sur le bouton "Suivant"...');
                    
                    // Attendre que le bouton soit vraiment cliquable
                    await page.waitForFunction(() => {
                        const button = document.querySelector('#pagination-next');
                        return button && !button.disabled && button.offsetParent !== null;
                    }, { timeout: 10000 });
                    
                    // Utiliser une méthode de clic plus robuste
                    try {
                        await page.evaluate(() => {
                            const button = document.querySelector('#pagination-next');
                            if (button) {
                                button.click();
                            }
                        });
                    } catch (error) {
                        console.log('Clic échoué, tentative de navigation directe...');
                        // Si le clic échoue, essayer de naviguer directement vers la page suivante
                        const currentUrl = page.url();
                        const urlParams = new URLSearchParams(currentUrl.split('?')[1] || '');
                        const currentPage = parseInt(urlParams.get('page') || '1');
                        const nextPage = currentPage + 1;
                        
                        const nextPageUrl = `${currentUrl.split('?')[0]}?${urlParams.toString().replace(/page=\d+/, `page=${nextPage}`)}`;
                        await page.goto(nextPageUrl, { waitUntil: 'domcontentloaded' });
                    }
                    
                    await delayPageChange();

                    pageNbr++;
                    console.log(`Passage à la page suivante... ${pageNbr}`);

                    // Attendre que les nouveaux résultats se chargent
                    await page.waitForSelector('li.bi', { visible: true, timeout: 15000 });
                    console.log('Nouveaux résultats chargés.');

                    // Vérifier que nous sommes bien sur une nouvelle page
                    let newPageNumberInfo = null;
                    try {
                        newPageNumberInfo = await page.evaluate(() => {
                            const pageInfo = document.querySelector('.pagination-info');
                            if (pageInfo) {
                                return pageInfo.textContent;
                            }
                            return null;
                        });
                    } catch (error) {
                        console.log('Erreur lors de la vérification du numéro de page');
                    }

                    if (newPageNumberInfo) {
                        console.log(`Page actuelle affichée: ${newPageNumberInfo}`);
                    } else {
                        console.log('Numéro de page non trouvé après navigation.');
                    }

                } catch (err) {
                    console.error(`Erreur lors du clic sur le bouton "Suivant" : ${err.message}`);
                    hasNextPage = false;
                }
            } else {
                console.log('Aucun bouton "Suivant" visible trouvé. Fin du traitement.');
                hasNextPage = false;
            }
        }

        if (allData.length > 0) {
            await csvWriter.writeRecords(allData);
            console.log('Écriture des derniers enregistrements dans le CSV.');
        }



        console.log(`Données collectées et écrites dans le fichier ${fileName} avec succès.`);
        console.log(`Total final d'entreprises traitées: ${totalProcessed}`);

    } catch (error) {
        console.error('Erreur dans le processus :', error);
    } finally {
        await browser.close();
        console.log('Navigateur fermé.');
    }
}