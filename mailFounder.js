import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

// Fonction de délai
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fonction pour extraire les emails
export const extractEmails = (htmlContent) => {
    if (!htmlContent) return [];

    let foundEmails = [];

    // Expression régulière pour extraire les emails en texte brut
    const plainEmailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    const plainEmails = htmlContent.match(plainEmailRegex);
    if (plainEmails) {
        foundEmails = foundEmails.concat(plainEmails);
    }

    // Expression régulière pour extraire les emails des liens mailto:
    const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    let mailtoMatch;
    while ((mailtoMatch = mailtoRegex.exec(htmlContent)) !== null) {
        foundEmails.push(mailtoMatch[1]);
    }

    const blacklist = ['example.com', 'test.com', 'noreply.com']; // Exemple de blacklist
    return foundEmails.length > 0 
        ? [...new Set(foundEmails.filter(email => !blacklist.some(bl => email.includes(bl))))]
        : [];
};

// Fonction principale
export const fetchGoogleSearchHTML = async (query) => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    let allEmails = [];
    let nbResults = 0;
    let htmlLength = 0;

    try {
        console.log(`Recherche Google pour : ${query}`);

        // Aller sur la page Google
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
        await delay(1000); // Délai réduit

        // Accepter les cookies si le bouton est présent
        const acceptCookiesSelector = '#L2AGLb';
        if (await page.$(acceptCookiesSelector)) {
            console.log('Accepter les cookies...');
            await page.click(acceptCookiesSelector);
            await delay(1000); // Délai réduit
        }

        // Trouver la barre de recherche et entrer la requête
        const searchBoxSelector = '#APjFqb';
        if (await page.$(searchBoxSelector)) {
            console.log('Entrer la requête dans la barre de recherche...');
            await page.type(searchBoxSelector, query); // sans delay
            await page.keyboard.press('Enter');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await delay(1000); // Délai réduit
        } else {
            throw new Error('Le champ de recherche Google est introuvable.');
        }

        // Capturer tout le contenu HTML de la page de résultats Google
        console.log('Extraction du contenu HTML de la page de résultats Google...');
        const htmlContent = await page.content();
        htmlLength = htmlContent.length;

        console.log('HTML extrait avec succès.');
        
        // Extraire les emails du HTML de la page de résultats Google
        const emailsFromSerp = extractEmails(htmlContent);
        allEmails.push(...emailsFromSerp);
        console.log('Emails extraits de la SERP:', emailsFromSerp);

        // Récupérer les liens des résultats de la SERP
        const resultLinks = await page.$$eval('a[href^="http"]', links =>
            links.map(link => link.href).filter(href => 
                !href.includes('google.com') &&
                !href.includes('/search') &&
                !href.includes('webcache')
            )
        );

        nbResults = resultLinks.length;
        console.log(`Trouvé ${nbResults} liens non-Google sur la SERP.`);

        // Visiter les 3 premiers résultats pour extraire les emails
        for (const link of resultLinks.slice(0, 3)) {
            console.log(`Visite de ${link}`);
            try {
                await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await delay(1000); // Délai réduit
                const pageHtml = await page.content();
                const pageEmails = extractEmails(pageHtml);
                allEmails.push(...pageEmails);
                console.log(`Emails extraits de ${link}:`, pageEmails);
            } catch (pageError) {
                console.error(`Erreur lors de la visite ou de l'extraction de ${link}:`, pageError.message);
            }
        }

        // Enlever les doublons de tous les emails trouvés
        const uniqueEmails = [...new Set(allEmails)];
        console.log('Tous les emails uniques extraits:', uniqueEmails);

        return {
            query,
            emails: uniqueEmails,
            htmlLength,
            nbResults,
            timestamp: new Date().toISOString()
        };

    } catch (err) {
        console.error('Erreur lors de la recherche Google :', err.message);
        return {
            query,
            emails: [],
            htmlLength: 0,
            nbResults: 0,
            timestamp: new Date().toISOString(),
            error: err.message
        };
    } finally {
        await browser.close();
        console.log('Navigateur fermé.');
    }
};
