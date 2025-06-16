function loadAnalyticsData(){
    chrome.storage.local.get(["detectionLog", "sessionStart", "lastScan", "trackerStatus"], ({ detectionLog = [], sessionStart = Date.now(), lastScan = {}, trackerStatus = {} }) =>{
        const now = Date.now();
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const weekStart = now - 7 * 86400000;
        const monthStart = now - 30 * 86400000;
        const yearStart = new Date(); yearStart.setMonth(0); yearStart.setDate(1); yearStart.setHours(0, 0, 0, 0);

        const totals = { today: 0, week: 0, month: 0, year: 0, session: 0, all: detectionLog.length };
        const domainHits = {};
        const trackerHits = {};
        const siteHits = {};
        const history = [];

        for (const entry of detectionLog){
            const ts = entry.timestamp;
            if (ts >= dayStart.getTime()) totals.today++;
            if (ts >= weekStart) totals.week++;
            if (ts >= monthStart) totals.month++;
            if (ts >= yearStart.getTime()) totals.year++;
            if (ts >= sessionStart) totals.session++;

            const domain = entry.domain;
            const owner = entry.owner || "Unknown";
            let url = "unknown";

            try{
                url = new URL(entry.url || "https://unknown").hostname;
            } catch{
                url = "unknown";
            }

            const siteKey = `${url}|${domain}`;
            domainHits[domain] = (domainHits[domain] || 0) + 1;
            trackerHits[owner] = (trackerHits[owner] || 0) + 1;
            siteHits[siteKey] = (siteHits[siteKey] || 0) + 1;

            history.push({
                url,
                owner,
                timestamp: new Date(ts).toLocaleString(),
                timestampRaw: ts,
                tabId: entry.tabId || "unknown",
                method: entry.method || "GET",
                type: entry.type || "script",
                domain,
                score: entry.score || 1
            });
        }

        renderTotals(totals);
        renderTopDomains(trackerHits);
        renderTopSites(siteHits);
        renderRecentHistory(history);
        renderPrivacyScore();
        renderGeoMap(detectionLog);
        renderLiveTrackers(lastScan, trackerStatus);
    });

    document.getElementById("downloadJson").addEventListener("click", () =>{
        chrome.storage.local.get(null, (data) =>{
            const blob = new Blob([JSON.stringify(data, null, 2)],{ type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "spyview_data.json";
            a.click();
            URL.revokeObjectURL(url);
        });
    });
}

function renderTotals(totals){
    const container = document.getElementById("totals");
    container.innerHTML = "";
    const items = [
        `📅 Today: ${totals.today}`,
        `🗓️ This Week: ${totals.week}`,
        `📅 This Month: ${totals.month}`,
        `📆 This Year: ${totals.year}`,
        `💻 This Session: ${totals.session}`,
        `🌐 All Time: ${totals.all}`
    ];

    items.forEach(text => {
        const li = document.createElement("li");
        li.textContent = text;
        container.appendChild(li);
    });
}


function renderTopDomains(trackerHits){
    const container = document.getElementById("topDomains");
    container.innerHTML = "";

    const sorted = Object.entries(trackerHits).sort((a, b) => b[1] - a[1]).slice(0, 10);
    sorted.forEach(([name, count]) => {
        const li = document.createElement("li");
        li.innerHTML = `${sanitizeHTML(name)} — <span class="text-blue-400">${count} detections</span>`;
        container.appendChild(li);
    });
}

function renderTopSites(siteHits){
    const container = document.getElementById("topSites");
    if (!container) return;

    container.innerHTML = "";
    const sorted = Object.entries(siteHits).sort((a, b) => b[1] - a[1]).slice(0, 10);
    sorted.forEach(([combo, count]) => {
        const [url, domain] = combo.split("|");
        const li = document.createElement("li");
        li.innerHTML = `${sanitizeHTML(url)} → <span class="text-purple-300">${sanitizeHTML(domain)}</span> — <span class="text-green-400">${count} trackers</span>`;
        container.appendChild(li);
    });
}

function renderRecentHistory(history){
    const container = document.getElementById("recentHistory");
    if (!container) return;

    container.innerHTML = "";
    const sorted = [...history].sort((a, b) => b.timestampRaw - a.timestampRaw).slice(0, 10);
    sorted.forEach(h => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span class="text-blue-300">${sanitizeHTML(h.url)}</span> → 
            <span class="text-purple-300">${sanitizeHTML(h.owner)}</span><br/>
            <span class="text-gray-400 text-xs">
                ${sanitizeHTML(h.timestamp)}, Tab: ${sanitizeHTML(h.tabId)}, Method: ${sanitizeHTML(h.method)}, Type: ${sanitizeHTML(h.type)}, Score: ${h.score}
            </span>
        `;
        container.appendChild(li);
    });
}


function renderPrivacyScore(){
    const bar = document.getElementById("privacyScoreBar");
    const label = document.getElementById("privacyScoreLabel");
    if (!bar || !label) return;

    const MAX_MISSING = 3;

    chrome.storage.local.get(["trackers", "lastScan", "trackerStatus"], (res) =>{
        const trackers = res.trackers ||{};
        const scan = res.lastScan ||{};
        const trackerStatus = res.trackerStatus ||{};
        const grouped = {};

        for (const domain in trackers){
            const group = trackers[domain];
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push(domain);
        }

        let groupScoreSum = 0;
        let groupScoreCount = 0;

        for (const domains of Object.values(grouped)){
            for (const domain of domains){
                const status = trackerStatus[domain] ||{ missing: 0 };
                if (status.missing >= MAX_MISSING) continue;

                const score = scan[domain]?.score || 1;
                groupScoreSum += score;
                groupScoreCount++;
            }
        }

        const avgPrivacyScore = groupScoreCount > 0 ? (groupScoreSum / groupScoreCount) : 1;
        const scaledPrivacy = Math.max(0, 100 - avgPrivacyScore * 20);

        bar.style.width = `${scaledPrivacy}%`;
        bar.className = `h-3 rounded-full transition-all duration-300 ${
            scaledPrivacy > 70 ? 'bg-green-500' :
            scaledPrivacy > 40 ? 'bg-yellow-500' : 'bg-red-500'
        }`;
        label.textContent = `${scaledPrivacy.toFixed(0)}/100 Privacy Score`;
    });
}

function renderGeoMap(detectionLog){
    const mapDiv = document.getElementById("locationMap");
    if (!mapDiv) return;

    if (L.DomUtil.get('locationMap')?._leaflet_id){
        L.DomUtil.get('locationMap')._leaflet_id = null;
    }

    const map = L.map('locationMap').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution: '&copy; OSM'
    }).addTo(map);

    const added = new Set();

    for (const entry of detectionLog){
        const domain = entry.domain;
        if (added.has(domain)) continue;

        const geo = entry.geo;
        if (!geo || !geo.lat || !geo.lon) continue;

        added.add(domain);
        L.circleMarker([geo.lat, geo.lon],{
            radius: 6,
            fillColor: "#ff3d00",
            fillOpacity: 0.6,
            color: "#fff",
            weight: 1
        }).addTo(map).bindPopup(`${domain}<br><span class="text-xs">${geo.country}</span>`);
    }
}

function renderLiveTrackers(lastScan, trackerStatus){
    const container = document.getElementById("liveTrackers");
    if (!container) return;

    const rows = [];

    for (const domain in lastScan){
        const data = lastScan[domain];
        const status = trackerStatus[domain] ||{ missing: 0 };
        if (status.missing >= 3) continue;

        const score = data.score || 1;
        const age = ((Date.now() - (data.timestamp || Date.now())) / 1000).toFixed(0);
        const badgeColor = score >= 5 ? 'bg-red-600' : score >= 4 ? 'bg-orange-500' :score >= 3 ? 'bg-yellow-400 text-black' : score >= 2 ? 'bg-lime-400 text-black' : 'bg-green-500';

        rows.push(`
            <li class="p-3 bg-neutral-700 rounded-lg shadow">
                <div class="font-semibold text-white mb-1">${domain}</div>
                <div class="text-xs text-blue-300">Owner: ${data.owner || "Unknown"}</div>
                <div class="text-xs text-green-300">Source: ${data.url || "?"}</div>
                <div class="text-xs text-yellow-300">Tab: ${data.tabId || "?"}${status.missing === 0 ? ` — ${age}s active` : ""}</div>
                <div class="mt-1 text-xs">Score: <span class="px-2 py-0.5 rounded ${badgeColor}">${score}</span>, Type: ${data.type || "?"}</div>
            </li>
        `);
    }

    container.innerHTML = rows.length ? rows.join("") : `<li class="text-gray-400">No active trackers.</li>`;
}

document.addEventListener("DOMContentLoaded", () =>{
    loadAnalyticsData();
    document.getElementById("refreshBtn").addEventListener("click", loadAnalyticsData);
});


// Needed to please firefox...
function sanitizeHTML(str){
    return String(str).replace(/[&<>"']/g, s => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[s]);
}
