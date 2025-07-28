import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
puppeteer.use(StealthPlugin());

const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

export default async function Pages_jaunes(object, city, fileName) {
    let pageNbr = 1;

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

    const browser = await puppeteer.launch({ headless: false });
    
    try {
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36');
        console.log('Accès à la page de PagesJaunes...');
        await page.goto('https://www.pagesjaunes.fr/', { waitUntil: 'networkidle2' });

        // Gestion des cookies
        console.log('Tentative de gestion des cookies...');
        try {
            await page.waitForSelector('iframe', { visible: true, timeout: 10000 });
            
            const frames = page.frames();
            const cookieFrame = frames.find(frame => 
                frame.url().includes('didomi') || 
                frame.url().includes('cookie') ||
                frame.url().includes('consent')
            ) || frames[1];
            
            if (cookieFrame) {
                console.log('Frame de cookies trouvé, tentative de clic...');
                
                await cookieFrame.waitForSelector('button.button_acceptAll, button[aria-label="Accepter la collecte de vos données"]', { 
                    visible: true, 
                    timeout: 5000 
                });
                
                const cookieSelectors = [
                    'button.button_acceptAll',
                    'button[aria-label="Accepter la collecte de vos données"]',
                    'button[aria-label*="Accepter"]'
                ];
                
                let cookieClicked = false;
                for (const selector of cookieSelectors) {
                    try {
                        const button = await cookieFrame.$(selector);
                        if (button) {
                            console.log(`Clic sur le bouton cookie avec le sélecteur: ${selector}`);
                            await button.click();
                            cookieClicked = true;
                            break;
                        }
                    } catch (err) {
                        console.log(`Sélecteur ${selector} non trouvé dans l'iframe, essai suivant...`);
                    }
                }
                
                if (!cookieClicked) {
                    await cookieFrame.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const acceptButton = buttons.find(btn => 
                            btn.textContent.includes('Accepter') || 
                            btn.textContent.includes('Accept')
                        );
                        if (acceptButton) {
                            acceptButton.click();
                            return true;
                        }
                        return false;
                    });
                }
            }
            
            console.log('Gestion des cookies terminée.');
            await delay(1000, 2000);
        } catch (error) {
            console.log('Aucune popup de cookies détectée ou déjà gérée.');
        }

        await page.type('#ou', city);
        await delay(500, 1000);
        await page.type('#quoiqui', object);
        await delay(500, 1000);

        await page.click('#findId');
        console.log('Recherche soumise...');
        await delay(1500, 3000);

        const allData = [];
        let hasNextPage = true;

        while (hasNextPage) {
            // Attendre que les résultats se chargent avec les nouveaux sélecteurs
            try {
                await page.waitForSelector('li.bi', { visible: true, timeout: 150000 });
            } catch (error) {
                try {
                    await page.waitForSelector('.bi-denomination', { visible: true, timeout: 150000 });
                } catch (error2) {
                    await page.waitForSelector('a[href*="/pros/"]', { visible: true, timeout: 150000 });
                }
            }
            
            await delay(2000, 4000);
            console.log('Résultats de recherche chargés.');

            // Vérifier que nous sommes bien sur une page de résultats
            const isResultsPage = await page.evaluate(() => {
                return document.querySelector('.bi-list') !== null || 
                       document.querySelector('li.bi') !== null ||
                       document.querySelector('.search-results') !== null ||
                       window.location.href.includes('/recherche') ||
                       window.location.href.includes('/chercherlespros');
            });
            
            if (!isResultsPage) {
                console.log('Pas sur une page de résultats, arrêt du traitement.');
                break;
            }

            // Récupérer les liens vers les pages de détail en utilisant les nouveaux sélecteurs
            const detailLinks = await page.evaluate(() => {
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
            
            // Si nous n'avons pas assez de liens, essayer une méthode alternative
            if (validDetailLinks.length < detailLinks.length) {
                console.log('Peu de liens trouvés, tentative de méthode alternative...');
                
                // Méthode alternative : cliquer directement sur chaque listing
                const alternativeLinks = await page.evaluate(async () => {
                    const businessListings = document.querySelectorAll('li.bi');
                    const links = [];
                    
                    for (let i = 0; i < businessListings.length; i++) {
                        const listing = businessListings[i];
                        
                        // Essayer de cliquer sur le div cliquable
                        const clickableDiv = listing.querySelector('.bi-clic-mobile');
                        if (clickableDiv) {
                            // Sauvegarder l'URL actuelle
                            const currentUrl = window.location.href;
                            
                            // Cliquer sur le div
                            clickableDiv.click();
                            
                            // Attendre un peu pour que la navigation se fasse
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            // Vérifier si l'URL a changé
                            if (window.location.href !== currentUrl && window.location.href.includes('/pros/')) {
                                links.push(window.location.href);
                                console.log(`Lien alternatif trouvé: ${window.location.href}`);
                                
                                // Revenir à la page précédente
                                window.history.back();
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
                        
                        // Si pas de div cliquable, essayer de cliquer sur le h3 ou le lien principal
                        if (!clickableDiv) {
                            const h3Element = listing.querySelector('h3');
                            const linkElement = listing.querySelector('a.bi-denomination.pj-link');
                            
                            if (h3Element) {
                                h3Element.click();
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                
                                if (window.location.href !== currentUrl && window.location.href.includes('/pros/')) {
                                    links.push(window.location.href);
                                    console.log(`Lien trouvé via h3: ${window.location.href}`);
                                    window.history.back();
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                }
                            } else if (linkElement) {
                                linkElement.click();
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                
                                if (window.location.href !== currentUrl && window.location.href.includes('/pros/')) {
                                    links.push(window.location.href);
                                    console.log(`Lien trouvé via lien principal: ${window.location.href}`);
                                    window.history.back();
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                }
                            }
                        }
                    }
                    
                    return links;
                });
                
                // Ajouter les liens alternatifs aux liens valides
                validDetailLinks.push(...alternativeLinks.filter(link => 
                    !validDetailLinks.includes(link) && 
                    link.includes('/pros/') && 
                    link.match(/\/pros\/\d+/)
                ));
                
                console.log(`Après méthode alternative: ${validDetailLinks.length} liens valides`);
            }
            
            // Si pas assez de liens valides, essayer de cliquer directement sur les éléments de la liste
            if (validDetailLinks.length < detailLinks.length) {
                console.log('Aucun lien trouvé, tentative de clic direct sur les éléments...');
                
                // Cliquer directement sur chaque élément de la liste
                const businessListings = await page.$$('li.bi');
                console.log(`Nombre d'éléments de liste trouvés: ${businessListings.length}`);
                
                for (let i = 0; i < businessListings.length; i++) {
                    try {
                        console.log(`Clic sur l'élément ${i + 1}/${businessListings.length}...`);
                        
                        // Cliquer sur l'élément
                        await businessListings[i].click();
                        await delay(2000, 4000);
                        
                        // Vérifier si nous sommes sur une page de détail
                        const currentUrl = await page.url();
                        if (currentUrl.includes('/pros/') && currentUrl.includes('detail')) {
                            console.log(`Navigation réussie vers: ${currentUrl}`);
                            
                            // Récupérer les informations de l'entreprise
                            const companyInfo = await page.evaluate(() => {
                                const info = {
                                    name: '',
                                    address: '',
                                    phone: '',
                                    website: '',
                                    email: '',
                                    additionalInfo: ''
                                };

                                // Nom de l'entreprise
                                const nameElement = document.querySelector('div.bi-content h3, h1');
                                if (nameElement) {
                                    info.name = nameElement.innerText.trim();
                                }

                                // Adresse
                                const addressElement = document.querySelector('div.bi-content > div:nth-child(2)');
                                if (addressElement) {
                                    info.address = addressElement.innerText.trim().replace('Voir le plan', '').trim();
                                }

                                // Téléphone
                                const phoneElement = document.querySelector('.coord-numero');
                                if (phoneElement) {
                                    info.phone = phoneElement.innerText.trim();
                                }

                                // Site web
                                const websiteElement = document.querySelector('a[href*="http"]:not([href*="pagesjaunes"])');
                                if (websiteElement) {
                                    info.website = websiteElement.href;
                                }

                                // Email
                                const emailElement = document.querySelector('a[href^="mailto:"]');
                                if (emailElement) {
                                    info.email = emailElement.href.replace('mailto:', '');
                                }

                                return info;
                            });

                            // Ajouter les données
                            allData.push({
                                name: companyInfo.name || 'Nom non trouvé',
                                address: companyInfo.address || 'Adresse non trouvée',
                                phone: companyInfo.phone || 'Numéro non trouvé',
                                website: companyInfo.website || 'Site web non trouvé',
                                email: companyInfo.email || 'Email non trouvé',
                                additionalInfo: companyInfo.additionalInfo || ''
                            });

                            console.log(`Entreprise traitée : ${companyInfo.name}`);
                        }
                        
                        // Revenir à la page de résultats
                        await page.goBack();
                        await delay(2000, 4000);
                        
                    } catch (error) {
                        console.error(`Erreur lors du clic sur l'élément ${i + 1}:`, error);
                    }
                }
            }
            
            // Traiter les entreprises dans l'ordre d'affichage seulement si nous avons des liens valides
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
                        await page.goto(currentUrl, { waitUntil: 'networkidle2' });
                        await delay(2000, 4000);
                        
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

                        // Ajouter les données à la liste
                        allData.push({
                            name: companyInfo.name || 'Nom non trouvé',
                            address: companyInfo.address || 'Adresse non trouvée',
                            phone: companyInfo.phone || 'Numéro non trouvé',
                            website: companyInfo.website || 'Site web non trouvé',
                            email: companyInfo.email || 'Email non trouvé',
                            additionalInfo: companyInfo.additionalInfo || ''
                        });

                        console.log(`Entreprise traitée : ${companyInfo.name}`);
                        console.log(`  - Adresse: ${companyInfo.address}`);
                        console.log(`  - Téléphone: ${companyInfo.phone}`);
                        console.log(`  - Site web: ${companyInfo.website}`);
                        console.log(`  - Email: ${companyInfo.email}`);

                    } catch (error) {
                        console.error(`Erreur lors du traitement de l'entreprise ${i + 1}:`, error);
                    }
                }
                
                // Revenir à la page de résultats après avoir traité tous les liens
                console.log('Retour à la page de résultats...');
                await page.goBack();
                await delay(2000, 4000);
                
                // Vérifier que nous sommes bien sur la page de résultats
                const isBackOnResultsPage = await page.evaluate(() => {
                    return document.querySelector('.bi-list') !== null || 
                           document.querySelector('li.bi') !== null ||
                           window.location.href.includes('/recherche') ||
                           window.location.href.includes('/chercherlespros');
                });
                
                if (!isBackOnResultsPage) {
                    console.log('Pas revenu sur la page de résultats, tentative de navigation...');
                    // Essayer de revenir à la page de recherche originale
                    await page.goto(`https://www.pagesjaunes.fr/recherche?quoiqui=${encodeURIComponent(object)}&ou=${encodeURIComponent(city)}`, { waitUntil: 'networkidle2' });
                    await delay(2000, 4000);
                }
            }

            // Écrire les données par petits lots pour éviter la perte de données
            if (allData.length >= 50) {
                await csvWriter.writeRecords(allData.splice(0, 50));
                console.log('Écriture de 50 enregistrements dans le CSV...');
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
                '.pagination .suivant',
                'a:contains("Suivant")',
                'a:contains("Next")',
                'a:contains(">")'
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

                let clickSuccess = false;
                let attempt = 0;
                const maxAttempts = 3;
                let previousUrl = await page.url();

                while (!clickSuccess && attempt < maxAttempts) {
                    attempt++;
                    console.log(`Tentative de clic sur "Suivant" (tentative ${attempt}/${maxAttempts})...`);
                    try {
                        // Cliquer sur le bouton "Suivant"
                        await nextPageButton.click();
                        await delay(3000, 5000); // Délai plus long après le clic

                        const currentUrlAfterClick = await page.url();
                        if (currentUrlAfterClick !== previousUrl) {
                            console.log(`Clic réussi, URL changée vers: ${currentUrlAfterClick}`);
                            clickSuccess = true;
                        } else {
                            console.log('Clic échoué ou URL non changée, essai d\'une méthode alternative...');
                            // Essayer de cliquer via JavaScript
                            await page.evaluate(() => {
                                const nextBtn = document.querySelector('#pagination-next, a[aria-label*="Suivant"], .pagination a:last-child');
                                if (nextBtn) nextBtn.click();
                            });
                            await delay(3000, 5000);
                            if (await page.url() !== previousUrl) {
                                clickSuccess = true;
                                console.log('Clic alternatif réussi.');
                            } else {
                                // Dernière alternative: essayer de cliquer sur le lien via href
                                const nextPageHref = await page.evaluate(() => {
                                    const nextLink = document.querySelector('a[href*="page="], a[href*="p="]');
                                    return nextLink ? nextLink.href : null;
                                });
                                
                                if (nextPageHref) {
                                    console.log(`Navigation directe vers: ${nextPageHref}`);
                                    await page.goto(nextPageHref, { waitUntil: 'networkidle2' });
                                    await delay(2000, 4000);
                                    clickSuccess = true;
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Erreur lors du clic sur le bouton "Suivant" : ${err.message}`);
                        // Ne pas casser la boucle immédiatement, essayer une autre méthode ou tentative
                    }
                }

                if (clickSuccess) {
                    pageNbr++;
                    console.log(`Passage à la page suivante... ${pageNbr}`);
                    
                    // Attendre que les nouveaux résultats se chargent
                    await page.waitForSelector('li.bi', { visible: true, timeout: 20000 }); // Timeout plus long
                    console.log('Nouveaux résultats chargés.');
                    
                    // Vérifier que nous sommes bien sur une nouvelle page (numéro de page)
                    const newPageNumberInfo = await page.evaluate(() => {
                        const pageInfo = document.querySelector('.pagination-info'); // Ou un sélecteur plus précis pour "Page X/Y"
                        if (pageInfo) {
                            return pageInfo.textContent;
                        }
                        return null;
                    });
                    
                    if (newPageNumberInfo) {
                        console.log(`Page actuelle affichée: ${newPageNumberInfo}`);
                    } else {
                        console.log('Numéro de page non trouvé après navigation.');
                    }

                } else {
                    console.log('Impossible de cliquer sur le bouton "Suivant" après plusieurs tentatives. Fin du traitement.');
                    hasNextPage = false;
                }
                            } else {
                    console.log('Aucun bouton "Suivant" trouvé avec tous les sélecteurs testés.');
                    
                    // Analyser la structure de pagination pour détecter s'il y a d'autres pages
                    const paginationInfo = await page.evaluate(() => {
                        const paginationElements = document.querySelectorAll('.pagination a, .pagination li, a[href*="page"], a[href*="p="]');
                        const paginationData = [];
                        
                        paginationElements.forEach(el => {
                            const text = el.innerText.trim();
                            const href = el.href;
                            const classes = el.className;
                            
                            if (text && (text.match(/\d+/) || text.includes('Suivant') || text.includes('Next') || text.includes('>'))) {
                                paginationData.push({
                                    text: text,
                                    href: href,
                                    classes: classes
                                });
                            }
                        });
                        
                        return paginationData;
                    });
                    
                    console.log('Éléments de pagination trouvés:', paginationInfo);
                    
                    // Méthode alternative : essayer de détecter la pagination via l'URL
                    const currentUrl = await page.url();
                    console.log(`URL actuelle: ${currentUrl}`);
                    
                    // Essayer de construire l'URL de la page suivante
                    let nextPageUrl = null;
                    
                    // Construire l'URL de recherche originale pour la pagination
                    const searchUrl = `https://www.pagesjaunes.fr/recherche?quoiqui=${encodeURIComponent(object)}&ou=${encodeURIComponent(city)}`;
                    
                    if (currentUrl.includes('page=')) {
                        const pageMatch = currentUrl.match(/page=(\d+)/);
                        if (pageMatch) {
                            const currentPage = parseInt(pageMatch[1]);
                            nextPageUrl = searchUrl + `&page=${currentPage + 1}`;
                            console.log(`Tentative de navigation vers la page suivante: ${nextPageUrl}`);
                        }
                    } else if (currentUrl.includes('p=')) {
                        const pageMatch = currentUrl.match(/p=(\d+)/);
                        if (pageMatch) {
                            const currentPage = parseInt(pageMatch[1]);
                            nextPageUrl = searchUrl + `&p=${currentPage + 1}`;
                            console.log(`Tentative de navigation vers la page suivante: ${nextPageUrl}`);
                        }
                    } else {
                        // Si pas de paramètre de page, ajouter page=2 à l'URL de recherche
                        nextPageUrl = searchUrl + `&page=2`;
                        console.log(`Tentative de navigation vers la page suivante: ${nextPageUrl}`);
                    }
                
                if (nextPageUrl) {
                    try {
                        console.log('Tentative de navigation directe vers la page suivante...');
                        await page.goto(nextPageUrl, { waitUntil: 'networkidle2' });
                        await delay(3000, 5000);
                        
                        // Vérifier si nous avons de nouveaux résultats
                        const newResults = await page.evaluate(() => {
                            return document.querySelectorAll('li.bi').length;
                        });
                        
                        if (newResults > 0) {
                            console.log(`Navigation réussie vers la page suivante. ${newResults} nouveaux résultats trouvés.`);
                            pageNbr++;
                            hasNextPage = true;
                        } else {
                            console.log('Aucun nouveau résultat trouvé, fin du traitement.');
                            hasNextPage = false;
                        }
                    } catch (error) {
                        console.error('Erreur lors de la navigation vers la page suivante:', error);
                        hasNextPage = false;
                    }
                } else {
                    console.log('Impossible de construire l\'URL de la page suivante. Fin du traitement.');
                    hasNextPage = false;
                }
            }
        }

        if (allData.length > 0) {
            await csvWriter.writeRecords(allData);
            console.log('Écriture des derniers enregistrements dans le CSV.');
        }

        console.log(`Données collectées et écrites dans le fichier ${fileName} avec succès.`);

    } catch (error) {
        console.error('Erreur dans le processus :', error);
    } finally {
        await browser.close();
        console.log('Navigateur fermé.');
    }
} 