#!/usr/bin/env node

import { Command } from 'commander';
import Pages_jaunes from './pages_jaunes.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('pages-jaunes-scraper')
  .description("Scraper PagesJaunes pour extraire les informations d'entreprises")
  .version('1.0.0');

program
  .command('scrape')
  .description('Lancer le scraping PagesJaunes')
  .requiredOption('-q, --query <query>', 'Terme de recherche (ex: "batiment", "plomberie")')
  .requiredOption(
    '-c, --city <city>',
    'Ville ou région (ex: "Paris", "Lyon", "Auvergne-Rhône-Alpes")'
  )
  .option('-o, --output <filename>', 'Nom du fichier de sortie (sans extension)', 'result')
  .option('--headful', 'Afficher le navigateur (défaut: headless)', false)
  .option('--debug', 'Mode debug avec plus de logs', false)
  .option('--pool-size <number>', "Nombre d'onglets simultanés", '15')
  .option('--batch-size <number>', "Taille des lots d'écriture CSV", '10')
  .action(async options => {
    try {
      console.log('🚀 Démarrage du scraper PagesJaunes...');
      console.log(`📋 Recherche: "${options.query}" dans "${options.city}"`);
      console.log(`💾 Fichier de sortie: ${options.output}.csv`);
      console.log(
        `⚙️  Configuration: ${options.poolSize} onglets simultanés, lots de ${options.batchSize}`
      );

      if (options.debug) {
        console.log('🐛 Mode debug activé');
      }

      // Vérifier que le fichier de configuration existe
      const configPath = path.join(__dirname, 'config.json');
      if (!fs.existsSync(configPath)) {
        console.error('❌ Fichier config.json manquant');
        process.exit(1);
      }

      // Lancer le scraping
      await Pages_jaunes(options.query, options.city, options.output);

      console.log('✅ Scraping terminé avec succès!');
    } catch (error) {
      console.error('❌ Erreur lors du scraping:', error.message);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Afficher la configuration actuelle')
  .action(() => {
    try {
      const configPath = path.join(__dirname, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('📋 Configuration actuelle:');
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.error('❌ Fichier config.json manquant');
      }
    } catch (error) {
      console.error('❌ Erreur lors de la lecture de la configuration:', error.message);
    }
  });

program
  .command('validate')
  .description('Valider la configuration')
  .action(() => {
    try {
      const configPath = path.join(__dirname, 'config.json');
      if (!fs.existsSync(configPath)) {
        console.error('❌ Fichier config.json manquant');
        process.exit(1);
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Vérifications de base
      const requiredSections = ['selectors', 'delays', 'performance', 'userAgents', 'browserArgs'];
      const missingSections = requiredSections.filter(section => !config[section]);

      if (missingSections.length > 0) {
        console.error(`❌ Sections manquantes dans config.json: ${missingSections.join(', ')}`);
        process.exit(1);
      }

      // Vérifier les sélecteurs essentiels
      const requiredSelectors = ['name', 'address', 'phone', 'website', 'businessListings'];
      const missingSelectors = requiredSelectors.filter(selector => !config.selectors[selector]);

      if (missingSelectors.length > 0) {
        console.error(`❌ Sélecteurs manquants: ${missingSelectors.join(', ')}`);
        process.exit(1);
      }

      console.log('✅ Configuration valide');
      console.log(`📊 ${config.userAgents.length} User-Agents configurés`);
      console.log(`🎯 ${Object.keys(config.selectors).length} types de sélecteurs configurés`);
      console.log(`⚡ Pool size: ${config.performance.poolSize}`);
    } catch (error) {
      console.error('❌ Erreur lors de la validation:', error.message);
      process.exit(1);
    }
  });

// Gestion des erreurs globales
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesse rejetée non gérée:', reason);
  process.exit(1);
});

process.on('uncaughtException', error => {
  console.error('❌ Exception non gérée:', error.message);
  process.exit(1);
});

// Afficher l'aide si aucun argument
if (process.argv.length === 2) {
  program.help();
}

program.parse();
