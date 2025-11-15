import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the current directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the configuration file
const configPath = join(__dirname, 'config', 'ccxt-accounts.json');

console.log(`Reading configuration from: ${configPath}`);
try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    
    if (!config.accounts || !Array.isArray(config.accounts)) {
        console.error('Configuration file does not contain a valid accounts array');
        process.exit(1);
    }
    
    console.log(`Found ${config.accounts.length} accounts in configuration:`);
    config.accounts.forEach((account, index) => {
        console.log(`\nAccount #${index + 1}:`);
        console.log(`Name: ${account.name}`);
        console.log(`Exchange: ${account.exchangeId}`);
        console.log(`API Key: ${account.apiKey ? '***' + account.apiKey.slice(-4) : 'Not set'}`);
        console.log(`Options:`, JSON.stringify(account.options || {}, null, 2));
    });
    
} catch (error) {
    console.error('Error reading configuration file:', error.message);
    process.exit(1);
}
