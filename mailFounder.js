import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

// Fonction de délai
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fonction pour extraire les emails
export const extractEmails = (htmlContent) => {
    // Expression régulière pour extraire les emails
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const emails = htmlContent.match(emailRegex);
    return emails ? [...new Set(emails)] : [];
};

// Fonction principale
export const fetchGoogleSearchHTML = async (query) => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    try {
        console.log(`Recherche Google pour : ${query}`);

        // Aller sur la page Google
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
        await delay(2000); // Ajouter un délai après le goto

        // Accepter les cookies si le bouton est présent
        const acceptCookiesSelector = '#L2AGLb';
        if (await page.$(acceptCookiesSelector)) {
            console.log('Accepter les cookies...');
            await page.click(acceptCookiesSelector);
            await delay(2000); // Augmenter le délai après avoir accepté les cookies
        }

        // Trouver la barre de recherche et entrer la requête
        const searchBoxSelector = '#APjFqb';
        if (await page.$(searchBoxSelector)) {
            console.log('Entrer la requête dans la barre de recherche...');
            await page.type(searchBoxSelector, query, { delay: 200 }); // Augmenter le délai de frappe
            await page.keyboard.press('Enter');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await delay(3000); // Ajouter un délai après la navigation
        } else {
            throw new Error('Le champ de recherche Google est introuvable.');
        }

        // Capturer tout le contenu HTML de la page
        console.log('Extraction du contenu HTML...');
        const htmlContent = await page.content();

        console.log('HTML extrait avec succès.');
        
        // Extraire les emails du HTML
        const emails = extractEmails(htmlContent);
        console.log('Emails extraits:', emails);

        return emails;

    } catch (err) {
        console.error('Erreur lors de la recherche Google :', err.message);
        return null;
    } finally {
        await browser.close();
        console.log('Navigateur fermé.');
    }
};
