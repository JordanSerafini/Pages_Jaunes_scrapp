import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fonction pour normaliser le nom d'entreprise
const normalizeCompanyName = (name) => {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
        .replace(/[^a-z0-9]/g, '') // Garder seulement lettres et chiffres
        .trim();
};

// Fonction pour nettoyer les doublons
function cleanDuplicates(inputFile, outputFile) {
    const seen = new Set();
    const uniqueEntries = [];
    let duplicatesCount = 0;
    
    // Lire le fichier CSV ligne par ligne
    const lines = fs.readFileSync(inputFile, 'utf8').split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Ignorer les lignes vides
        
        // Extraire le nom de l'entreprise (première colonne)
        const columns = line.split(',');
        const companyName = columns[0];
        
        // Normaliser le nom pour la comparaison
        const normalizedName = normalizeCompanyName(companyName);
        
        // Si on n'a pas encore vu cette entreprise, l'ajouter
        if (!seen.has(normalizedName)) {
            seen.add(normalizedName);
            uniqueEntries.push(line);
        } else {
            console.log(`Doublon supprimé: ${companyName}`);
            duplicatesCount++;
        }
    }
    
    // Écrire le fichier nettoyé
    fs.writeFileSync(outputFile, uniqueEntries.join('\n'));
    
    console.log(`\nNettoyage terminé !`);
    console.log(`Entrées originales: ${lines.length}`);
    console.log(`Entrées uniques: ${uniqueEntries.length}`);
    console.log(`Doublons supprimés: ${duplicatesCount}`);
    console.log(`Fichier nettoyé sauvegardé: ${outputFile}`);
}

// Exécuter le nettoyage
const inputFile = 'btp-auvergne-rhone-alpes.csv';
const outputFile = 'btp-auvergne-rhone-alpes-clean.csv';

cleanDuplicates(inputFile, outputFile); 