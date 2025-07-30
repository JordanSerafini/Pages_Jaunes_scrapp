import readline from 'readline';
import Pages_jaunes from './pages_jaunes.js';

// Simuler les entrées utilisateur
const mockInputs = [
    'auvergne-rhone-alpes',
    'batiment',
    'test-cookies.csv'
];

let inputIndex = 0;

// Mock de readline pour automatiser les entrées
const originalQuestion = readline.Interface.prototype.question;
readline.Interface.prototype.question = function(query, callback) {
    const answer = mockInputs[inputIndex++] || '';
    console.log(query + answer);
    callback(answer);
};

// Lancer le test
console.log('Test de la gestion des cookies...');
Pages_jaunes('batiment', 'auvergne-rhone-alpes', 'test-cookies.csv')
    .then(() => {
        console.log('Test terminé avec succès');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Erreur lors du test:', error);
        process.exit(1);
    }); 