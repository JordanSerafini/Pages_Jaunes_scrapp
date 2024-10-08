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
            { id: 'phone', title: 'Phone' }
        ],
        append: true
    });

    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36');
        console.log('Accès à la page de PagesJaunes...');
        await page.goto('https://www.pagesjaunes.fr/', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#didomi-notice-agree-button', { visible: true });
        console.log('Clic sur le bouton "Accepter & Fermer"...');
        await page.click('#didomi-notice-agree-button');
        await delay(1000, 2000);

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

            const name = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a.bi-denomination.pj-link h3')).map(el => el.innerText.trim());
            });

            const addresses = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[title="Voir le plan"]')).map(el => {
                    const text = el.innerText.trim();
                    return text.replace('Voir le plan', '').trim();
                });
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
                await delay(1500, 3000);

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
                pageNbr++;
                console.log('Passage à la page suivante... ', pageNbr, '}');
                await delay(2000, 4000);
                try {
                    await page.click('#pagination-next');
                    await delay(1500, 3000);
                } catch (err) {
                    console.error('Erreur lors du passage à la page suivante :', err);
                    hasNextPage = false;
                }
            } else {
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
