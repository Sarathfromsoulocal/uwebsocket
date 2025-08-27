// node server.js
const uWS = require('uWebSockets.js');
const http = require('http');
const axios = require('axios');

let logs = [];
let clientCounter = 0;

// Store raw ISO time, not formatted string
function addLog(msg) {
    logs.push({ time: new Date().toISOString(), message: msg });
    if (logs.length > 1000) logs.shift();
}


// --- WebSocket Server ---
uWS.App().ws('/*', {
    open: (ws) => {
        clientCounter++;
        ws.clientId = clientCounter;
        addLog(`Client ${ws.clientId} connected`);

        // Notify Odoo (POST)
        axios.post('http://192.168.0.2:8069/web/chat_view_socket_reciver', {
        message: { client_id: ws.clientId, message: 'Client Connected!' }
        }, {
        headers: { 'Content-Type': 'application/json' }
        }).then(res => {
        addLog(`Odoo Response: ${JSON.stringify(res.data)}`);
        }).catch(err => {
        addLog(`Odoo Error: ${err.message}`);
        });
    },

    message: (ws, message, isBinary) => {
        const msg = Buffer.from(message).toString();
        addLog(`Client ${ws.clientId} says: ${msg}`);
    },

    close: (ws, code, msg) => {
        addLog(`Client ${ws.clientId} disconnected`);
    }
    }).listen(9001, (token) => {
    if (token) {
        console.log('✅ WebSocket server listening on ws://localhost:9001');
    } else {
        console.log('❌ Failed to listen to port 9001');
    }
});


// --- HTTP Server (log viewer + API) ---
http.createServer((req, res) => {
    if (req.url.startsWith("/logs")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(logs));
    } else if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
        <html>
            <head>
                <meta charset="UTF-8">
                <title>Logs</title>
                <style>
                    body {
                        font-family: monospace;
                        margin: 0;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    #header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: #f4f4f4;
                        padding: 10px;
                        border-bottom: 1px solid #ccc;
                    }
                    #filters {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                    }
                    #controls {
                        display: flex;
                        gap: 10px;
                    }
                    #logs {
                        flex: 1;
                        white-space: pre;
                        padding: 10px;
                        overflow: auto;
                        background: #fff;
                    }
                    body.night #logs {
                        background: #111;
                        color: #0f0;
                    }
                </style>
            </head>
            <body>
                <div id="header">
                    <div id="filters">
                        <label>Date: <input type="date" id="date"></label>
                        <label>Time: <input type="time" id="time"></label>
                        <label>To Date: <input type="date" id="toDate"></label>
                        <label>To Time: <input type="time" id="toTime"></label>
                        <label>Search: <input type="text" id="search"></label>
                        <button onclick="loadLogs()">Filter</button>
                    </div>
                    <div id="controls">
                        <button id="refreshBtn" onclick="toggleRefresh()">⏸️ Pause</button>
                        <button onclick="toggleNightMode()">🌙 Night</button>
                    </div>
                </div>
                <div id="logs"></div>A

                <script>
                    let refreshInterval = setInterval(loadLogs, 2000);

                    function formatDateTime(iso) {
                        const d = new Date(iso);
                        const pad = n => n.toString().padStart(2, "0");
                        return pad(d.getDate()) + "-" + pad(d.getMonth()+1) + "-" + d.getFullYear() +
                                " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
                                "." + d.getMilliseconds().toString().padStart(2,"0");
                    }

                    async function loadLogs() {
                        const res = await fetch('/logs');
                        let data = await res.json();

                        const date = document.getElementById("date").value;
                        const time = document.getElementById("time").value;
                        const toDate = document.getElementById("toDate").value;
                        const toTime = document.getElementById("toTime").value;
                        const search = document.getElementById("search").value.toLowerCase();

                        let from = date ? new Date(date + "T" + (time || "00:00")) : null;
                        let to = toDate ? new Date(toDate + "T" + (toTime || "23:59")) : null;

                        if (from) data = data.filter(l => new Date(l.time) >= from);
                        if (to) data = data.filter(l => new Date(l.time) <= to);
                        if (search) data = data.filter(l => l.message.toLowerCase().includes(search));

                        document.getElementById("logs").innerText =
                            data.map(l => "[" + formatDateTime(l.time) + "] " + l.message).join("\\n");
                    }

                    function toggleRefresh() {
                        const btn = document.getElementById("refreshBtn");
                        if (refreshInterval) {
                            clearInterval(refreshInterval);
                            refreshInterval = null;
                            btn.innerText = "▶️ Resume";
                        } else {
                            refreshInterval = setInterval(loadLogs, 2000);
                            btn.innerText = "⏸️ Pause";
                        }
                    }

                    function toggleNightMode() {
                        document.body.classList.toggle("night");
                    }

                    loadLogs();
                </script>
            </body>
        </html>
        `);
    } else {
        res.writeHead(404);
        res.end("Not Found");
    }
}).listen(3000, () => {
    console.log("✅ Log viewer running at http://localhost:3000");
});
