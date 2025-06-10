const MAX_MISSING = 3;

document.addEventListener("DOMContentLoaded", () =>{
    chrome.storage.local.get(["trackers", "lastScan", "trackerStatus", "groupStatus"], (res) =>{
        const stored = res.trackers ||{};
        const scan = res.lastScan ||{};
        const trackerStatus = res.trackerStatus ||{};
        const groupStatus = res.groupStatus ||{};
        const grouped = {};

        for (const domain in stored){
            const name = stored[domain];
            if (!grouped[name]){
                grouped[name] = [];
            }
            grouped[name].push(domain);
        }

        chrome.tabs.query({}, (tabs) =>{
            const openTabIds = tabs.map(t => t.id);
            const updatedStatus = {};
            let changed = false;

            for (const domain in grouped){
                for (const d of grouped[domain]){
                    const scanEntry = scan[d];
                    const status = trackerStatus[d] ||{ missing: 0 };

                    if (scanEntry?.tabId && !openTabIds.includes(scanEntry.tabId)){
                        status.missing += 1;
                        changed = true;
                    } else{
                        status.missing = 0;
                    }

                    updatedStatus[d] = status;
                }
            }

            if (changed){
                chrome.storage.local.set({ trackerStatus: updatedStatus }, () =>{
                    renderUI(grouped, updatedStatus, groupStatus, scan);
                });
            } else{
                renderUI(grouped, trackerStatus, groupStatus, scan);
            }
        });
    });
});

