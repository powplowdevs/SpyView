const MAX_MISSING = 3;
let trackerList = {};
const notifiedTabs = new Set();

// Load trackers from JSON
const trackerFiles = [
    "trackerStorage/trackers_part1.json",
    "trackerStorage/trackers_part2.json",
    "trackerStorage/trackers_part3.json",
    "trackerStorage/trackers_part4.json",
    "trackerStorage/trackers_part5.json"
];

(async () => {
    trackerList = {};
    for (const file of trackerFiles) {
        const response = await fetch(chrome.runtime.getURL(file));
        const part = await response.json();
        Object.assign(trackerList, part);
    }
})();


// Detect tracker on load
chrome.webRequest.onBeforeRequest.addListener((details) =>{
    const domain = new URL(details.url).hostname;
    let trackerData = null;

    for (const known of Object.keys(trackerList)){
        if (domain.includes(known)){
            trackerData = trackerList[known];
            break;
        }
    }

    if (!trackerData) return;

    chrome.storage.local.get(["lastScan", "trackers", "trackerStatus", "detectionLog"], (res) =>{
        const now = Date.now();
        const scan = res.lastScan ||{};
        const trackers = res.trackers ||{};
        const status = res.trackerStatus ||{};
        const log = res.detectionLog || [];

        getGeoData(domain).then((geo) =>{
            const logEntry = {
                domain,
                owner: trackerData.owner || "Unknown",
                url: details.initiator || details.documentUrl || details.url,
                timestamp: now,
                score: trackerData.score || 1,
                tabId: details.tabId,
                method: details.method || "GET",
                type: details.type || "other",
                geo
            };

            scan[domain] = {
                ...trackerData,
                tabId: details.tabId,
                url: logEntry.url,
                timestamp: now,
                type: logEntry.type
            };

            trackers[domain] = trackerData.owner || "Unknown";
            status[domain] = { ...(status[domain] ||{}), missing: 0 };
            log.push(logEntry);

            const cutoff = Date.now() - 90 * 86400000;
            const trimmedLog = log.filter(entry => entry.timestamp >= cutoff);

            chrome.storage.local.set({
                lastScan: scan,
                trackers,
                trackerStatus: status,
                detectionLog: trimmedLog
            });

            if (!notifiedTabs.has(details.tabId)){
                notifiedTabs.add(details.tabId);
                setTimeout(() =>{
                    chrome.storage.local.get(["lastScan", "enableNotifications", "minNotifyScore"], (data) => {
                    const notify = data.enableNotifications !== false;
                    const threshold = data.minNotifyScore || 1;

                    const amt = Object.values(data.lastScan || {}).filter(e => e.tabId === details.tabId);
                    if (!notify || amt.length === 0) return;

                    const avg = (amt.reduce((sum, t) => sum + (t.score || 1), 0) / amt.length).toFixed(1);
                    if (avg < threshold) return;

                    const top = amt.sort((a, b) => b.score - a.score)[0];
                    const mainDomain = new URL(top.url).hostname.replace(/^www\./, '');
                    const geoText = top.geo?.country ? `(${top.geo.country})` : '';
                    const threatLevel = avg >= 4.5 ? "🚨 Critical Risk" : avg >= 3.5 ? "⚠️ High Risk" : avg >= 2.5 ? "🟡 Moderate" : avg >= 1.5 ? "🟢 Low" : "✅ Safe";

                    chrome.notifications.create({
                        type: "basic",
                        iconUrl: "icons/icon128.png",
                        title: `SpyView Alert: ${mainDomain} ${geoText}`,
                        message: `${amt.length} tracker(s) found\nAverage Risk: ${avg}\nLevel: ${threatLevel}`,
                        priority: 2
                    });
                });

                }, 1500);
            }
        });
    });
},{ urls: ["<all_urls>"] });

// Run on tab close
chrome.tabs.onRemoved.addListener((tabId) =>{
    chrome.storage.local.get(["lastScan", "trackerStatus"], (res) =>{
        const scan = res.lastScan ||{};
        const status = res.trackerStatus ||{};
        let changed = false;

        for (const domain in scan){
            if (scan[domain].tabId === tabId){
                const current = status[domain] ||{ missing: 0 };
                const newMissing = current.missing + 1;

                if (newMissing < MAX_MISSING){
                    status[domain] = { ...current, missing: newMissing };
                } else{
                    delete status[domain];
                }

                changed = true;
            }
        }

        if (changed) chrome.storage.local.set({ trackerStatus: status });
    });
});

