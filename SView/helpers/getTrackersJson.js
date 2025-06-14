// Thank you chatgpt ♡
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const domainsRoot = path.join(__dirname, "..", 'domains');
const outputDir = path.join(__dirname, "..", 'trackerStorage');
const maxParts = 5;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const enriched = {};

function assignRiskScore(entry) {
  let score = 1;
  if (entry.fingerprinting && entry.fingerprinting >= 1) score += Math.min(entry.fingerprinting, 2);
  if (entry.cookies && entry.cookies > 0.00005) score += 1;
  if (entry.prevalence && entry.prevalence > 0.001) score += 1;
  if (entry.resources && entry.resources.some(r => r.fingerprinting >= 2)) score += 1;
  return Math.min(score, 5);
}

function updateStatusBar(current, total) {
  const percent = Math.floor((current / total) * 100);
  const barLength = 30;
  const filled = Math.floor((percent / 100) * barLength);
  const empty = barLength - filled;
  const bar = `[${'█'.repeat(filled)}${'-'.repeat(empty)}] ${percent}% (${current}/${total})`;

  readline.cursorTo(process.stdout, 0);
  process.stdout.write(bar);
}

function walkRegionFolders(baseDir) {
  const regions = fs.readdirSync(baseDir);
  let allFiles = [];

  for (const region of regions) {
    const regionDir = path.join(baseDir, region);
    if (!fs.statSync(regionDir).isDirectory()) continue;

    const files = fs.readdirSync(regionDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(regionDir, f));

    allFiles = allFiles.concat(files);
  }

  const total = allFiles.length;
  let count = 0;

  for (const filePath of allFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const domain = data.domain;
      if (!domain) continue;

      enriched[domain] = {
        owner: data.owner?.name || 'Unknown',
        categories: data.categories?.map(c => c.name) || [],
        cookies: data.cookies || 0,
        fingerprinting: data.fingerprinting || 0,
        prevalence: data.prevalence || 0,
        score: assignRiskScore(data)
      };
    } catch (err) {
      console.error(`Failed to parse ${filePath}:`, err.message);
    }

    count++;
    if (count % 100 === 0 || count === total) {
      updateStatusBar(count, total);
    }
  }

  console.log('\nDone processing files.\n');
}

function splitAndWriteParts(dataObj, parts, dir) {
  const entries = Object.entries(dataObj);
  const chunkSize = Math.ceil(entries.length / parts);

  for (let i = 0; i < parts; i++) {
    const slice = entries.slice(i * chunkSize, (i + 1) * chunkSize);
    const obj = Object.fromEntries(slice);
    const outPath = path.join(dir, `trackers_part${i + 1}.json`);
    fs.writeFileSync(outPath, JSON.stringify(obj, null, 2));
    console.log(`Wrote ${slice.length} entries to ${outPath}`);
  }
}

walkRegionFolders(domainsRoot);
splitAndWriteParts(enriched, maxParts, outputDir);
console.log(`Total trackers: ${Object.keys(enriched).length}`);