function renderPrivacyScore(){
    const bar = document.getElementById("privacyBar");
    const label = document.getElementById("privacyLabel");
    if (!bar || !label) return;

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

function renderUI(grouped, trackerStatus, groupStatus, scan){
    const container = document.getElementById("trackerList");

    let html = "";
    let groupScoreSum = 0;
    let groupScoreCount = 0;
    let totalVisible = 0;

    let groupHtml = "";
    let liveAny = false;
    let totalScore = 0;
    let visibleCount = 0;
    let avgScore = 0;

    for (const [name, domains] of Object.entries(grouped)){
        groupHtml = "";
        liveAny = false;
        totalScore = 0;
        visibleCount = 0;

        for (const domain of domains){
            const s = trackerStatus[domain] ||{ missing: 0 };
            if (s.missing >= MAX_MISSING) continue;

            const score = scan[domain]?.score || 1;
            const fingerprinting = scan[domain]?.fingerprinting ? true : false;
            const cookies = scan[domain]?.cookies > 0;

            const typeLabel = fingerprinting ? cookies ? "Tracking & Fingerprinting" : "Fingerprinting": cookies ? "Tracking" : "Unknown";

            const typeColor = fingerprinting ? cookies ? "text-red-400" : "text-purple-400": cookies ? "text-yellow-400" : "text-gray-400";

            const tooltip = getScoreTooltip(score);
            const scoreColor = { 1: "bg-green-500", 2: "bg-lime-400", 3: "bg-yellow-400", 4: "bg-orange-500", 5: "bg-red-600" }[score];
            const scoreTextColor = { 1: "text-white", 2: "text-white", 3: "text-black", 4: "text-white", 5: "text-white" }[score];

            totalScore += score;
            visibleCount++;

            let iconColor = "bg-green-500";
            let visitTooltip = `Seen on ${scan[domain]?.url || "unknown site"} (tab still open)`;
            if (s.missing > 0){
                iconColor = "bg-gray-400";
                const remaining = MAX_MISSING - s.missing;
                visitTooltip = `Seen on ${scan[domain]?.url || "unknown site"} (site closed, will be removed after ${remaining} more visit${remaining === 1 ? "" : "s"})`;
            }

            const icon = `<span class="inline-block w-2 h-2 ${iconColor} rounded-full mr-2" title="${visitTooltip}"></span>`;

            if (s.missing === 0) liveAny = true;

            groupHtml += `
                <li class="ml-4 text-sm text-gray-300 flex flex-col gap-0.5">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            ${icon}
                            <span>${domain}</span>
                            <span class="text-xs font-bold px-2 py-0.5 rounded ${scoreColor} ${scoreTextColor}" title="${tooltip}">${score}</span>
                        </div>
                    </div>
                    <div class="text-xs ${typeColor} pl-6 mt-0.5">${typeLabel}</div>
                </li>`;
        }

        if (!groupHtml) continue;
        else groupStatus[name] = { deadCount: 0 };

        avgScore = visibleCount ? (totalScore / visibleCount).toFixed(1) : "1.0";
        const groupScoreColor = { "1": "bg-green-500", "2": "bg-lime-400", "3": "bg-yellow-400", "4": "bg-orange-500", "5": "bg-red-600" }[Math.round(avgScore)];
        const groupTooltip = liveAny ? "This group contains active trackers" : "All trackers in this group are inactive";
        const groupIcon = `<span class="inline-block w-2 h-2 ${liveAny ? 'bg-green-500' : 'bg-gray-400'} rounded-full mr-2" title="${groupTooltip}"></span>`;

        html += `
            <div class="bg-neutral-800 p-4 rounded shadow">
                <div class="flex justify-between items-center mb-1">
                    <div class="flex items-center text-white font-semibold gap-2">
                        ${groupIcon}<span>${name}</span>
                        <span class="text-xs font-bold px-2 py-0.5 rounded ${groupScoreColor}">${avgScore}</span>
                    </div>
                    <button class="toggle-btn text-xs text-blue-400 hover:underline" data-index="${name}">Domains</button>
                </div>
                <ul id="details-${name}" class="hidden mt-2 space-y-1">${groupHtml}</ul>
            </div>`;
    }

    if (visibleCount > 0){
        groupScoreSum += totalScore;
        groupScoreCount += visibleCount;
        totalVisible += visibleCount;
    }

    renderPrivacyScore();

    container.innerHTML = html || `<p class="text-gray-400">No active trackers.</p>`;

    chrome.storage.local.set({ groupStatus });
    setupToggles();
}

function getScoreTooltip(score){
    const map = {
        1: "Low risk: benign or common tracker",
        2: "Mild: basic tracking or cookies",
        3: "Moderate: known fingerprinting/cookie use",
        4: "High: invasive tracking behavior",
        5: "Critical: aggressive fingerprinting or surveillance"
    };
    return map[score] || "Unknown risk level";
}

function setupToggles(){
    document.querySelectorAll(".toggle-btn").forEach(btn =>{
        btn.addEventListener("click", () =>{
            const index = btn.getAttribute("data-index");
            const target = document.getElementById(`details-${index}`);
            target.classList.toggle("hidden");
        });
    });
}

document.getElementById("infoIcon").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.add("hidden");
    document.getElementById("tutorial").classList.toggle("hidden");
});

document.getElementById("closeTutorial").addEventListener("click", () => {
    document.getElementById("tutorial").classList.add("hidden");
});

document.getElementById("settingsIcon").addEventListener("click", () => {
    document.getElementById("tutorial").classList.add("hidden");
    document.getElementById("settingsPanel").classList.remove("hidden");
});

document.getElementById("closeSettings").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.add("hidden");
});

document.getElementById("minScoreSlider").addEventListener("input", (e) => {
    const val = e.target.value;
    document.getElementById("minScoreValue").textContent = val;
    chrome.storage.local.set({ minNotifyScore: Number(val) });
});

document.getElementById("enableNotifications").addEventListener("change", (e) => {
    chrome.storage.local.set({ enableNotifications: e.target.checked });
});

document.getElementById("clearStats").addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all stored tracker stats? This cannot be undone.")) {
        chrome.storage.local.remove(["lastScan", "trackers", "trackerStatus", "detectionLog", "groupStatus"], () => {
            location.reload();
        });
    }
});

// Load current settings
chrome.storage.local.get(["enableNotifications", "minNotifyScore"], (res) => {
    document.getElementById("enableNotifications").checked = res.enableNotifications !== false;
    document.getElementById("minScoreSlider").value = res.minNotifyScore || 3;
    document.getElementById("minScoreValue").textContent = res.minNotifyScore || 3;
});
