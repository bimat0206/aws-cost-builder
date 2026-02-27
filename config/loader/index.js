// loader/index.js
// Service Catalog Loader - loads all catalog files from config/data/services/,
// validates each against the ServiceCatalogEntry schema, and exposes helper functions.

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalogEntry } from './schema_validator.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SERVICES_DIR = join(__dirname, '../data/services');
const GENERATED_DIR = join(SERVICES_DIR, 'generated');

// Cache for loaded catalogs
let catalogCache = null;

/**
 * Loads all catalog files from config/data/services/ and validates them.
 * @returns {Promise<Array<object>>} Array of validated ServiceCatalogEntry objects
 * @throws {Error} Throws if any catalog file fails validation
 */
export async function loadAllCatalogs() {
    if (catalogCache) {
        return catalogCache;
    }
    
    const catalogs = [];
    
    // Load only from the main services directory (not generated/)
    // generated/ is reserved for explorer draft outputs
    const serviceFiles = await readdir(SERVICES_DIR, { withFileTypes: true });
    
    for (const entry of serviceFiles) {
        // Skip directories (including 'generated')
        if (entry.isDirectory()) {
            continue;
        }
        
        // Only process .json files
        if (extname(entry.name) !== '.json') {
            continue;
        }
        
        const filePath = join(SERVICES_DIR, entry.name);
        const content = await readFile(filePath, 'utf-8');
        const catalog = JSON.parse(content);
        
        // Validate against schema
        validateCatalogEntry(catalog, entry.name);
        
        catalogs.push(catalog);
    }
    
    catalogCache = catalogs;
    return catalogs;
}

/**
 * Gets a service catalog entry by name.
 * @param {string} name - The service name to find (case-insensitive, supports partial match)
 * @returns {object|null} The ServiceCatalogEntry or null if not found
 */
export async function getServiceByName(name) {
    const catalogs = await loadAllCatalogs();
    const normalizedName = name.toLowerCase();
    
    for (const catalog of catalogs) {
        // Try exact match first
        if (catalog.service_name.toLowerCase() === normalizedName) {
            return catalog;
        }
        // Try partial match (e.g., "EC2" matches "Amazon EC2")
        if (catalog.service_name.toLowerCase().includes(normalizedName)) {
            return catalog;
        }
    }
    
    return null;
}

/**
 * Gets all service catalog entries.
 * @returns {Promise<Array<object>>} Array of all ServiceCatalogEntry objects
 */
export async function getAllServices() {
    return loadAllCatalogs();
}

/**
 * Clears the catalog cache (useful for testing or hot-reload scenarios).
 */
export function clearCatalogCache() {
    catalogCache = null;
}

/**
 * Loads draft catalogs from the generated/ subdirectory.
 * These are unvalidated drafts produced by explore mode.
 * @returns {Promise<Array<{filename: string, catalog: object}>>} Array of draft catalogs with filenames
 */
export async function loadGeneratedDrafts() {
    const drafts = [];
    
    try {
        const files = await readdir(GENERATED_DIR, { withFileTypes: true });
        
        for (const entry of files) {
            if (entry.isFile() && extname(entry.name) === '.json') {
                const filePath = join(GENERATED_DIR, entry.name);
                const content = await readFile(filePath, 'utf-8');
                const catalog = JSON.parse(content);
                drafts.push({ filename: entry.name, catalog });
            }
        }
    } catch (err) {
        // Directory may not exist yet; return empty array
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
    
    return drafts;
}
