const MAX_MISSING = 3;
let trackerList = {};
const notifiedTabs = new Set();

// Load trackers from JSON
(async () =>{
    const response = await fetch(chrome.runtime.getURL("trackerStorage/trackersLarge.json"));
    trackerList = await response.json();
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
                    chrome.storage.local.get(["lastScan"], (data) =>{
                        const amt = Object.values(data.lastScan || {}).filter(e => e.tabId === details.tabId);
                        if (amt.length === 0) return;

                        const avg = (amt.reduce((sum, t) => sum + (t.score || 1), 0) / amt.length).toFixed(1);

                        const top = amt.sort((a, b) => b.score - a.score)[0];
                        const mainDomain = new URL(top.url).hostname.replace(/^www\./, '');
                        const geoText = top.geo?.country ? `(${top.geo.country})` : '';
                        const threatLevel = avg >= 4.5 ? "🚨 Critical Risk" : avg >= 3.5 ? "⚠️ High Risk" : avg >= 2.5 ? "🟡 Moderate" : avg >= 1.5 ? "🟢 Low" : "✅ Safe";

                        chrome.notifications.create({
                            type: "basic",
                            iconUrl: "icons/icon128.png",
                            title: `SpyView Alert: ${mainDomain} ${geoText}`,
                            message: `${amt.length} tracker(s) found\n` +  `Average Risk: ${avg}\n` + `Level: ${threatLevel}`,
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

async function getGeoData(domain){
    const cacheKey = `geo_${domain}`;
    return new Promise((resolve) =>{
        chrome.storage.local.get([cacheKey], async (res) =>{
            if (res[cacheKey]) return resolve(res[cacheKey]);

            try{
                const geoRes = await fetch(`http://ip-api.com/json/${domain}`);
                const geoData = await geoRes.json();

                const data = {
                    country: geoData.country || "Unknown",
                    lat: geoData.lat || 0,
                    lon: geoData.lon || 0
                };

                chrome.storage.local.set({ [cacheKey]: data });
                resolve(data);
            } catch (e){
                resolve({ country: "Unknown", lat: 0, lon: 0 });
            }
        });
    });
}