// Run on browser start
chrome.runtime.onStartup.addListener(handlePersistence);
chrome.runtime.onInstalled.addListener(handlePersistence);

function handlePersistence(){
    chrome.storage.local.get(["trackers", "lastScan", "trackerStatus", "detectionLog"], (res) =>{
        const stored = res.trackers ||{};
        const scan = res.lastScan ||{};
        const trackerStatus = res.trackerStatus ||{};
        const log = res.detectionLog || [];

        const updatedTrackers = {};
        const updatedStatus = {};

        for (const domain in stored){
            const name = stored[domain];
            const wasSeen = domain in scan;

            if (wasSeen){
                updatedTrackers[domain] = name;
                updatedStatus[domain] = { ...(trackerStatus[domain] ||{}), missing: 0 };
            } else{
                const misses = ((trackerStatus[domain]?.missing) || 0) + 1;
                if (misses < MAX_MISSING){
                    updatedTrackers[domain] = name;
                    updatedStatus[domain] = { ...(trackerStatus[domain] ||{}), missing: misses };
                }
            }
        }

        for (const domain in scan){
            if (!(domain in stored)){
                const name = scan[domain]?.owner || scan[domain];
                updatedTrackers[domain] = name;
                updatedStatus[domain] = { missing: 0 };
            }
        }

        const cutoff = Date.now() - 90 * 86400000;
        const trimmedLog = log.filter(entry => entry.timestamp >= cutoff);

        chrome.storage.local.set({
            trackers: updatedTrackers,
            trackerStatus: updatedStatus,
            detectionLog: trimmedLog
        });
    });
}

let geoCooldownUntil = 0;
const MAX_GEO_CACHE = 300;

const geoAPIs = [
    (domain) => `https://ip-api.com/json/${domain}`,
    (domain) => `https://ipwhois.app/json/${domain}`,
    (domain) => `https://ipapi.co/${domain}/json/`
];

async function getGeoData(domain) {
    const cacheKey = `geo_${domain}`;
    const now = Date.now();

    return new Promise((resolve) => {
        chrome.storage.local.get(null, async (res) => {
            if (res[cacheKey]) return resolve(res[cacheKey]);

            if (now < geoCooldownUntil) {
                console.warn(`[GeoAPI] Cooldown in effect. Skipping lookup for ${domain}`);
                return resolve({ country: "Unknown", lat: 0, lon: 0 });
            }

            for (let i = 0; i < geoAPIs.length; i++) {
                const url = geoAPIs[i](domain);

                try {
                    const response = await fetch(url);
                    if (response.status === 429) continue;

                    const json = await response.json();
                    const data = {
                        country: json.country || json.country_name || "Unknown",
                        lat: json.lat || json.latitude || 0,
                        lon: json.lon || json.longitude || 0,
                        ts: now
                    };

                    const toStore = { [cacheKey]: data };
                    // trim cahce
                    chrome.storage.local.set(toStore, () => {
                        const geoEntries = Object.entries(allData) .filter(([key, val]) => key.startsWith("geo_") && val.ts).sort((a, b) => b[1].ts - a[1].ts);

                        if (geoEntries.length <= MAX_GEO_CACHE) return;

                        const toDelete = geoEntries.slice(MAX_GEO_CACHE).map(([key]) => key);
                        chrome.storage.local.remove(toDelete, () => {
                            console.log(`[GeoAPI] Trimmed ${toDelete.length} old geo cache entries`);
                        });
                    });

                    return resolve(data);
                } catch (err) {
                    continue;
                }
            }

            // All APIs 429
            geoCooldownUntil = Date.now() + 5 * 60 * 1000;
            console.warn(`[GeoAPI] All sources rate-limited. Cooling down until ${new Date(geoCooldownUntil).toLocaleTimeString()}`);
            resolve({ country: "Unknown", lat: 0, lon: 0 });
        });
    });
}
