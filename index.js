import readline from 'readline';
import Pages_jaunes from './pages_jaunes.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Veuillez entrer le nom de la ville + code postal : ', (city) => {
  rl.question('Veuillez entrer l\'objet de votre recherche (ex: hotels) : ', (object) => {
    rl.question('Veuillez entrer le nom du fichier CSV de sortie (ex: resultats.csv) : ', async (fileName) => {
      try {
        const PagesJaunes = await Pages_jaunes(object, city, fileName);
        console.log('Les informations ont été récupérées avec succès !');

      } catch (error) {
        console.error('Erreur lors de la récupération des informations :', error);
      }

      rl.close();
    });
  });
});
