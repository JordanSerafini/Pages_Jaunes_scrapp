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

        // Gestion des cookies avec plusieurs sélecteurs possibles
        console.log('Tentative de gestion des cookies...');
        try {
            // Attendre que l'iframe de cookies apparaisse
            await page.waitForSelector('iframe', { visible: true, timeout: 10000 });
            
            // Trouver l'iframe contenant la popup de cookies
            const frames = page.frames();
            const cookieFrame = frames.find(frame => 
                frame.url().includes('didomi') || 
                frame.url().includes('cookie') ||
                frame.url().includes('consent')
            ) || frames[1]; // Souvent le deuxième frame
            
            if (cookieFrame) {
                console.log('Frame de cookies trouvé, tentative de clic...');
                
                // Attendre que le bouton soit visible dans l'iframe
                await cookieFrame.waitForSelector('button.button_acceptAll, button[aria-label="Accepter la collecte de vos données"]', { 
                    visible: true, 
                    timeout: 5000 
                });
                
                // Essayer plusieurs sélecteurs pour le bouton d'acceptation
                const cookieSelectors = [
                    'button.button_acceptAll',
                    'button[aria-label="Accepter la collecte de vos données"]',
                    'button[aria-label*="Accepter"]',
                    'button:contains("Accepter")'
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
                    // Essayer de cliquer sur le bouton "Accepter" par texte dans l'iframe
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
            } else {
                console.log('Aucun frame de cookies trouvé, tentative sur la page principale...');
                
                // Fallback sur la page principale
                await page.waitForSelector('button.button_acceptAll, button[aria-label="Accepter la collecte de vos données"]', { 
                    visible: true, 
                    timeout: 5000 
                });
                
                const cookieSelectors = [
                    'button.button_acceptAll',
                    'button[aria-label="Accepter la collecte de vos données"]',
                    'button[aria-label*="Accepter"]'
                ];
                
                for (const selector of cookieSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            console.log(`Clic sur le bouton cookie avec le sélecteur: ${selector}`);
                            await button.click();
                            break;
                        }
                    } catch (err) {
                        console.log(`Sélecteur ${selector} non trouvé, essai suivant...`);
                    }
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
            await page.waitForSelector('a.bi-denomination.pj-link h3', { visible: true, timeout: 150000 });
            console.log('Résultats de recherche chargés.');

            // Vérifier que nous sommes bien sur une page de résultats
            const isResultsPage = await page.evaluate(() => {
                return document.querySelector('.bi-list') !== null || 
                       document.querySelector('.search-results') !== null ||
                       window.location.href.includes('/recherche');
            });
            
            if (!isResultsPage) {
                console.log('Pas sur une page de résultats, arrêt du traitement.');
                break;
            }

            // Récupérer les liens vers les pages de détail
            const detailLinks = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a.bi-denomination.pj-link')).map(link => link.href);
                // Supprimer les doublons
                return [...new Set(links)];
            });

            console.log(`Trouvé ${detailLinks.length} entreprises uniques à traiter sur cette page.`);
            
            // Afficher les premiers liens pour debug
            if (detailLinks.length > 0) {
                console.log('Premiers liens trouvés:');
                detailLinks.slice(0, 3).forEach((link, index) => {
                    console.log(`  ${index + 1}: ${link}`);
                });
            }

            // Traiter chaque entreprise individuellement
            const processedUrls = new Set();
            
            for (let i = 0; i < detailLinks.length; i++) {
                const currentUrl = detailLinks[i];
                
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
                        const nameSelectors = [
                            'h3.bi-denomination',
                            '.bi-denomination h3',
                            'h1',
                            '.company-name',
                            '.denomination',
                            '.business-name',
                            'h2.denomination',
                            '.pj-denomination',
                            '.bi-denomination',
                            '.bi-header-title h3'
                        ];
                        
                        for (const selector of nameSelectors) {
                            const nameElement = document.querySelector(selector);
                            if (nameElement) {
                                const name = nameElement.innerText.trim();
                                // Vérifier que ce n'est pas un nom générique
                                if (name && 
                                    !name.includes('à') && 
                                    !name.includes('Bâtiment') &&
                                    !name.includes('PagesJaunes') &&
                                    name.length > 3 &&
                                    name.length < 100) {
                                    info.name = name;
                                    console.log(`Nom trouvé avec le sélecteur ${selector}: ${name}`);
                                    break;
                                }
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

                        // Adresse
                        const addressSelectors = [
                            'a[title="Voir le plan"]',
                            '.bi-adresse',
                            '.address',
                            '[class*="adresse"]',
                            '.bi-header-address',
                            '.address-info',
                            'span[class*="adresse"]',
                            '.location-info'
                        ];
                        
                        for (const selector of addressSelectors) {
                            const addressElement = document.querySelector(selector);
                            if (addressElement) {
                                let addressText = addressElement.innerText.trim();
                                addressText = addressText.replace('Voir le plan', '').trim();
                                if (addressText && addressText.length > 5) {
                                    info.address = addressText;
                                    console.log(`Adresse trouvée avec le sélecteur ${selector}: ${addressText}`);
                                    break;
                                }
                            }
                        }

                        // Numéros de téléphone
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

                        // Si pas de numéros trouvés, cliquer sur les boutons "Afficher le N°"
                        if (phoneNumbers.length === 0) {
                            const showButtons = document.querySelectorAll('button.button.btn.btn_primary.btn_full_mob.btn_tel.normal-button, span.value');
                            showButtons.forEach(button => {
                                if (button.textContent.includes('Afficher le N°')) {
                                    button.click();
                                }
                            });
                            
                            // Attendre un peu et chercher à nouveau
                            setTimeout(() => {
                                const newPhoneElements = document.querySelectorAll('.coord-numero, .number-contact span');
                                newPhoneElements.forEach(el => {
                                    const text = el.innerText.trim();
                                    if (/^(0[1-9])(\d{8})$/.test(text.replace(/\s/g, ''))) {
                                        phoneNumbers.push(text);
                                    }
                                });
                            }, 2000);
                        }

                        info.phone = phoneNumbers.join('; ');

                        // Site web - récupération depuis l'attribut data-pjlb (base64)
                        const websiteElement = document.querySelector('a.SITE_EXTERNE');
                        if (websiteElement) {
                            try {
                                // Récupérer l'URL depuis l'attribut data-pjlb
                                const dataPjlb = websiteElement.getAttribute('data-pjlb');
                                if (dataPjlb) {
                                    const dataObj = JSON.parse(dataPjlb);
                                    if (dataObj.url) {
                                        // Décoder l'URL base64
                                        const decodedUrl = atob(dataObj.url);
                                        if (decodedUrl && decodedUrl.includes('http')) {
                                            info.website = decodedUrl;
                                            console.log(`Site web trouvé: ${decodedUrl}`);
                                        }
                                    }
                                }
                            } catch (error) {
                                console.log('Erreur lors du décodage du site web:', error);
                            }
                        }
                        
                        // Fallback: chercher dans le texte affiché
                        if (!info.website) {
                            const websiteText = document.querySelector('a.SITE_EXTERNE span.value');
                            if (websiteText) {
                                const text = websiteText.innerText.trim();
                                if (text && text.includes('www')) {
                                    info.website = text;
                                    console.log(`Site web trouvé (texte): ${text}`);
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

                        // Informations supplémentaires
                        const additionalInfo = [];
                        const infoElements = document.querySelectorAll('.bi-description, .company-description, .services');
                        infoElements.forEach(el => {
                            const text = el.innerText.trim();
                            if (text) {
                                additionalInfo.push(text);
                            }
                        });
                        
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

            // Écrire les données par petits lots pour éviter la perte de données
            if (allData.length >= 50) {
                await csvWriter.writeRecords(allData.splice(0, 50));
                console.log('Écriture de 50 enregistrements dans le CSV...');
            }

            // Vérifier s'il y a une page suivante
            const nextPageExists = await page.$('#pagination-next');
            if (nextPageExists) {
                pageNbr++;
                console.log(`Passage à la page suivante... ${pageNbr}`);
                await delay(2000, 4000);
                try {
                    await page.click('#pagination-next');
                    await delay(1500, 3000);
                    
                    // Vérifier que la page a bien changé
                    const currentUrl = await page.url();
                    console.log(`URL actuelle après clic: ${currentUrl}`);
                    
                } catch (err) {
                    console.error('Erreur lors du passage à la page suivante :', err);
                    hasNextPage = false;
                }
            } else {
                console.log('Aucune page suivante trouvée, fin du traitement.');
                hasNextPage = false;
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
