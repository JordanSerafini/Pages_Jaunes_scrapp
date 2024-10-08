import pkg from 'pg';
const { Client } = pkg;
import fs from 'fs';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
});

async function insertCSV() {
  await client.connect();

  const fileStream = fs.createReadStream('./restaurant_74.csv');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const [name, address, phone] = line.split(',');
    const query = `
      INSERT INTO "restaurant_74" (name, address, phone)
      VALUES ($1, $2, $3)
    `;
    await client.query(query, [name, address, phone]);
  }

  await client.end();
}

insertCSV()
  .then(() => console.log('Données insérées avec succès'))
  .catch((err) => console.error('Erreur lors de l\'insertion des données', err));
