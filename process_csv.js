import { createReadStream } from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import csv from 'csv-parser';
import { fetchGoogleSearchHTML } from './mailFounder.js';

const processCsv = async (inputFilePath, outputFilePath) => {
    const records = [];
    
    // Définir les en-têtes CSV pour la sortie
    const csvWriter = createObjectCsvWriter({
        path: outputFilePath,
        header: [
            { id: 'nom_entreprise', title: 'Nom Entreprise' },
            { id: 'details_entreprise', title: 'Détails Entreprise' },
            { id: 'telephone', title: 'Téléphone' },
            { id: 'site_web', title: 'Site Web' },
            { id: 'email', title: 'Email' },
            { id: 'new_email', title: 'Nouvel Email Trouvé' },
            { id: 'html_length', title: 'Html Length' },
            { id: 'nb_results', title: 'Nb Results' },
            { id: 'timestamp', title: 'Timestamp' },
            { id: 'error', title: 'Error' }
        ]
    });

    createReadStream(inputFilePath)
        .pipe(csv({
            separator: ',',
            headers: ['Nom Entreprise', 'Détails Entreprise', 'Téléphone', 'Site Web', 'Email Existant']
        }))
        .on('data', (data) => records.push(data))
        .on('end', async () => {
            console.log('CSV lu avec succès.');

            const updatedRecords = [];
            for (const record of records) {
                // Assurez-vous que les colonnes existent et ont les bonnes clés
                const nom_entreprise = record['Nom Entreprise'] || '';
                const details_entreprise = record['Détails Entreprise'] || '';
                const telephone = record['Téléphone'] || '';
                const site_web = record['Site Web'] || '';
                const existing_email = record['Email Existant'] || '';


                if (existing_email && existing_email !== 'Email non trouvé') {
                    console.log(`Email déjà trouvé pour ${nom_entreprise}: ${existing_email}. Skipping search.`);
                    updatedRecords.push({
                        nom_entreprise,
                        details_entreprise,
                        telephone,
                        site_web,
                        email: existing_email,
                        new_email: existing_email
                    });
                    continue;
                }

                const query = `contact email ${nom_entreprise} ${details_entreprise}`;
                console.log(`Recherche d'email pour : ${nom_entreprise}`);
                const searchResult = await fetchGoogleSearchHTML(query);
                
                let newEmail = 'Email non trouvé';
                if (searchResult.emails && searchResult.emails.length > 0) {
                    newEmail = searchResult.emails.join('; ');
                    console.log(`Emails trouvés pour ${nom_entreprise}: ${newEmail}`);
                } else {
                    console.log(`Aucun email trouvé pour ${nom_entreprise}.`);
                }

                updatedRecords.push({
                    nom_entreprise,
                    details_entreprise,
                    telephone,
                    site_web,
                    email: existing_email,
                    new_email: newEmail,
                    html_length: searchResult.htmlLength,
                    nb_results: searchResult.nbResults,
                    timestamp: searchResult.timestamp,
                    error: searchResult.error || ''
                });
            }

            console.log('Écriture du nouveau fichier CSV...');
            await csvWriter.writeRecords(updatedRecords);
            console.log(`Traitement terminé. Résultats sauvegardés dans ${outputFilePath}`);
        });
};

// Exemple d'utilisation
(async () => {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error("Veuillez fournir le chemin du fichier CSV en argument. Exemple: node process_csv.js ./batiment-annecy.csv");
        process.exit(1);
    }
    const outputPath = inputPath.replace('.csv', '_with_emails.csv');
    await processCsv(inputPath, outputPath);
})(); 