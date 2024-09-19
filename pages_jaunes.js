import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

puppeteer.use(StealthPlugin());

const delay = (time) => new Promise(resolve => setTimeout(resolve, time));

export default async function Pages_jaunes(object, city, fileName) {
    if (!fileName.endsWith('.csv')) {
        fileName += '.csv';
    }

    const csvWriter = createObjectCsvWriter({
        path: path.join(__dirname, fileName),
        header: [
            { id: 'name', title: 'Name' },
            { id: 'address', title: 'Address' },
            { id: 'phone', title: 'Phone' }
        ],
        append: true
    });

    const browser = await puppeteer.launch({ headless: false });
    try {
        const page = await browser.newPage();

        console.log('Accès à la page de PagesJaunes...');
        await page.goto('https://www.pagesjaunes.fr/', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#didomi-notice-agree-button', { visible: true });
        console.log('Clic sur le bouton "Accepter & Fermer"...');
        await page.click('#didomi-notice-agree-button');
        await delay(1000);

        await page.type('#ou', city);
        await delay(500);
        await page.type('#quoiqui', object);
        await delay(500);

        await page.click('#findId');
        console.log('Recherche soumise...');
        await delay(2000);

        const allData = [];
        let hasNextPage = true;

        while (hasNextPage) {
            await page.waitForSelector('a.bi-denomination.pj-link h3', { visible: true, timeout: 60000 });
            console.log('Résultats de recherche chargés.');

            const name = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a.bi-denomination.pj-link h3')).map(el => el.innerText.trim());
            });

            const addresses = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[title="Voir le plan"]')).map(el => el.innerText.trim());
            });

            let numeros = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.number-contact span')).map(el => el.innerText.trim());
            });

            if (numeros.length === 0) {
                console.log('Clic sur les boutons "Afficher le N°"...');
                await page.evaluate(() => {
                    Array.from(document.querySelectorAll('span.value'))
                        .filter(span => span.innerText.includes('Afficher le N°'))
                        .forEach(button => button.click());
                });
                await delay(2500);

                numeros = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.number-contact span')).map(el => el.innerText.trim());
                });
            }

            const pageData = name.map((nom, index) => ({
                name: nom,
                address: addresses[index] || 'Adresse non trouvée',
                phone: numeros[index] || 'Numéro non trouvé'
            }));

            allData.push(...pageData);

            if (allData.length >= 100) {
                await csvWriter.writeRecords(allData.splice(0, 100));
                console.log('Écriture de 100 enregistrements dans le CSV...');
            }

            const nextPageExists = await page.$('#pagination-next');
            if (nextPageExists) {
                console.log('Passage à la page suivante...');
                await delay(3000);
                try {
                    await page.click('#pagination-next');
                    await delay(2000);
                } catch (err) {
                    console.error('Erreur lors du passage à la page suivante :', err);
                    hasNextPage = false;
                }
            } else {
                hasNextPage = false;
            }
        }

        // Écriture des derniers enregistrements s'il en reste moins de 100
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
