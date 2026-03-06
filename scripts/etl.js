// ETL: Load all CSV files from data/raw/ into the AstroData table
// Uses better-sqlite3 directly for memory-efficient bulk inserts
const fs = require('fs');
const path = require('path');
const Database = require('../node_modules/better-sqlite3');

const dbPath = path.join(__dirname, '..', 'dev.db');
const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');

const db = new Database(dbPath);

// Enable WAL mode for faster writes
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

function parseRow(headers, values) {
  const get = (col) => (values[headers.indexOf(col)] || '').trim();
  const getInt = (col) => parseInt(get(col), 10) || 0;
  const getFloat = (col) => parseFloat(get(col)) || 0;

  return [
    get('Date'),
    getFloat('Time'),
    get('Tithi'),
    get('Paksha'),
    get('Hora Planet'),
    get('Panchak'),
    get('Lagna'),
    get('Moon Rashi'),
    get('Moon Nakshatra'),
    getInt('Moon Pada'),
    get('Sun Rashi'),
    get('Sun Nakshatra'),
    getInt('Sun Pada'),
    get('Mars Rashi'),
    get('Mars Nakshatra'),
    getInt('Mars Pada'),
    get('Mercury Rashi'),
    get('Mercury Nakshatra'),
    getInt('Mercury Pada'),
    get('Jupiter Rashi'),
    get('Jupiter Nakshatra'),
    getInt('Jupiter Pada'),
    get('Venus Rashi'),
    get('Venus Nakshatra'),
    getInt('Venus Pada'),
    get('Saturn Rashi'),
    get('Saturn Nakshatra'),
    getInt('Saturn Pada'),
    get('Rahu Rashi'),
    get('Rahu Nakshatra'),
    getInt('Rahu Pada'),
    get('Ketu Rashi'),
    get('Ketu Nakshatra'),
    getInt('Ketu Pada'),
  ];
}

// Prepare insert statement
const insert = db.prepare(`
  INSERT INTO AstroData (
    date, time, tithi, paksha, horaPlanet, panchak, lagna,
    moonRashi, moonNakshatra, moonPada,
    sunRashi, sunNakshatra, sunPada,
    marsRashi, marsNakshatra, marsPada,
    mercuryRashi, mercuryNakshatra, mercuryPada,
    jupiterRashi, jupiterNakshatra, jupiterPada,
    venusRashi, venusNakshatra, venusPada,
    saturnRashi, saturnNakshatra, saturnPada,
    rahuRashi, rahuNakshatra, rahuPada,
    ketuRashi, ketuNakshatra, ketuPada
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row);
});

function loadCsvSync(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    rows.push(parseRow(headers, line.split(',')));
  }
  return rows;
}

// Clear existing data
console.log('Clearing existing AstroData...');
db.prepare('DELETE FROM AstroData').run();

// Collect all CSV files
const csvFiles = [];
const years = fs.readdirSync(RAW_DIR).sort();
for (const year of years) {
  const yearDir = path.join(RAW_DIR, year);
  if (!fs.statSync(yearDir).isDirectory()) continue;
  const files = fs.readdirSync(yearDir).filter(f => f.endsWith('.csv')).sort();
  for (const file of files) {
    csvFiles.push(path.join(yearDir, file));
  }
}

console.log(`Found ${csvFiles.length} CSV files. Loading...`);

let totalRows = 0;
for (let i = 0; i < csvFiles.length; i++) {
  const rows = loadCsvSync(csvFiles[i]);
  insertMany(rows);
  totalRows += rows.length;

  if ((i + 1) % 50 === 0 || i + 1 === csvFiles.length) {
    console.log(`  ${i + 1}/${csvFiles.length} files | ${totalRows.toLocaleString()} rows`);
  }
}

db.close();
console.log(`\nDone! Loaded ${totalRows.toLocaleString()} rows from ${csvFiles.length} files.`);
